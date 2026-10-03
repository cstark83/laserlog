/**
 * LaserLog — API surface.
 */
import { Router } from 'express';
import multer from 'multer';
import { basename, extname, join } from 'node:path';
import { unlink, writeFile } from 'node:fs/promises';
import {
  db, upsert, get, softDelete, newId, nowISO, listLive,
  SYNC_TABLES, UPLOAD_DIR,
} from '../db.js';
import {
  wrap, crudRouter, MACHINE_FIELDS, MATERIAL_FIELDS, ENTRY_FIELDS,
  PROJECT_FIELDS, TEST_FIELDS, MAINTENANCE_FIELDS, FINISH_FIELDS,
} from './crud.js';
import { filesRouter, sourcesRouter, FILE_FIELDS } from './files.js';
import { suppliesRouter, productsRouter, pricingRouter } from './shop.js';
import { buildLbrn, buildSvg, buildLegend } from '../gridgen.js';
import { takeBackup, pruneBackups, listBackups, verifyBackup } from '../backup.js';

export const api = Router();

api.use('/sources', sourcesRouter);
api.use('/files', filesRouter);
api.use('/supplies', suppliesRouter);
api.use('/products', productsRouter);
api.use('/pricing', pricingRouter);

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

api.use('/machines', crudRouter('machines', MACHINE_FIELDS, { orderBy: 'name COLLATE NOCASE' }));
api.use('/maintenance', crudRouter('maintenance', MAINTENANCE_FIELDS, {
  orderBy: 'date DESC, updated_at DESC',
}));
api.use('/materials', crudRouter('materials', MATERIAL_FIELDS, {
  orderBy: 'name COLLATE NOCASE, thickness_mm',
}));
api.use('/projects', crudRouter('projects', PROJECT_FIELDS, { orderBy: 'date DESC, updated_at DESC' }));
api.use('/finishes', crudRouter('finishes', FINISH_FIELDS, { orderBy: 'name COLLATE NOCASE' }));

/* ---------------------------- entries ----------------------------- */

const entryTags = (entryId) =>
  db.prepare(
    `SELECT t.name FROM tags t
       JOIN entry_tags et ON et.tag_id = t.id
      WHERE et.entry_id = ?
      ORDER BY t.name COLLATE NOCASE`
  ).all(entryId).map((r) => r.name);

const entryPhotos = (entryId) =>
  db.prepare(
    `SELECT id, filename, caption FROM photos
      WHERE entity_type='entry' AND entity_id=? AND deleted_at IS NULL
      ORDER BY created_at`
  ).all(entryId);

const entryFiles = (entryId) =>
  db.prepare(
    `SELECT f.id, f.name, f.rel_path, f.ext, f.kind, f.thumb, f.category
       FROM files f JOIN file_entries fe ON fe.file_id = f.id
      WHERE fe.entry_id = ? AND f.deleted_at IS NULL
      ORDER BY f.name COLLATE NOCASE`
  ).all(entryId);

/** Replace the full set of files linked to an entry — same shape as setEntryTags. */
function setEntryFiles(entryId, fileIds) {
  if (!Array.isArray(fileIds)) return;
  db.prepare(`DELETE FROM file_entries WHERE entry_id=?`).run(entryId);
  const link = db.prepare(`INSERT OR IGNORE INTO file_entries (file_id, entry_id) VALUES (?,?)`);
  for (const fileId of fileIds) {
    const id = String(fileId || '').trim();
    if (id) link.run(id, entryId);
  }
}

