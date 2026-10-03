/**
 * LaserLog — sources and the file catalogue.
 */
import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  db, upsert, get, softDelete, newId, nowISO, listLive, UPLOAD_DIR,
} from '../db.js';
import { ENTRY_FIELDS, wrap } from './crud.js';
import { scanSource, localPathOf, readWebdavFile, classify } from '../files.js';

export const filesRouter = Router();
export const sourcesRouter = Router();

const SOURCE_FIELDS = ['name', 'kind', 'root_path', 'url', 'username', 'password',
                       'subpath', 'enabled', 'exclude'];

/** Never hand the WebDAV password back out, not even to a signed-in user. */
const publicSource = (s) => {
  if (!s) return s;
  const { password, ...rest } = s;
  return { ...rest, has_password: Boolean(password) };
};

/* ---------------------------------------------------------- sources */

sourcesRouter.get('/', (_req, res) => {
  res.json(listLive('sources', { orderBy: 'name COLLATE NOCASE' }).map(publicSource));
});

sourcesRouter.post('/', (req, res) => {
  try {
    const row = upsert('sources', SOURCE_FIELDS, req.body || {});
    res.status(201).json(publicSource(row));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

sourcesRouter.put('/:id', (req, res) => {
  const existing = get('sources', req.params.id);
  if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
  const body = { ...(req.body || {}) };
  // An empty password field means "leave it alone", not "clear it".
  if (body.password === '' || body.password === null) delete body.password;
  try {
    const row = upsert('sources', SOURCE_FIELDS, body, req.params.id);
    res.json(publicSource(row));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

sourcesRouter.delete('/:id', (req, res) => {
  const ok = softDelete('sources', req.params.id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  // The catalogue goes with it; the actual files are untouched.
  db.prepare(`DELETE FROM files WHERE source_id=?`).run(req.params.id);
  res.json({ ok: true });
});

/** Check we can actually see the folder / log in, before a full scan. */
sourcesRouter.post('/:id/test', wrap(async (req, res) => {
  const s = get('sources', req.params.id);
  if (!s || s.deleted_at) return res.status(404).json({ error: 'not_found' });
  try {
    if (s.kind === 'webdav') {
      if (!s.url || !s.username || !s.password) throw new Error('webdav_not_configured');
      const base = s.url.replace(/\/+$/, '');
      const r = await fetch(`${base}/remote.php/dav/files/${encodeURIComponent(s.username)}/`, {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          Authorization: 'Basic ' + Buffer.from(`${s.username}:${s.password}`).toString('base64'),
        },
      });
      if (r.status === 401) throw new Error('Login refused — check the username and app password.');
      if (!r.ok) throw new Error(`Nextcloud replied ${r.status}.`);
      return res.json({ ok: true, message: 'Connected to Nextcloud.' });
    }
    if (!s.root_path) throw new Error('No folder set.');
    const st = await stat(s.root_path);
    if (!st.isDirectory()) throw new Error('That path is not a folder.');
    return res.json({ ok: true, message: `Folder is readable.` });
  } catch (e) {
    const msg = e.code === 'ENOENT'
      ? 'Not found inside the container — check the volume mount.'
      : e.code === 'EACCES'
        ? 'Permission denied — check PUID/PGID or mount it read-only for everyone.'
        : e.message;
    res.status(400).json({ ok: false, error: msg });
  }
}));

sourcesRouter.post('/:id/scan', wrap(async (req, res) => {
  try {
    const result = await scanSource(req.params.id);
    res.json(result);
  } catch (e) {
    const msg = e.code === 'ENOENT'
      ? 'Folder not found inside the container — check the volume mount.'
      : e.detail || e.message;
    res.status(400).json({ error: msg, kept: e.kept });
  }
}));

/* ------------------------------------------------------------ files */

const fileTags = (id) =>
  db.prepare(
    `SELECT t.name FROM tags t JOIN file_tags ft ON ft.tag_id=t.id
      WHERE ft.file_id=? ORDER BY t.name COLLATE NOCASE`
  ).all(id).map((r) => r.name);

function setFileTags(fileId, names) {
  if (!Array.isArray(names)) return;
  db.prepare(`DELETE FROM file_tags WHERE file_id=?`).run(fileId);
  const findTag = db.prepare(`SELECT id FROM tags WHERE name=? COLLATE NOCASE`);
  const insTag = db.prepare(`INSERT INTO tags (id, name) VALUES (?,?)`);
  const link = db.prepare(`INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?,?)`);
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name) continue;
    let t = findTag.get(name);
    if (!t) { const id = newId(); insTag.run(id, name); t = { id }; }
    link.run(fileId, t.id);
  }
}

const hydrateFile = (f) => ({
  ...f,
  meta: f.meta_json ? safeJson(f.meta_json) : null,
  meta_json: undefined,
  tags: fileTags(f.id),
  material_name: f.material_id
    ? db.prepare(`SELECT name FROM materials WHERE id=?`).get(f.material_id)?.name ?? null : null,
  machine_name: f.machine_id
    ? db.prepare(`SELECT name FROM machines WHERE id=?`).get(f.machine_id)?.name ?? null : null,
  project_name: f.project_id
    ? db.prepare(`SELECT name FROM projects WHERE id=?`).get(f.project_id)?.name ?? null : null,
  entry_count: db.prepare(`SELECT COUNT(*) n FROM file_entries WHERE file_id=?`).get(f.id).n,
});

const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

filesRouter.get('/', (req, res) => {
  const { q, kind, category, source_id, tag, favorite, missing, uncategorized } = req.query;
  const where = ['f.deleted_at IS NULL'];
  const params = {};

  if (kind) { where.push('f.kind = @kind'); params.kind = kind; }
  if (source_id) { where.push('f.source_id = @source_id'); params.source_id = source_id; }
  if (category) { where.push('f.category = @category'); params.category = category; }
  if (uncategorized === '1') where.push("(f.category IS NULL OR f.category = '')");
  if (favorite === '1') where.push('f.is_favorite = 1');
  if (missing === '1') where.push('f.missing = 1');
  else if (missing !== 'include') where.push('f.missing = 0');
  if (tag) {
    where.push(`f.id IN (SELECT ft.file_id FROM file_tags ft JOIN tags t ON t.id=ft.tag_id
                          WHERE t.name = @tag COLLATE NOCASE)`);
    params.tag = tag;
  }
  if (q) {
    where.push('(f.name LIKE @q OR f.rel_path LIKE @q OR f.category LIKE @q OR f.notes LIKE @q)');
    params.q = `%${q}%`;
  }

  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const offset = Number(req.query.offset) || 0;

  const rows = db.prepare(
    `SELECT f.* FROM files f WHERE ${where.join(' AND ')}
      ORDER BY f.is_favorite DESC, f.folder COLLATE NOCASE, f.name COLLATE NOCASE
      LIMIT ${limit} OFFSET ${offset}`
  ).all(params);

  const total = db.prepare(
    `SELECT COUNT(*) n FROM files f WHERE ${where.join(' AND ')}`
  ).get(params).n;

  res.json({ total, limit, offset, files: rows.map(hydrateFile) });
});

/** Counts for the filter chips. */
filesRouter.get('/facets', (_req, res) => {
  res.json({
    kinds: db.prepare(
      `SELECT kind, COUNT(*) n FROM files WHERE deleted_at IS NULL AND missing=0
        GROUP BY kind ORDER BY n DESC`
    ).all(),
    categories: db.prepare(
      `SELECT category, COUNT(*) n FROM files
        WHERE deleted_at IS NULL AND missing=0 AND category IS NOT NULL AND category <> ''
        GROUP BY category ORDER BY n DESC, category COLLATE NOCASE LIMIT 60`
    ).all(),
    uncategorized: db.prepare(
      `SELECT COUNT(*) n FROM files
        WHERE deleted_at IS NULL AND missing=0 AND (category IS NULL OR category='')`
    ).get().n,
    missing: db.prepare(
      `SELECT COUNT(*) n FROM files WHERE deleted_at IS NULL AND missing=1`
    ).get().n,
  });
});

filesRouter.get('/:id', (req, res) => {
  const f = get('files', req.params.id);
  if (!f || f.deleted_at) return res.status(404).json({ error: 'not_found' });
  res.json(hydrateFile(f));
});

export const FILE_FIELDS = ['category', 'notes', 'is_favorite', 'material_id',
                            'machine_id', 'project_id'];

filesRouter.put('/:id', (req, res) => {
  const f = get('files', req.params.id);
  if (!f || f.deleted_at) return res.status(404).json({ error: 'not_found' });
  const row = upsert('files', FILE_FIELDS, req.body || {}, req.params.id);
  setFileTags(row.id, req.body?.tags);
  res.json(hydrateFile(get('files', row.id)));
});

/**
 * Categorise a pile at once. This is the whole point of the screen: you come
 * back from a scan with 400 files and want them sorted in a few gestures.
 */
filesRouter.post('/bulk', (req, res) => {
  const { ids, set = {}, add_tags = [], remove_tags = [] } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'no_ids' });

  const ts = nowISO();
  let changed = 0;

  const run = db.transaction(() => {
    const fields = FILE_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(set, k));
    for (const id of ids) {
      const f = get('files', id);
      if (!f || f.deleted_at) continue;
      if (fields.length) {
        const sets = fields.map((k) => `${k}=@${k}`).join(', ');
        const payload = { id, updated_at: ts };
        for (const k of fields) payload[k] = set[k];
        db.prepare(`UPDATE files SET ${sets}, updated_at=@updated_at WHERE id=@id`).run(payload);
      }
      for (const name of add_tags) {
        const clean = String(name || '').trim();
        if (!clean) continue;
        let t = db.prepare(`SELECT id FROM tags WHERE name=? COLLATE NOCASE`).get(clean);
        if (!t) { const tid = newId(); db.prepare(`INSERT INTO tags (id,name) VALUES (?,?)`).run(tid, clean); t = { id: tid }; }
        db.prepare(`INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?,?)`).run(id, t.id);
      }
      for (const name of remove_tags) {
        const t = db.prepare(`SELECT id FROM tags WHERE name=? COLLATE NOCASE`).get(String(name).trim());
        if (t) db.prepare(`DELETE FROM file_tags WHERE file_id=? AND tag_id=?`).run(id, t.id);
      }
      if (!fields.length) db.prepare(`UPDATE files SET updated_at=? WHERE id=?`).run(ts, id);
      changed++;
    }
  });
  run();

  res.json({ ok: true, changed });
});

/** Drop a file from the catalogue. The file itself is never touched. */
filesRouter.delete('/:id', (req, res) => {
  const ok = softDelete('files', req.params.id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, note: 'Removed from the catalogue. The file on disk is untouched.' });
});

