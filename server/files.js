/**
 * LaserLog — file indexing.
 *
 * Points at a folder you already have (a Nextcloud data directory mounted
 * read-only, say) or at a remote Nextcloud over WebDAV, walks it, and records
 * what's there. It never writes to the source. Files stay exactly where they
 * are; LaserLog only keeps a catalogue.
 *
 * LightBurn projects get opened and read: .lbrn and .lbrn2 are plain XML and
 * carry their own cut settings, so your existing project files can become
 * library entries without retyping anything.
 */
import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve, relative, extname, basename, dirname, sep } from 'node:path';
import { db, nowISO, newId, get, UPLOAD_DIR } from './db.js';

/* ------------------------------------------------------------ classify */

const KIND_BY_EXT = {
  lightburn: ['.lbrn', '.lbrn2'],
  vector: ['.svg', '.dxf', '.ai', '.eps', '.cdr', '.pdf', '.plt'],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'],
  gcode: ['.gcode', '.gc', '.nc', '.ngc', '.tap', '.cnc'],
  model: ['.stl', '.3mf', '.obj', '.step', '.stp', '.f3d'],
  doc: ['.txt', '.md', '.csv', '.xlsx', '.xls', '.ods', '.rtf', '.doc', '.docx'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz'],
};

const EXT_TO_KIND = new Map();
for (const [kind, exts] of Object.entries(KIND_BY_EXT)) {
  for (const e of exts) EXT_TO_KIND.set(e, kind);
}

/** Everything we bother indexing. Anything else is skipped. */
export const INDEXED_EXTS = new Set(EXT_TO_KIND.keys());

export const classify = (ext) => EXT_TO_KIND.get(String(ext || '').toLowerCase()) || 'other';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.DS_Store',
  'files_trashbin', 'files_versions', 'uploads', 'cache', 'appdata',
  'thumbnails', '.thumbnails', 'preview', '@eaDir',
]);

const SKIP_FILES = /^(\.|~\$|Thumbs\.db$|desktop\.ini$)/i;

/**
 * Per-source folder exclusions, one per line. A bare name ("Downloads") skips
 * that folder wherever it appears; anything with a slash ("Admin/Backups") is
 * matched against the path from the scan root down.
 *
 * Returns a predicate over the folder's path relative to the scan root.
 */
export function excludeMatcher(exclude) {
  const norm = (s) => String(s).trim().replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
  const lines = String(exclude || '')
    .split(/[\n,]/).map(norm).filter(Boolean);
  if (!lines.length) return () => false;

  const names = new Set();
  const paths = [];
  for (const line of lines) {
    if (line.includes('/')) paths.push(line.toLowerCase());
    else names.add(line.toLowerCase());
  }

  return (relDir) => {
    const rel = norm(relDir).toLowerCase();
    if (!rel) return false;
    // A bare name excludes that folder and everything under it, so any segment
    // matching is enough — the walk checks each folder on the way down, but a
    // catalogued file's folder arrives here as the whole path.
    if (rel.split('/').some((seg) => names.has(seg))) return true;
    return paths.some((p) => rel === p || rel.startsWith(p + '/'));
  };
}

/* ------------------------------------------------------ path safety */

/**
 * Resolve a relative path inside a root and refuse anything that climbs out.
 * The catalogue holds paths that came off disk, but they also arrive back
 * from the client on download requests, so this is checked every time.
 */
export function safeResolve(root, relPath) {
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, '.' + sep + relPath);
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) {
    throw new Error('path_outside_source');
  }
  return target;
}

/* --------------------------------------------------------- folder walk */

async function walkFolder(rootAbs, sub = '', out = [], depth = 0, skip = () => false) {
  if (depth > 12) return out;                 // runaway symlink guard
  const dirAbs = sub ? join(rootAbs, sub) : rootAbs;

  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;                                // unreadable folder — skip it
  }

  for (const ent of entries) {
    const name = ent.name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const childSub = sub ? join(sub, name) : name;
      if (skip(childSub.split(sep).join('/'))) continue;
      await walkFolder(rootAbs, childSub, out, depth + 1, skip);
      continue;
    }
    if (!ent.isFile() && !ent.isSymbolicLink()) continue;
    if (SKIP_FILES.test(name)) continue;

    const ext = extname(name).toLowerCase();
    if (!INDEXED_EXTS.has(ext)) continue;

    const rel = sub ? join(sub, name) : name;
    try {
      const st = await stat(join(rootAbs, rel));
      if (!st.isFile()) continue;
      out.push({
        rel_path: rel.split(sep).join('/'),
        name,
        ext,
        size: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
        folder: sub ? sub.split(sep).join('/') : '',
      });
    } catch { /* vanished mid-scan */ }
  }
  return out;
}

/* ------------------------------------------------------------- WebDAV */