function setEntryTags(entryId, names) {
  if (!Array.isArray(names)) return;
  db.prepare(`DELETE FROM entry_tags WHERE entry_id=?`).run(entryId);
  const findTag = db.prepare(`SELECT id FROM tags WHERE name=? COLLATE NOCASE`);
  const insTag = db.prepare(`INSERT INTO tags (id, name) VALUES (?,?)`);
  const link = db.prepare(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`);
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name) continue;
    let t = findTag.get(name);
    if (!t) {
      const id = newId();
      insTag.run(id, name);
      t = { id };
    }
    link.run(entryId, t.id);
  }
}

const hydrateEntry = (row) => {
  // One lookup, not three — and it carries the hazard flag so the detail view
  // can warn without a second round trip.
  const mat = row.material_id
    ? db.prepare(`SELECT name, thickness_mm, hazard, hazard_note
                    FROM materials WHERE id=?`).get(row.material_id)
    : null;
  return {
    ...row,
    tags: entryTags(row.id),
    photos: entryPhotos(row.id),
    files: entryFiles(row.id),
    machine_name: row.machine_id
      ? db.prepare(`SELECT name FROM machines WHERE id=?`).get(row.machine_id)?.name ?? null
      : null,
    material_name: mat?.name ?? null,
    material_thickness: mat?.thickness_mm ?? null,
    material_hazard: mat?.hazard ?? null,
    material_hazard_note: mat?.hazard_note ?? null,
  };
};

// Search must be declared before the generic crud router claims '/:id'.
const entriesRouter = Router();

entriesRouter.get('/', (req, res) => {
  const { q, machine_id, material_id, operation, favorite, outcome, tag, min_rating } = req.query;
  const where = ['e.deleted_at IS NULL'];
  const params = {};

  if (machine_id) { where.push('e.machine_id = @machine_id'); params.machine_id = machine_id; }
  if (material_id) { where.push('e.material_id = @material_id'); params.material_id = material_id; }
  if (operation) { where.push('e.operation = @operation'); params.operation = operation; }
  if (outcome) { where.push('e.outcome = @outcome'); params.outcome = outcome; }
  if (favorite === '1') where.push('e.is_favorite = 1');
  if (min_rating) { where.push('e.rating >= @min_rating'); params.min_rating = Number(min_rating); }
  if (tag) {
    where.push(`e.id IN (SELECT et.entry_id FROM entry_tags et
                           JOIN tags t ON t.id = et.tag_id
                          WHERE t.name = @tag COLLATE NOCASE)`);
    params.tag = tag;
  }
  if (q) {
    where.push(`(
      e.title LIKE @q OR e.notes LIKE @q OR e.operation LIKE @q
      OR mt.name LIKE @q OR mt.category LIKE @q OR mt.brand LIKE @q
      OR mc.name LIKE @q
    )`);
    params.q = `%${q}%`;
  }

  const rows = db.prepare(
    `SELECT e.* FROM entries e
       LEFT JOIN materials mt ON mt.id = e.material_id
       LEFT JOIN machines  mc ON mc.id = e.machine_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.is_favorite DESC, e.updated_at DESC`
  ).all(params);

  res.json(rows.map(hydrateEntry));
});

entriesRouter.get('/:id', (req, res) => {
  const row = get('entries', req.params.id);
  if (!row || row.deleted_at) return res.status(404).json({ error: 'not_found' });
  res.json(hydrateEntry(row));
});

entriesRouter.post('/', (req, res) => {
  try {
    const row = upsert('entries', ENTRY_FIELDS, req.body || {});
    setEntryTags(row.id, req.body?.tags);
    if (Array.isArray(req.body?.file_ids)) setEntryFiles(row.id, req.body.file_ids);
    res.status(201).json(hydrateEntry(get('entries', row.id)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

entriesRouter.put('/:id', (req, res) => {
  const existing = get('entries', req.params.id);
  if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
  try {
    const row = upsert('entries', ENTRY_FIELDS, req.body || {}, req.params.id);
    setEntryTags(row.id, req.body?.tags);
    if (Array.isArray(req.body?.file_ids)) setEntryFiles(row.id, req.body.file_ids);
    res.json(hydrateEntry(get('entries', row.id)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

entriesRouter.post('/:id/duplicate', (req, res) => {
  const src = get('entries', req.params.id);
  if (!src || src.deleted_at) return res.status(404).json({ error: 'not_found' });
  const copy = { ...src };
  delete copy.id;
  copy.title = (src.title || 'Untitled') + ' (copy)';
  const row = upsert('entries', ENTRY_FIELDS, copy);
  setEntryTags(row.id, entryTags(src.id));
  setEntryFiles(row.id, entryFiles(src.id).map((f) => f.id));
  res.status(201).json(hydrateEntry(get('entries', row.id)));
});

entriesRouter.delete('/:id', (req, res) => {
  const ok = softDelete('entries', req.params.id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, id: req.params.id });
});

api.use('/entries', entriesRouter);

/* ----------------------------- tests ------------------------------ */

const testsRouter = Router();

const hydrateTest = (row) => ({
  ...row,
  cells: db.prepare(`SELECT * FROM test_cells WHERE test_id=? ORDER BY row, col`).all(row.id),
  photos: db.prepare(
    `SELECT id, filename, caption FROM photos
      WHERE entity_type='test' AND entity_id=? AND deleted_at IS NULL ORDER BY created_at`
  ).all(row.id),
});

testsRouter.get('/', (_req, res) => res.json(listLive('tests', { orderBy: 'updated_at DESC' })));

testsRouter.get('/:id', (req, res) => {
  const row = get('tests', req.params.id);
  if (!row || row.deleted_at) return res.status(404).json({ error: 'not_found' });
  res.json(hydrateTest(row));
});

testsRouter.post('/', (req, res) => {
  const row = upsert('tests', TEST_FIELDS, req.body || {});
  res.status(201).json(hydrateTest(row));
});

testsRouter.put('/:id', (req, res) => {
  const existing = get('tests', req.params.id);
  if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
  const row = upsert('tests', TEST_FIELDS, req.body || {}, req.params.id);
  res.json(hydrateTest(row));
});

testsRouter.delete('/:id', (req, res) => {
  const ok = softDelete('tests', req.params.id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

/** Record the outcome of one square in the grid. */
testsRouter.put('/:id/cells/:col/:row', (req, res) => {
  const { id, col, row } = req.params;
  const test = get('tests', id);
  if (!test || test.deleted_at) return res.status(404).json({ error: 'not_found' });
  const ts = nowISO();
  const existing = db
    .prepare(`SELECT * FROM test_cells WHERE test_id=? AND col=? AND row=?`)
    .get(id, Number(col), Number(row));
  const b = req.body || {};
  if (existing) {
    db.prepare(
      `UPDATE test_cells SET x_value=?, y_value=?, rating=?, outcome=?, notes=?, updated_at=?
        WHERE id=?`
    ).run(b.x_value ?? existing.x_value, b.y_value ?? existing.y_value,
          b.rating ?? existing.rating, b.outcome ?? existing.outcome,
          b.notes ?? existing.notes, ts, existing.id);
    return res.json(db.prepare(`SELECT * FROM test_cells WHERE id=?`).get(existing.id));
  }
  const cellId = newId();
  db.prepare(
    `INSERT INTO test_cells (id, test_id, col, row, x_value, y_value, rating, outcome, notes, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(cellId, id, Number(col), Number(row), b.x_value ?? null, b.y_value ?? null,
        b.rating ?? 0, b.outcome ?? null, b.notes ?? null, ts);
  db.prepare(`UPDATE tests SET updated_at=? WHERE id=?`).run(ts, id);
  res.status(201).json(db.prepare(`SELECT * FROM test_cells WHERE id=?`).get(cellId));
});

/** Promote the winning square into a real saved settings entry. */
testsRouter.post('/:id/promote', (req, res) => {
  const test = get('tests', req.params.id);
  if (!test || test.deleted_at) return res.status(404).json({ error: 'not_found' });
  const { col, row } = req.body || {};
  const cell = db
    .prepare(`SELECT * FROM test_cells WHERE test_id=? AND col=? AND row=?`)
    .get(test.id, Number(col), Number(row));
  if (!cell) return res.status(404).json({ error: 'cell_not_found' });

  const fixed = test.fixed_json ? JSON.parse(test.fixed_json) : {};
  const payload = {
    ...fixed,
    title: `${test.name} — winner`,
    machine_id: test.machine_id,
    material_id: test.material_id,
    operation: test.operation,
    rating: cell.rating || 5,
    outcome: cell.outcome || 'success',
    notes: [test.notes, cell.notes].filter(Boolean).join('\n'),
  };
  const axisMap = {
    speed: 'speed', power: 'power_max', passes: 'passes',
    interval: 'line_interval_mm', focus: 'focus_offset_mm', dpi: 'dpi',
  };
  if (axisMap[test.x_axis]) payload[axisMap[test.x_axis]] = cell.x_value;
  if (axisMap[test.y_axis]) payload[axisMap[test.y_axis]] = cell.y_value;

  const entry = upsert('entries', ENTRY_FIELDS, payload);
  db.prepare(`UPDATE tests SET winner_col=?, winner_row=?, updated_at=? WHERE id=?`)
    .run(Number(col), Number(row), nowISO(), test.id);
  res.status(201).json(hydrateEntry(entry));
});

/**
 * Download the grid as a file you can actually run.
 * ?format=lbrn (default) | svg | legend, plus cell/gap sizing in mm.
 */
testsRouter.get('/:id/file', (req, res) => {
  const test = get('tests', req.params.id);
  if (!test || test.deleted_at) return res.status(404).json({ error: 'not_found' });

  const opts = {
    cell: Number(req.query.cell) || 10,
    gap: Number(req.query.gap) || 3,
    label: req.query.label !== '0',
    labelSize: Number(req.query.labelSize) || 3,
  };
  const safeName = (test.name || 'test-grid').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'test-grid';

  try {
    if (req.query.format === 'legend') return res.json(buildLegend(test));

    if (req.query.format === 'svg') {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.svg"`);
      return res.send(buildSvg(test, opts));
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.lbrn"`);
    return res.send(buildLbrn(test, opts));
  } catch (e) {
    if (String(e.message).startsWith('grid_too_large')) {
      const [, n, max] = e.message.split(':');
      return res.status(400).json({
        error: 'grid_too_large',
        message: `${n} squares — LightBurn has 30 cut layers`
               + (e.labelled ? ', and the engraved labels use one of them' : '')
               + `. Shrink the grid to ${max} squares or fewer`
               + (e.labelled ? ', or turn labels off for 30.' : '.'),
      });
    }
    return res.status(400).json({ error: e.message });
  }
});

api.use('/tests', testsRouter);

/* ----------------------------- photos ----------------------------- */

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (extname(file.originalname) || '.jpg').toLowerCase().slice(0, 6);
    cb(null, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      // Without a status this surfaces as a 500, which blames the server for
      // the caller sending a .sh file.
      const err = new Error('Only image files are allowed.');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

api.post('/photos', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const { entity_type, entity_id, caption } = req.body || {};
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_required' });
  const ts = nowISO();
  const id = newId();
  db.prepare(
    `INSERT INTO photos (id, entity_type, entity_id, filename, caption, bytes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, entity_type, entity_id, req.file.filename, caption || null, req.file.size, ts, ts);
  res.status(201).json(get('photos', id));
});

api.get('/photos', (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_required' });
  res.json(
    db.prepare(
      `SELECT * FROM photos WHERE entity_type=? AND entity_id=? AND deleted_at IS NULL
        ORDER BY created_at`
    ).all(entity_type, entity_id)
  );
});

api.delete('/photos/:id', wrap(async (req, res) => {
  const p = get('photos', req.params.id);
  if (!p || p.deleted_at) return res.status(404).json({ error: 'not_found' });
  softDelete('photos', req.params.id);
  try { await unlink(join(UPLOAD_DIR, p.filename)); } catch { /* already gone */ }
  res.json({ ok: true });
}));

/* ------------------------------ tags ------------------------------ */

api.get('/tags', (_req, res) => {
  res.json(
    db.prepare(
      `SELECT t.id, t.name, COUNT(et.entry_id) AS count
         FROM tags t LEFT JOIN entry_tags et ON et.tag_id = t.id
        GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE`
    ).all()
  );
});

/* ------------------------------ stats ----------------------------- */

api.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get().n;
  res.json({
    entries: one(`SELECT COUNT(*) n FROM entries WHERE deleted_at IS NULL`),
    machines: one(`SELECT COUNT(*) n FROM machines WHERE deleted_at IS NULL AND archived=0`),
    materials: one(`SELECT COUNT(*) n FROM materials WHERE deleted_at IS NULL AND archived=0`),
    projects: one(`SELECT COUNT(*) n FROM projects WHERE deleted_at IS NULL`),
    tests: one(`SELECT COUNT(*) n FROM tests WHERE deleted_at IS NULL`),
    photos: one(`SELECT COUNT(*) n FROM photos WHERE deleted_at IS NULL`),
    files: one(`SELECT COUNT(*) n FROM files WHERE deleted_at IS NULL AND missing=0`),
    files_uncategorized: one(
      `SELECT COUNT(*) n FROM files
        WHERE deleted_at IS NULL AND missing=0 AND (category IS NULL OR category='')`),
    favorites: one(`SELECT COUNT(*) n FROM entries WHERE deleted_at IS NULL AND is_favorite=1`),
    finishes: one(`SELECT COUNT(*) n FROM finishes WHERE deleted_at IS NULL AND archived=0`),
    files_missing: one(`SELECT COUNT(*) n FROM files WHERE deleted_at IS NULL AND missing=1`),

    // Things that want doing, for the band at the top of the bench.
    low_stock: db.prepare(
      `SELECT id, name, stock_qty, reorder_at, unit FROM supplies
        WHERE deleted_at IS NULL AND archived=0
          AND reorder_at IS NOT NULL AND IFNULL(stock_qty,0) <= reorder_at
        ORDER BY name COLLATE NOCASE LIMIT 20`).all(),

    // Date-based repeats only; the hours-based ones need the machine's current
    // hours, which the maintenance screen works out for itself.
    maintenance_due: db.prepare(
      `SELECT m.id, m.what, m.date, m.interval_days, mc.name AS machine_name
         FROM maintenance m
         LEFT JOIN machines mc ON mc.id = m.machine_id
        WHERE m.deleted_at IS NULL AND m.interval_days IS NOT NULL AND m.date IS NOT NULL
          AND julianday('now') >= julianday(m.date) + m.interval_days
        ORDER BY m.date LIMIT 20`).all(),

    recent: db.prepare(
      `SELECT e.id, e.title, e.operation, e.updated_at,
              mt.name AS material_name, mt.thickness_mm, mc.name AS machine_name
         FROM entries e
         LEFT JOIN materials mt ON mt.id = e.material_id
         LEFT JOIN machines  mc ON mc.id = e.machine_id
        WHERE e.deleted_at IS NULL
        ORDER BY e.updated_at DESC LIMIT 8`
    ).all(),
  });
});

/* ------------------------------ sync ------------------------------ */

/**
 * Delta pull. Hand back everything touched since `?since=<iso>`,
 * deletions included (they carry deleted_at).
 */
api.get('/sync', (req, res) => {
  const since = req.query.since || '1970-01-01T00:00:00.000Z';
  const out = { server_time: nowISO(), since, tables: {} };
  for (const t of SYNC_TABLES) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (!cols.includes('updated_at')) {
      out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    } else {
      out.tables[t] = db.prepare(`SELECT * FROM ${t} WHERE updated_at > ?`).all(since);
    }
  }
  res.json(out);
});

/**
 * Push a batch of offline mutations. Last write wins, compared on updated_at:
 * a queued change older than what the server already holds is reported back
 * as a conflict rather than silently clobbering the newer value.
 */
api.post('/sync', (req, res) => {
  const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
  const fieldMap = {
    machines: MACHINE_FIELDS, materials: MATERIAL_FIELDS, entries: ENTRY_FIELDS,
    projects: PROJECT_FIELDS, tests: TEST_FIELDS,
    // Files are indexed server-side, but categorising them offline should stick.
    files: FILE_FIELDS,
  };
  const results = [];

  const run = db.transaction(() => {
    for (const op of ops) {
      const { table, action, payload, client_updated_at } = op || {};
      if (!fieldMap[table]) { results.push({ ...op, status: 'skipped_table' }); continue; }
      try {
        if (action === 'delete') {
          softDelete(table, payload.id);
          results.push({ id: payload.id, table, status: 'deleted' });
          continue;
        }
        const existing = payload.id ? get(table, payload.id) : null;
        if (existing && client_updated_at && existing.updated_at > client_updated_at) {
          results.push({ id: payload.id, table, status: 'conflict', server: existing });
          continue;
        }
        const row = upsert(table, fieldMap[table], payload, payload.id);
        if (table === 'entries' && Array.isArray(payload.tags)) setEntryTags(row.id, payload.tags);
        if (table === 'entries' && Array.isArray(payload.file_ids)) setEntryFiles(row.id, payload.file_ids);
        results.push({ id: row.id, table, status: existing ? 'updated' : 'created' });
      } catch (e) {
        results.push({ id: payload?.id, table, status: 'error', error: e.message });
      }
    }
  });
  run();

  res.json({ server_time: nowISO(), results });
});

/* --------------------------- export / import ---------------------- */

api.get('/export/json', (_req, res) => {
  const out = { exported_at: nowISO(), app: 'laserlog', version: 1, tables: {} };
  for (const t of SYNC_TABLES) out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  res.setHeader('Content-Disposition',
    `attachment; filename="laserlog-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
});

api.get('/export/csv', (_req, res) => {
  const rows = db.prepare(
    `SELECT mc.name AS machine, mt.name AS material, mt.thickness_mm AS thickness_mm,
            e.operation, e.speed, e.speed_unit, e.power_max, e.power_min, e.passes,
            e.line_interval_mm, e.dpi, e.air_assist, e.focus_offset_mm, e.rating,
            e.outcome, e.title, e.notes, e.updated_at
       FROM entries e
       LEFT JOIN machines  mc ON mc.id = e.machine_id
       LEFT JOIN materials mt ON mt.id = e.material_id
      WHERE e.deleted_at IS NULL
      ORDER BY mt.name, mt.thickness_mm, e.operation`
  ).all();

  const headers = rows.length
    ? Object.keys(rows[0])
    : ['machine', 'material', 'thickness_mm', 'operation', 'speed', 'power_max'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))]
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="laserlog-settings-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

/* ------------------------------ import ---------------------------- */

/** RFC-4180-ish parser: quoted fields, doubled quotes, CRLF, embedded commas. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/** Column headings people actually use, mapped to what we store. */
const CSV_ALIASES = {
  machine: 'machine', laser: 'machine',
  material: 'material', stock: 'material',
  thickness_mm: 'thickness_mm', thickness: 'thickness_mm',
  operation: 'operation', op: 'operation', mode: 'operation',
  speed: 'speed', 'speed (mm/min)': 'speed', feed: 'speed',
  speed_unit: 'speed_unit', units: 'speed_unit',
  power_max: 'power_max', power: 'power_max', 'max power': 'power_max', 'power %': 'power_max',
  power_min: 'power_min', 'min power': 'power_min',
  passes: 'passes', 'pass count': 'passes',
  line_interval_mm: 'line_interval_mm', interval: 'line_interval_mm',
  dpi: 'dpi',
  air_assist: 'air_assist', air: 'air_assist',
  focus_offset_mm: 'focus_offset_mm', focus: 'focus_offset_mm',
  frequency_khz: 'frequency_khz', frequency: 'frequency_khz', freq: 'frequency_khz',
  pulse_width_ns: 'pulse_width_ns', 'pulse width': 'pulse_width_ns',
  lens_mm: 'lens_mm', lens: 'lens_mm',
  rating: 'rating', stars: 'rating',
  outcome: 'outcome', result: 'outcome',
  title: 'title', name: 'title', description: 'title',
  notes: 'notes', note: 'notes', comment: 'notes',
};

const truthy = (v) => /^(1|y|yes|true|on)$/i.test(String(v).trim());
const numOrNull = (v) => {
  const n = Number(String(v).replace(/[^\d.\-+eE]/g, ''));
  return String(v).trim() === '' || Number.isNaN(n) ? null : n;
};

/**
 * Import settings from a CSV. Machines and materials are matched by name and
 * created when they don't exist, so a spreadsheet someone else kept comes in
 * whole. Rows that match an existing setting on machine+material+operation+
 * speed+power are skipped rather than duplicated.
 */
api.post('/import/csv', (req, res) => {
  const text = typeof req.body === 'string' ? req.body : req.body?.csv;
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'empty_csv' });

  const rows = parseCsv(text);
  if (rows.length < 2) return res.status(400).json({ error: 'needs_a_header_row_and_at_least_one_row' });

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const mapped = header.map((h) => CSV_ALIASES[h] || null);
  if (!mapped.some(Boolean)) {
    return res.status(400).json({
      error: 'no_recognised_columns',
      saw: header,
      expected: [...new Set(Object.values(CSV_ALIASES))],
    });
  }

  const findMachine = db.prepare(`SELECT id FROM machines WHERE name=? COLLATE NOCASE AND deleted_at IS NULL`);
  const findMaterial = db.prepare(
    `SELECT id FROM materials WHERE name=? COLLATE NOCASE AND deleted_at IS NULL
        AND (? IS NULL OR thickness_mm IS ? OR thickness_mm = ?)`);
  const dupe = db.prepare(
    `SELECT id FROM entries
      WHERE deleted_at IS NULL
        AND IFNULL(machine_id,'')  = IFNULL(?,'')
        AND IFNULL(material_id,'') = IFNULL(?,'')
        AND IFNULL(operation,'')   = IFNULL(?,'')
        AND IFNULL(speed,-1)       = IFNULL(?,-1)
        AND IFNULL(power_max,-1)   = IFNULL(?,-1)`);

  const result = { rows: rows.length - 1, imported: 0, skipped: 0,
                   machines_created: 0, materials_created: 0, errors: [] };

  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const raw = {};
      rows[i].forEach((v, j) => { if (mapped[j]) raw[mapped[j]] = String(v).trim(); });

      try {
        let machineId = null;
        if (raw.machine) {
          machineId = findMachine.get(raw.machine)?.id
            ?? (result.machines_created++,
                upsert('machines', MACHINE_FIELDS, { name: raw.machine }).id);
        }

        let materialId = null;
        if (raw.material) {
          const th = raw.thickness_mm ? numOrNull(raw.thickness_mm) : null;
          materialId = findMaterial.get(raw.material, th, th, th)?.id
            ?? (result.materials_created++,
                upsert('materials', MATERIAL_FIELDS,
                       { name: raw.material, thickness_mm: th }).id);
        }

        const op = (raw.operation || '').toLowerCase() || null;
        const speed = raw.speed != null ? numOrNull(raw.speed) : null;
        const powerMax = raw.power_max != null ? numOrNull(raw.power_max) : null;

        if (dupe.get(machineId, materialId, op, speed, powerMax)) { result.skipped++; continue; }

        upsert('entries', ENTRY_FIELDS, {
          machine_id: machineId,
          material_id: materialId,
          title: raw.title || null,
          operation: op,
          speed,
          speed_unit: raw.speed_unit || 'mm/min',
          power_max: powerMax,
          power_min: raw.power_min != null ? numOrNull(raw.power_min) : null,
          passes: raw.passes != null ? numOrNull(raw.passes) : null,
          line_interval_mm: raw.line_interval_mm != null ? numOrNull(raw.line_interval_mm) : null,
          dpi: raw.dpi != null ? numOrNull(raw.dpi) : null,
          air_assist: raw.air_assist != null ? (truthy(raw.air_assist) ? 1 : 0) : null,
          focus_offset_mm: raw.focus_offset_mm != null ? numOrNull(raw.focus_offset_mm) : null,
          frequency_khz: raw.frequency_khz != null ? numOrNull(raw.frequency_khz) : null,
          pulse_width_ns: raw.pulse_width_ns != null ? numOrNull(raw.pulse_width_ns) : null,
          lens_mm: raw.lens_mm != null ? numOrNull(raw.lens_mm) : null,
          rating: raw.rating != null ? numOrNull(raw.rating) : null,
          outcome: raw.outcome || null,
          notes: raw.notes || null,
        });
        result.imported++;
      } catch (e) {
        // Row number as the person sees it in the spreadsheet: header is line 1.
        if (result.errors.length < 20) result.errors.push({ line: i + 1, error: e.message });
      }
    }
  });

  try { run(); } catch (e) { return res.status(400).json({ error: e.message }); }

  result.message = `${result.imported} imported`
    + (result.skipped ? `, ${result.skipped} already there` : '')
    + (result.machines_created ? `, ${result.machines_created} new machine${result.machines_created === 1 ? '' : 's'}` : '')
    + (result.materials_created ? `, ${result.materials_created} new material${result.materials_created === 1 ? '' : 's'}` : '')
    + (result.errors.length ? `, ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} failed` : '');
  res.json(result);
});