/* ------------------------------------------------- download / preview */

const MIME = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.csv': 'text/csv', '.md': 'text/markdown',
  '.lbrn': 'application/xml', '.lbrn2': 'application/xml', '.dxf': 'application/dxf',
};

/**
 * Build a Content-Disposition value that Node will actually accept.
 *
 * HTTP header values are Latin-1 with no control characters. A real folder of
 * design files is full of accents, em-dashes, emoji and the occasional stray
 * newline, and handing any of those to setHeader throws ERR_INVALID_CHAR —
 * which took the whole container down rather than failing one download.
 *
 * So: an ASCII-only `filename=` that every client understands, plus the
 * RFC 5987 `filename*=` form carrying the real name for clients that read it.
 * Stripping control characters here also closes off header injection from a
 * filename that came off someone else's filesystem.
 */
export function contentDisposition(name, inline = false) {
  const raw = String(name || 'file');
  const base = raw.includes('/') || raw.includes('\\') ? basename(raw) : raw;

  const ascii = base
    .replace(/[^\x20-\x7e]/g, '_')        // anything not printable ASCII
    .replace(/["\\]/g, '_')               // quotes and backslashes break the quoted string
    .trim() || 'file';

  const utf8 = encodeURIComponent(base)
    .replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Stream one indexed file out, from disk or from Nextcloud over WebDAV. */
async function sendFileRaw(f, res, next, { inline = false } = {}) {
  const source = get('sources', f.source_id);
  if (!source) return res.status(404).json({ error: 'source_gone' });

  res.setHeader('Content-Type', MIME[f.ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(f.name, inline));
  // SVGs can carry script; never let one run against this origin.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    if (source.kind === 'webdav') {
      const buf = await readWebdavFile(source, f.rel_path);
      return res.end(buf);
    }
    const abs = localPathOf(f);            // re-validates the path under the root
    await stat(abs);
    createReadStream(abs).on('error', next).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(404).json({ error: 'unreadable', detail: e.message });
  }
}

filesRouter.get('/:id/raw', wrap(async (req, res, next) => {
  const f = get('files', req.params.id);
  if (!f || f.deleted_at) return res.status(404).json({ error: 'not_found' });
  await sendFileRaw(f, res, next, { inline: req.query.inline === '1' });
}));

/**
 * Preview image. LightBurn projects carry their own thumbnail, which the scan
 * extracted; plain images are served as-is and scaled down by the browser.
 */
filesRouter.get('/:id/thumb', wrap(async (req, res, next) => {
  const f = get('files', req.params.id);
  if (!f || f.deleted_at) return res.status(404).json({ error: 'not_found' });

  if (f.thumb) {
    res.setHeader('Cache-Control', 'private, max-age=86400');
    try {
      return res.sendFile(resolve(UPLOAD_DIR, basename(f.thumb)), (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: 'no_thumb' });
      });
    } catch {
      return res.status(404).json({ error: 'no_thumb' });
    }
  }
  if (f.kind === 'image' || f.ext === '.svg') {
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return sendFileRaw(f, res, next, { inline: true });
  }
  res.status(404).json({ error: 'no_thumb' });
}));