const xmlText = (block, tag) => {
  const m = block.match(new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`));
  return m ? m[1].trim() : null;
};

/**
 * Nextcloud's WebDAV endpoint, walked one level at a time. Depth: infinity is
 * refused by plenty of servers, so we recurse ourselves.
 */
async function walkWebdav(source, sub = '', out = [], depth = 0, skip = () => false) {
  if (depth > 12) return out;

  const base = source.url.replace(/\/+$/, '');
  const root = `${base}/remote.php/dav/files/${encodeURIComponent(source.username)}`;
  const target = [root, ...(source.subpath || '').split('/').filter(Boolean),
                  ...sub.split('/').filter(Boolean)]
    .map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/');

  const res = await fetch(target, {
    method: 'PROPFIND',
    headers: {
      Depth: '1',
      'Content-Type': 'application/xml',
      Authorization: 'Basic ' + Buffer.from(`${source.username}:${source.password}`).toString('base64'),
    },
    body: `<?xml version="1.0"?>
      <d:propfind xmlns:d="DAV:"><d:prop>
        <d:resourcetype/><d:getcontentlength/><d:getlastmodified/>
      </d:prop></d:propfind>`,
  });

  if (res.status === 401) throw new Error('webdav_unauthorized');
  if (!res.ok) throw new Error(`webdav_http_${res.status}`);

  const body = await res.text();
  const blocks = body.split(/<\/(?:[a-zA-Z0-9]+:)?response>/).slice(0, -1);
  const prefixPath = new URL(target).pathname.replace(/\/+$/, '');

  for (const block of blocks) {
    const href = xmlText(block, 'href');
    if (!href) continue;
    const path = decodeURIComponent(href).replace(/\/+$/, '');
    if (path === prefixPath) continue;            // the folder itself

    const name = basename(path);
    const isDir = /<(?:[a-zA-Z0-9]+:)?collection\s*\/?>/.test(block);
    const childSub = sub ? `${sub}/${name}` : name;

    if (isDir) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      if (skip(childSub)) continue;
      await walkWebdav(source, childSub, out, depth + 1, skip);
      continue;
    }

    if (SKIP_FILES.test(name)) continue;
    const ext = extname(name).toLowerCase();
    if (!INDEXED_EXTS.has(ext)) continue;

    const len = xmlText(block, 'getcontentlength');
    const mod = xmlText(block, 'getlastmodified');
    out.push({
      rel_path: childSub,
      name,
      ext,
      size: len ? Number(len) : null,
      mtime: mod ? new Date(mod).toISOString() : null,
      folder: sub,
    });
  }
  return out;
}

async function readWebdavFile(source, relPath) {
  const base = source.url.replace(/\/+$/, '');
  const parts = [`${base}/remote.php/dav/files/${encodeURIComponent(source.username)}`,
                 ...(source.subpath || '').split('/').filter(Boolean),
                 ...relPath.split('/').filter(Boolean)];
  const url = parts.map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/');
  const res = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${source.username}:${source.password}`).toString('base64'),
    },
  });
  if (!res.ok) throw new Error(`webdav_http_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------------------------------- LightBurn projects */

/**
 * Pull the cut settings out of a LightBurn project.
 *
 * Both .lbrn and .lbrn2 are plain XML and, per LightBurn, store cut settings
 * identically. Child elements carry their value in a Value attribute:
 *
 *   <CutSetting type="Cut">
 *     <index Value="0"/><name Value="C00"/>
 *     <maxPower Value="100"/><speed Value="10"/><numPasses Value="2"/>
 *   </CutSetting>
 *
 * Tag names drift between LightBurn versions, so rather than demanding an
 * exact schema this reads every Value child into a bag and maps the ones it
 * recognises, keeping the rest under `extra`. An unknown tag costs us a field,
 * not the whole import.
 */
export function parseLightBurn(xml) {
  const out = { cut_settings: [], notes: null, thumbnail: null, format: null };

  const root = xml.match(/<LightBurnProject[^>]*>/);
  if (root) {
    const fv = root[0].match(/FormatVersion="([^"]*)"/);
    const av = root[0].match(/AppVersion="([^"]*)"/);
    out.format = [fv && `format ${fv[1]}`, av && `LightBurn ${av[1]}`].filter(Boolean).join(', ') || null;
  }

  const notes = xml.match(/<Notes\b[^>]*\bNotes="([^"]*)"/);
  if (notes) out.notes = decodeXmlAttr(notes[1]).trim() || null;

  const thumb = xml.match(/<Thumbnail\b[^>]*\bSource="([^"]+)"/);
  if (thumb) out.thumbnail = thumb[1];

  const blocks = xml.match(/<CutSetting(?:_Img)?\b[\s\S]*?<\/CutSetting(?:_Img)?>/g) || [];

  for (const block of blocks) {
    const bag = {};
    const attrRe = /<([A-Za-z0-9_]+)\s+Value="([^"]*)"\s*\/?>/g;
    let m;
    while ((m = attrRe.exec(block)) !== null) bag[m[1]] = decodeXmlAttr(m[2]);

    const typeM = block.match(/<CutSetting(?:_Img)?[^>]*\btype="([^"]*)"/);
    const num = (k) => (bag[k] !== undefined && bag[k] !== '' && Number.isFinite(Number(bag[k]))
      ? Number(bag[k]) : null);
    const bool = (k) => (bag[k] === undefined ? null : (bag[k] === '1' || bag[k] === 'true' ? 1 : 0));

    const known = new Set(['index', 'name', 'maxPower', 'minPower', 'maxPower2', 'minPower2',
      'speed', 'numPasses', 'interval', 'DPI', 'dpi', 'zOffset', 'zPerPass',
      'enableAirAssist', 'airAssist', 'doOutput', 'priority', 'frequency', 'QPulseWidth',
      'tabCount', 'kerf', 'kerfOffset']);
    const extra = {};
    for (const [k, v] of Object.entries(bag)) if (!known.has(k)) extra[k] = v;

    out.cut_settings.push({
      index: num('index'),
      name: bag.name || null,
      type: typeM ? typeM[1] : null,
      // LightBurn stores speed in mm/sec in the file, whatever the UI shows.
      speed: num('speed'),
      speed_unit: 'mm/s',
      power_max: num('maxPower'),
      power_min: num('minPower'),
      passes: num('numPasses'),
      interval: num('interval'),
      dpi: num('DPI') ?? num('dpi'),
      z_offset: num('zOffset'),
      z_per_pass: num('zPerPass'),
      air_assist: bool('enableAirAssist') ?? bool('airAssist'),
      frequency_khz: num('frequency') !== null ? num('frequency') / 1000 : null,
      pulse_width_ns: num('QPulseWidth'),
      kerf_mm: num('kerf') ?? num('kerfOffset'),
      output: bool('doOutput'),
      extra: Object.keys(extra).length ? extra : undefined,
    });
  }

  // Layers with output switched off weren't used for the real job.
  out.cut_settings = out.cut_settings.filter((c) => c.output !== 0);
  return out;
}

function decodeXmlAttr(s) {
  return String(s)
    .replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&#10;', '\n').replaceAll('&amp;', '&');
}

/** Save an embedded LightBurn thumbnail into uploads/ so the grid has a preview. */
async function saveThumbnail(dataOrB64, id) {
  try {
    const b64 = dataOrB64.includes(',') ? dataOrB64.split(',').pop() : dataOrB64;
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 64 || buf.length > 4 * 1024 * 1024) return null;
    const filename = `lb-${id}.png`;
    await writeFile(join(UPLOAD_DIR, filename), buf);
    return filename;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- scanning */

/** Best-guess category from the folder a file sits in. */
function suggestCategory(folder) {
  if (!folder) return null;
  const last = folder.split('/').filter(Boolean).pop();
  if (!last) return null;
  return last
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60);
}

/**
 * Walk a source and reconcile the catalogue with what's actually there.
 * Files you've already categorised keep their category, tags and links —
 * a rescan only refreshes size/mtime and fills in blanks.
 */
export async function scanSource(sourceId, { parseLightburn = true } = {}) {
  const source = get('sources', sourceId);
  if (!source || source.deleted_at) throw new Error('source_not_found');

  const skip = excludeMatcher(source.exclude);

  let found;
  if (source.kind === 'webdav') {
    if (!source.url || !source.username) throw new Error('webdav_not_configured');
    found = await walkWebdav(source, '', [], 0, skip);
  } else {
    if (!source.root_path) throw new Error('folder_not_configured');
    const rootAbs = source.subpath
      ? safeResolve(source.root_path, source.subpath)
      : resolve(source.root_path);
    await stat(rootAbs);                       // throws ENOENT if not mounted
    found = await walkFolder(rootAbs, '', [], 0, skip);
  }

  const ts = nowISO();
  // Only live rows. A file dropped by an exclusion stays soft-deleted; without
  // this it would be re-counted as "dropped" on every scan from then on.
  const existing = db
    .prepare(`SELECT id, rel_path, folder, mtime, size, thumb, meta_json
                FROM files WHERE source_id=? AND deleted_at IS NULL`)
    .all(sourceId);
  const byPath = new Map(existing.map((r) => [r.rel_path, r]));
  const seen = new Set();

  // An unassigned device that is present but not mounted looks like an empty
  // folder, not an error. Flagging the whole catalogue missing because of that
  // is worse than doing nothing, so refuse the scan instead.
  if (!found.length && existing.length) {
    const msg = `Found nothing — catalogue left alone. `
              + `The folder is readable but empty, so the drive is probably not mounted.`;
    db.prepare(`UPDATE sources SET last_scan_at=?, last_scan_msg=?, updated_at=? WHERE id=?`)
      .run(ts, msg, ts, sourceId);
    const err = new Error('source_empty');
    err.detail = msg;
    err.kept = existing.length;
    throw err;
  }

  const stats = { total: found.length, added: 0, updated: 0, missing: 0,
                  excluded: 0, lightburn: 0 };

  // Anything needing the file opened is collected now and done after the
  // transaction, so a slow disk doesn't hold a write lock on the database.
  const toParse = [];

  const applyAll = db.transaction(() => {
    for (const f of found) {
      seen.add(f.rel_path);
      const prev = byPath.get(f.rel_path);
      const kind = classify(f.ext);

      if (prev) {
        const changed = prev.mtime !== f.mtime || prev.size !== f.size;
        db.prepare(
          `UPDATE files SET name=?, ext=?, kind=?, size=?, mtime=?, folder=?,
                            missing=0, updated_at=?
            WHERE id=?`
        ).run(f.name, f.ext, kind, f.size, f.mtime, f.folder, ts, prev.id);
        if (changed) stats.updated++;
        if (kind === 'lightburn' && parseLightburn && (changed || !prev.meta_json)) {
          toParse.push({ id: prev.id, rel_path: f.rel_path });
        }
      } else {
        const id = newId();
        db.prepare(
          `INSERT INTO files (id, source_id, rel_path, name, ext, kind, size, mtime,
                              folder, category, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(id, sourceId, f.rel_path, f.name, f.ext, kind, f.size, f.mtime,
              f.folder, suggestCategory(f.folder), ts, ts);
        stats.added++;
        if (kind === 'lightburn' && parseLightburn) toParse.push({ id, rel_path: f.rel_path });
      }
    }

    for (const row of existing) {
      if (seen.has(row.rel_path)) continue;

      // Newly excluded rather than gone. Drop it out of the catalogue, because
      // 20,000 rows flagged "missing" is not what excluding a folder means.
      if (skip(row.folder || '')) {
        db.prepare(`UPDATE files SET deleted_at=?, updated_at=? WHERE id=?`)
          .run(ts, ts, row.id);
        stats.excluded++;
        continue;
      }

      // Gone from disk: flagged, not deleted, so your notes and tags survive a
      // temporarily unmounted share.
      db.prepare(`UPDATE files SET missing=1, updated_at=? WHERE id=?`).run(ts, row.id);
      stats.missing++;
    }
  });

  applyAll();

  for (const item of toParse) {
    try {
      let buf;
      if (source.kind === 'webdav') {
        buf = await readWebdavFile(source, item.rel_path);
      } else {
        const abs = safeResolve(
          source.subpath ? safeResolve(source.root_path, source.subpath) : source.root_path,
          item.rel_path
        );
        const st = await stat(abs);
        if (st.size > 80 * 1024 * 1024) continue;   // don't slurp a huge project
        buf = await readFile(abs);
      }
      const parsed = parseLightBurn(buf.toString('utf8'));
      let thumb = null;
      if (parsed.thumbnail) thumb = await saveThumbnail(parsed.thumbnail, item.id);
      delete parsed.thumbnail;

      db.prepare(`UPDATE files SET meta_json=?, thumb=COALESCE(?, thumb), updated_at=? WHERE id=?`)
        .run(JSON.stringify(parsed), thumb, nowISO(), item.id);
      if (parsed.cut_settings.length) stats.lightburn++;
    } catch {
      /* unreadable or not the XML we expected — the file stays indexed without settings */
    }
  }

  const msg = `${stats.total} files · ${stats.added} new · ${stats.updated} changed`
            + `${stats.excluded ? ` · ${stats.excluded} dropped by exclusions` : ''}`
            + `${stats.missing ? ` · ${stats.missing} missing` : ''}`
            + `${stats.lightburn ? ` · ${stats.lightburn} with settings` : ''}`
            + `${stats.missing > existing.length / 2
                  ? ' — over half the catalogue went missing at once, worth checking the share'
                  : ''}`;
  db.prepare(`UPDATE sources SET last_scan_at=?, last_scan_msg=?, updated_at=? WHERE id=?`)
    .run(nowISO(), msg, nowISO(), sourceId);

  return { ...stats, message: msg };
}

/** Absolute path of an indexed file, checked against its source root. */
export function localPathOf(file) {
  const source = get('sources', file.source_id);
  if (!source || source.kind !== 'folder') return null;
  const root = source.subpath
    ? safeResolve(source.root_path, source.subpath)
    : resolve(source.root_path);
  return safeResolve(root, file.rel_path);
}

export { readWebdavFile, createReadStream };