/* ------------------------- LightBurn library ---------------------- */

const xmlAttr = (v) => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** LightBurn's own operation names. */
const lbType = (op) => ({
  cut: 'Cut', score: 'Cut', engrave: 'Scan', fill: 'Scan', photo: 'ScanImage',
}[op] || 'Cut');

/**
 * Export the library as a LightBurn material library (.clb).
 *
 * Structure per LightBurn:
 *   <LightBurnLibrary><Material name=""><Entry Thickness="">
 *     <CutSetting type=""><speed Value=""/>…
 *
 * LightBurn works in mm/sec, so every speed is converted from the normalised
 * mm/min value rather than passed through — which is the whole reason that
 * normalisation exists.
 *
 * ?scope=proven (default) exports favourites and anything rated 4+.
 * ?scope=all exports everything. ?machine_id= limits it to one machine.
 */
api.get('/export/lightburn', (req, res) => {
  const scope = req.query.scope || 'proven';
  const where = ['e.deleted_at IS NULL'];
  const params = {};
  if (scope === 'proven') where.push('(e.is_favorite = 1 OR e.rating >= 4)');
  if (req.query.machine_id) { where.push('e.machine_id = @machine_id'); params.machine_id = req.query.machine_id; }

  const rows = db.prepare(
    `SELECT e.*, mt.name AS material_name, mt.thickness_mm, mt.grade, mc.name AS machine_name
       FROM entries e
       LEFT JOIN materials mt ON mt.id = e.material_id
       LEFT JOIN machines  mc ON mc.id = e.machine_id
      WHERE ${where.join(' AND ')}
      ORDER BY mt.name COLLATE NOCASE, mt.thickness_mm, e.operation`
  ).all(params);

  // Material → thickness → settings.
  const byMaterial = new Map();
  for (const r of rows) {
    // Append the alloy only when the name doesn't already carry it, so
    // "Stainless 304" + grade 304 doesn't become "Stainless 304 304".
    const baseName = r.material_name || 'Uncategorised';
    const matName = r.grade && !baseName.toLowerCase().includes(String(r.grade).toLowerCase())
      ? `${baseName} ${r.grade}` : baseName;
    if (!byMaterial.has(matName)) byMaterial.set(matName, new Map());
    const key = r.thickness_mm ?? '';
    const byThick = byMaterial.get(matName);
    if (!byThick.has(key)) byThick.set(key, []);
    byThick.get(key).push(r);
  }

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 '<LightBurnLibrary DisplayName="LaserLog">'];

  for (const [matName, byThick] of byMaterial) {
    lines.push(`    <Material name="${xmlAttr(matName)}">`);
    for (const [thick, entries] of byThick) {
      const attrs = thick === ''
        ? `NoThickTitle="${xmlAttr(entries[0].machine_name || 'Any thickness')}"`
        : `Thickness="${Number(thick).toFixed(4)}"`;
      const desc = entries[0].machine_name ? ` Desc="${xmlAttr(entries[0].machine_name)}"` : '';
      lines.push(`        <Entry ${attrs}${desc}>`);

      entries.forEach((e, i) => {
        // LightBurn speed is mm/sec.
        const mmMin = e.speed_mm_min ?? null;
        const speed = mmMin !== null ? mmMin / 60 : null;
        const v = [];
        const put = (tag, val) => {
          if (val === null || val === undefined || val === '') return;
          v.push(`                <${tag} Value="${xmlAttr(val)}"/>`);
        };
        put('index', i);
        put('name', e.title || e.material_name || `Setting ${i + 1}`);
        if (e.machine_name) put('subname', e.machine_name);
        put('speed', speed !== null ? Number(speed.toFixed(4)) : null);
        put('maxPower', e.power_max);
        put('minPower', e.power_min ?? e.power_max);
        put('numPasses', e.passes);
        put('interval', e.line_interval_mm);
        put('DPI', e.dpi);
        put('runBlower', e.air_assist ? 1 : 0);
        put('zOffset', e.focus_offset_mm);
        put('kerf', e.kerf_mm);
        put('angle', e.hatch_angle_deg);
        put('bidir', e.bidir);
        if (e.frequency_khz != null) put('frequency', Math.round(e.frequency_khz * 1000));
        put('QPulseWidth', e.pulse_width_ns);
        put('priority', i);

        v.unshift(`            <CutSetting type="${lbType(e.operation)}">`);
        v.push('            </CutSetting>');
        lines.push(v.join('\n'));
      });

      lines.push('        </Entry>');
    }
    lines.push('    </Material>');
  }
  lines.push('</LightBurnLibrary>');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="laserlog-${new Date().toISOString().slice(0, 10)}.clb"`);
  res.send(lines.join('\n'));
});

api.get('/backups', wrap(async (_req, res) => {
  res.json(await listBackups());
}));

/** Open a stored backup and check it would actually restore. */
api.post('/backups/:name/verify', (req, res) => {
  const name = basename(String(req.params.name));
  if (!name.endsWith('.db')) return res.status(400).json({ error: 'not_a_backup' });
  res.json(verifyBackup(name));
});

api.post('/backups', wrap(async (_req, res) => {
  try {
    const b = await takeBackup('manual');
    await pruneBackups();
    res.status(201).json(b);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

api.post('/import/json', wrap(async (req, res) => {
  const body = req.body;
  if (!body?.tables) return res.status(400).json({ error: 'bad_backup' });

  // Restore replaces rows outright, so take a snapshot first. If this fails
  // we refuse the import rather than proceed without a way back.
  let snapshot;
  try {
    snapshot = await takeBackup('pre-restore');
  } catch (e) {
    return res.status(500).json({
      error: 'Could not take a safety snapshot first, so the restore was cancelled.',
      detail: e.message,
    });
  }

  // merge  — what is in the file wins on matching ids, everything else stays
  // replace — the tables in the file are emptied first
  const mode = body.mode === 'replace' ? 'replace' : 'merge';

  const counts = {};
  const skipped = [];
  const run = db.transaction(() => {
    for (const t of SYNC_TABLES) {
      const rows = body.tables[t];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      if (mode === 'replace') db.prepare(`DELETE FROM ${t}`).run();
      let n = 0;
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => cols.includes(k));
        if (keys.length === 0) continue;
        const sql = `INSERT OR REPLACE INTO ${t} (${keys.join(',')})
                     VALUES (${keys.map((k) => `@${k}`).join(',')})`;
        // Only pass the columns this build has, or better-sqlite3 rejects the
        // whole row for an extra key from a newer export.
        const vals = {};
        for (const k of keys) vals[k] = row[k] ?? null;
        try { db.prepare(sql).run(vals); n++; } catch { skipped.push(`${t}:${row.id}`); }
      }
      counts[t] = n;
    }
  });
  try {
    run();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({
      ok: true, mode, imported: counts, snapshot: snapshot.name,
      skipped: skipped.length,
      message: `${total} rows restored (${mode})`
        + (skipped.length ? `, ${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped` : '')
        + `. Snapshot of what was here first: ${snapshot.name}`,
    });
  } catch (e) {
    res.status(400).json({ error: e.message, snapshot: snapshot.name });
  }
}));

export default api;