/* ------------------------------------------- LightBurn → library */

/**
 * Turn the cut settings found inside a LightBurn project into real library
 * entries, linked back to the file they came from.
 */
filesRouter.post('/:id/import-settings', (req, res) => {
  const f = get('files', req.params.id);
  if (!f || f.deleted_at) return res.status(404).json({ error: 'not_found' });
  const meta = f.meta_json ? safeJson(f.meta_json) : null;
  if (!meta?.cut_settings?.length) return res.status(400).json({ error: 'no_settings_in_file' });

  const wanted = Array.isArray(req.body?.indexes) ? new Set(req.body.indexes) : null;
  const { material_id = null, machine_id = f.machine_id || null } = req.body || {};

  const created = [];
  const run = db.transaction(() => {
    for (const cs of meta.cut_settings) {
      if (wanted && !wanted.has(cs.index)) continue;

      const opType = String(cs.type || '').toLowerCase();
      const operation = opType.includes('scan') ? 'engrave'
                      : opType.includes('img') ? 'photo'
                      : opType.includes('offset') ? 'fill'
                      : 'cut';

      const entry = upsert('entries', ENTRY_FIELDS, {
        title: `${f.name.replace(/\.[^.]+$/, '')}${cs.name ? ` — ${cs.name}` : ''}`,
        machine_id,
        material_id: material_id || f.material_id || null,
        operation,
        speed: cs.speed,
        speed_unit: cs.speed_unit || 'mm/s',
        power_max: cs.power_max,
        power_min: cs.power_min,
        passes: cs.passes,
        line_interval_mm: cs.interval,
        dpi: cs.dpi,
        air_assist: cs.air_assist ?? 0,
        z_step_mm: cs.z_per_pass,
        focus_offset_mm: cs.z_offset,
        frequency_khz: cs.frequency_khz,
        pulse_width_ns: cs.pulse_width_ns,
        kerf_mm: cs.kerf_mm,
        notes: [`Imported from ${f.rel_path}`, meta.notes].filter(Boolean).join('\n'),
      });
      db.prepare(`INSERT OR IGNORE INTO file_entries (file_id, entry_id) VALUES (?,?)`)
        .run(f.id, entry.id);
      created.push(entry.id);
    }
  });
  run();

  res.status(201).json({
    ok: true,
    created: created.length,
    note: 'LightBurn stores speed in mm/sec — imported entries use those units.',
  });
});

/** Entries that came from, or were linked to, this file. */
filesRouter.get('/:id/entries', (req, res) => {
  const rows = db.prepare(
    `SELECT e.*, mc.name AS machine_name, mt.name AS material_name
       FROM entries e
       JOIN file_entries fe ON fe.entry_id = e.id
       LEFT JOIN machines  mc ON mc.id = e.machine_id
       LEFT JOIN materials mt ON mt.id = e.material_id
      WHERE fe.file_id = ? AND e.deleted_at IS NULL ORDER BY e.updated_at DESC`
  ).all(req.params.id);
  res.json(rows);
});

filesRouter.post('/:id/link-entry', (req, res) => {
  const { entry_id } = req.body || {};
  if (!entry_id) return res.status(400).json({ error: 'entry_id_required' });
  db.prepare(`INSERT OR IGNORE INTO file_entries (file_id, entry_id) VALUES (?,?)`)
    .run(req.params.id, entry_id);
  res.json({ ok: true });
});

filesRouter.delete('/:id/link-entry/:entryId', (req, res) => {
  db.prepare(`DELETE FROM file_entries WHERE file_id=? AND entry_id=?`)
    .run(req.params.id, req.params.entryId);
  res.json({ ok: true });
});
