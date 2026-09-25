/**
 * Generic REST resource: list / get / create / update / delete.
 * Deletes are soft, so other devices pick the removal up on the next sync.
 */
import { Router } from 'express';
import { db, upsert, get, softDelete, nowISO } from '../db.js';

export function crudRouter(table, fields, opts = {}) {
  const r = Router();
  const orderBy = opts.orderBy || 'updated_at DESC';

  r.get('/', (req, res) => {
    const includeArchived = req.query.archived === '1';
    let sql = `SELECT * FROM ${table} WHERE deleted_at IS NULL`;
    const hasArchived = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === 'archived');
    if (hasArchived && !includeArchived) sql += ` AND archived = 0`;
    sql += ` ORDER BY ${orderBy}`;
    res.json(db.prepare(sql).all());
  });

  r.get('/:id', (req, res) => {
    const row = get(table, req.params.id);
    if (!row || row.deleted_at) return res.status(404).json({ error: 'not_found' });
    res.json(opts.hydrate ? opts.hydrate(row) : row);
  });

  r.post('/', (req, res) => {
    try {
      const row = upsert(table, fields, req.body || {});
      if (opts.afterWrite) opts.afterWrite(row, req.body || {});
      res.status(201).json(opts.hydrate ? opts.hydrate(row) : row);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.put('/:id', (req, res) => {
    const existing = get(table, req.params.id);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    try {
      const row = upsert(table, fields, req.body || {}, req.params.id);
      if (opts.afterWrite) opts.afterWrite(row, req.body || {});
      res.json(opts.hydrate ? opts.hydrate(row) : row);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.delete('/:id', (req, res) => {
    const ok = softDelete(table, req.params.id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id: req.params.id, deleted_at: nowISO() });
  });

  return r;
}

/**
 * Express 4 does not catch a rejected promise from an async handler — it
 * escapes to the process, and Node 22 kills the process on an unhandled
 * rejection. Every async route goes through this so a bad request returns
 * a 500 instead of restarting the container.
 */
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const MACHINE_FIELDS = [
  'name', 'kind', 'power_w', 'bed_w_mm', 'bed_h_mm', 'controller',
  'speed_unit', 'notes', 'color', 'archived',
  'role', 'wavelength_nm', 'eyewear_od', 'eyewear_note', 'has_gas_assist',
  'source_type', 'hours', 'serial',
  'max_speed', 'source_brand', 'spot_size_mm', 'freq_min_khz', 'freq_max_khz',
  'lens_mm', 'pulse_widths_ns',
];

export const MATERIAL_FIELDS = [
  'name', 'category', 'thickness_mm', 'color', 'brand', 'supplier', 'url',
  'cost', 'cost_unit', 'sheet_w_mm', 'sheet_h_mm', 'notes', 'archived',
  'grade', 'reflective', 'coated', 'hazard', 'hazard_note',
];

export const ENTRY_FIELDS = [
  'title', 'machine_id', 'material_id', 'operation', 'speed', 'speed_unit',
  'power_max', 'power_min', 'passes', 'line_interval_mm', 'dpi', 'air_assist',
  'focus_offset_mm', 'z_step_mm', 'pass_depth_mm', 'frequency_khz',
  'pulse_width_ns', 'kerf_mm', 'rating', 'outcome', 'notes', 'is_favorite',
  // fiber cutting
  'assist_gas', 'gas_pressure_bar', 'nozzle_mm', 'nozzle_type', 'standoff_mm',
  'pierce_time_ms', 'pierce_power', 'pierce_height_mm', 'lens_mm', 'power_w',
  // galvo / MOPA marking
  'hatch_angle_deg', 'hatch_cross', 'bidir', 'wobble_on', 'wobble_amp_mm',
  'wobble_freq_hz', 'color_result', 'color_hex',
  // how the edge came out
  'dross', 'taper_note', 'edge_quality',
  // what makes a fiber setting non-transferable
  'rotary', 'rotary_diameter_mm',
];

export const MAINTENANCE_FIELDS = [
  'machine_id', 'kind', 'what', 'date', 'hours_at', 'interval_days',
  'interval_hours', 'cost', 'part_number', 'notes',
];

export const FINISH_FIELDS = [
  'name', 'kind', 'substrate', 'brand', 'product', 'color', 'color_hex',
  'mask', 'application', 'coats', 'dry_minutes', 'cure_hours', 'removal',
  'supply_id', 'qty_per_use', 'rating', 'notes', 'archived',
];

export const PROJECT_FIELDS = [
  'name', 'client', 'file_name', 'machine_id', 'material_id', 'qty',
  'run_time_min', 'material_cost', 'other_cost', 'sale_price', 'status',
  'date', 'notes',
];

export const TEST_FIELDS = [
  'name', 'machine_id', 'material_id', 'operation', 'x_axis', 'x_min', 'x_max',
  'x_steps', 'y_axis', 'y_min', 'y_max', 'y_steps', 'fixed_json',
  'winner_col', 'winner_row', 'notes', 'rotary', 'lens_mm',
];
