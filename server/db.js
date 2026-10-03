/**
 * LaserLog — database layer
 *
 * Single SQLite file, WAL mode. Every user-facing table carries
 * updated_at + deleted_at so the /api/sync endpoint can hand the phones
 * a delta instead of the whole library.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Resolved to an absolute path: res.sendFile and several path checks refuse
// relative paths, and DATA_DIR is commonly passed as ./data in development.
export const DATA_DIR = resolve(process.env.DATA_DIR || '/data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'laserlog.db');

mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export const nowISO = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS machines (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT,                -- diode | co2 | fiber | uv | other
  power_w     REAL,
  bed_w_mm    REAL,
  bed_h_mm    REAL,
  controller  TEXT,                -- GRBL, Ruida, LightBurn Bridge, ...
  speed_unit  TEXT DEFAULT 'mm/min',
  notes       TEXT,
  color       TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT,              -- plywood, acrylic, leather, anodized alu...
  thickness_mm  REAL,
  color         TEXT,
  brand         TEXT,
  supplier      TEXT,
  url           TEXT,
  cost          REAL,
  cost_unit     TEXT,              -- per sheet, per sq ft, ...
  sheet_w_mm    REAL,
  sheet_h_mm    REAL,
  notes         TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  machine_id      TEXT REFERENCES machines(id) ON DELETE SET NULL,
  material_id     TEXT REFERENCES materials(id) ON DELETE SET NULL,
  operation       TEXT,            -- cut | engrave | score | photo | fill
  speed           REAL,
  speed_unit      TEXT DEFAULT 'mm/min',
  power_max       REAL,
  power_min       REAL,
  passes          INTEGER,
  line_interval_mm REAL,
  dpi             INTEGER,
  air_assist      INTEGER DEFAULT 0,
  focus_offset_mm REAL,
  z_step_mm       REAL,
  pass_depth_mm   REAL,
  frequency_khz   REAL,            -- fiber / CO2 PPI
  pulse_width_ns  REAL,            -- fiber
  kerf_mm         REAL,
  rating          INTEGER DEFAULT 0,   -- 0..5
  outcome         TEXT,            -- success | partial | fail
  notes           TEXT,
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  client         TEXT,
  file_name      TEXT,
  machine_id     TEXT REFERENCES machines(id) ON DELETE SET NULL,
  material_id    TEXT REFERENCES materials(id) ON DELETE SET NULL,
  qty            INTEGER DEFAULT 1,
  run_time_min   REAL,
  material_cost  REAL,
  other_cost     REAL,
  sale_price     REAL,
  status         TEXT DEFAULT 'idea',  -- idea | in_progress | done | scrapped
  date           TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE IF NOT EXISTS project_entries (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_id   TEXT NOT NULL REFERENCES entries(id)  ON DELETE CASCADE,
  PRIMARY KEY (project_id, entry_id)
);

CREATE TABLE IF NOT EXISTS tests (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  machine_id    TEXT REFERENCES machines(id)  ON DELETE SET NULL,
  material_id   TEXT REFERENCES materials(id) ON DELETE SET NULL,
  operation     TEXT,
  x_axis        TEXT,     -- 'speed' | 'power' | 'passes' | 'interval' | 'focus'
  x_min         REAL,
  x_max         REAL,
  x_steps       INTEGER,
  y_axis        TEXT,
  y_min         REAL,
  y_max         REAL,
  y_steps       INTEGER,
  fixed_json    TEXT,     -- other params held constant, as JSON
  winner_col    INTEGER,
  winner_row    INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS test_cells (
  id       TEXT PRIMARY KEY,
  test_id  TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  col      INTEGER NOT NULL,
  row      INTEGER NOT NULL,
  x_value  REAL,
  y_value  REAL,
  rating   INTEGER DEFAULT 0,
  outcome  TEXT,
  notes    TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (test_id, col, row)
);

CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,   -- entry | project | material | machine | test
  entity_id   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  caption     TEXT,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

-- A place LaserLog reads design files from. Read-only, always.
CREATE TABLE IF NOT EXISTS sources (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'folder',  -- folder | webdav
  root_path    TEXT,              -- folder: path inside the container
  url          TEXT,              -- webdav: base URL
  username     TEXT,
  password     TEXT,              -- webdav app password; never returned by the API
  subpath      TEXT,              -- optional folder within the source
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_scan_at TEXT,
  last_scan_msg TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  source_id   TEXT REFERENCES sources(id) ON DELETE CASCADE,
  rel_path    TEXT NOT NULL,
  name        TEXT NOT NULL,
  ext         TEXT,
  kind        TEXT,              -- lightburn | vector | image | gcode | model | doc | other
  size        INTEGER,
  mtime       TEXT,
  folder      TEXT,              -- parent folder, used to suggest a category
  category    TEXT,
  notes       TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
  machine_id  TEXT REFERENCES machines(id)  ON DELETE SET NULL,
  project_id  TEXT REFERENCES projects(id)  ON DELETE SET NULL,
  thumb       TEXT,              -- filename in uploads/, extracted from the file itself
  meta_json   TEXT,              -- settings pulled out of a LightBurn file
  missing     INTEGER NOT NULL DEFAULT 0,  -- was indexed before, gone at last scan
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  UNIQUE (source_id, rel_path)
);

CREATE TABLE IF NOT EXISTS file_tags (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (file_id, tag_id)
);

CREATE TABLE IF NOT EXISTS file_entries (
  file_id  TEXT NOT NULL REFERENCES files(id)   ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, entry_id)
);

-- Consumables and servicing, per machine. A fiber cutter eats protective
-- windows and nozzles; a diode needs its lens cleaned. Both are the sort of
-- thing you only remember once cut quality has already gone off.
CREATE TABLE IF NOT EXISTS maintenance (
  id           TEXT PRIMARY KEY,
  machine_id   TEXT REFERENCES machines(id) ON DELETE CASCADE,
  kind         TEXT,              -- lens | nozzle | window | belt | chiller | filter | other
  what         TEXT NOT NULL,
  date         TEXT,
  hours_at     REAL,              -- machine hours when it was done
  interval_days  INTEGER,         -- repeat every N days
  interval_hours REAL,            -- or every N machine hours
  cost         REAL,
  part_number  TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_maint_machine ON maintenance(machine_id);

CREATE INDEX IF NOT EXISTS idx_files_source   ON files(source_id);
CREATE INDEX IF NOT EXISTS idx_files_kind     ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_updated  ON files(updated_at);

CREATE INDEX IF NOT EXISTS idx_entries_machine  ON entries(machine_id);
CREATE INDEX IF NOT EXISTS idx_entries_material ON entries(material_id);
CREATE INDEX IF NOT EXISTS idx_entries_updated  ON entries(updated_at);
CREATE INDEX IF NOT EXISTS idx_entries_live     ON entries(deleted_at);
CREATE INDEX IF NOT EXISTS idx_photos_entity    ON photos(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cells_test       ON test_cells(test_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);
`;

db.exec(SCHEMA);

/* ------------------------------------------------------------------ */
/* Migrations — additive only, safe to re-run                          */
/* ------------------------------------------------------------------ */

const SCHEMA_VERSION = 8;

function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/** mm/min is the canonical unit for comparing and sorting. */
export function toMmPerMin(speed, unit) {
  const n = Number(speed);
  if (!Number.isFinite(n)) return null;
  switch (String(unit || 'mm/min')) {
    case 'mm/s': return n * 60;
    case 'in/min': return n * 25.4;
    case 'in/s': return n * 25.4 * 60;
    case 'mm/min': return n;
    default: return null;            // '%' and anything else can't be converted
  }
}

function migrate() {
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get();
  const current = row ? Number(row.value) : 0;

  if (current < 2) {
    // v2 — two machines, two very different parameter sets.

    // Normalised speed, so a mm/s marking entry and a mm/min cutting entry
    // can actually be compared instead of just sitting next to each other.
    addColumnIfMissing('entries', 'speed_mm_min', 'REAL');

    // Fiber cutting: the parameters that decide whether an edge is sellable.
    addColumnIfMissing('entries', 'assist_gas', 'TEXT');        // air|nitrogen|oxygen|argon|none
    addColumnIfMissing('entries', 'gas_pressure_bar', 'REAL');
    addColumnIfMissing('entries', 'nozzle_mm', 'REAL');
    addColumnIfMissing('entries', 'nozzle_type', 'TEXT');       // single|double
    addColumnIfMissing('entries', 'standoff_mm', 'REAL');
    addColumnIfMissing('entries', 'pierce_time_ms', 'REAL');
    addColumnIfMissing('entries', 'pierce_power', 'REAL');
    addColumnIfMissing('entries', 'pierce_height_mm', 'REAL');
    addColumnIfMissing('entries', 'lens_mm', 'REAL');           // focal length
    addColumnIfMissing('entries', 'power_w', 'REAL');           // absolute watts, not just %

    // MOPA / galvo marking.
    addColumnIfMissing('entries', 'hatch_angle_deg', 'REAL');
    addColumnIfMissing('entries', 'hatch_cross', 'INTEGER');
    addColumnIfMissing('entries', 'bidir', 'INTEGER');
    addColumnIfMissing('entries', 'wobble_on', 'INTEGER');
    addColumnIfMissing('entries', 'wobble_amp_mm', 'REAL');
    addColumnIfMissing('entries', 'wobble_freq_hz', 'REAL');
    addColumnIfMissing('entries', 'color_result', 'TEXT');      // MOPA colour marking
    addColumnIfMissing('entries', 'color_hex', 'TEXT');

    // How the edge actually came out.
    addColumnIfMissing('entries', 'dross', 'TEXT');             // none|light|heavy
    addColumnIfMissing('entries', 'taper_note', 'TEXT');
    addColumnIfMissing('entries', 'edge_quality', 'INTEGER');   // 1..5

    // Machines: wavelength and eyewear matter a great deal in a shop running
    // both 1064nm and 450nm — the safety glasses are not interchangeable.
    addColumnIfMissing('machines', 'role', 'TEXT');             // cutting|marking|engraving|mixed
    addColumnIfMissing('machines', 'wavelength_nm', 'REAL');
    addColumnIfMissing('machines', 'eyewear_od', 'TEXT');
    addColumnIfMissing('machines', 'eyewear_note', 'TEXT');
    addColumnIfMissing('machines', 'has_gas_assist', 'INTEGER');
    addColumnIfMissing('machines', 'source_type', 'TEXT');      // mopa|cw|q-switch|diode
    addColumnIfMissing('machines', 'hours', 'REAL');
    addColumnIfMissing('machines', 'serial', 'TEXT');

    // Materials: metal work needs the alloy, not just "aluminium".
    addColumnIfMissing('materials', 'grade', 'TEXT');           // 304, 316, 6061, 260 brass…
    addColumnIfMissing('materials', 'reflective', 'INTEGER');
    addColumnIfMissing('materials', 'coated', 'TEXT');          // film, anodised, powder-coated

    // Backfill the normalised speed for everything already stored.
    const rows = db.prepare(
      `SELECT id, speed, speed_unit FROM entries WHERE speed IS NOT NULL`
    ).all();
    const upd = db.prepare(`UPDATE entries SET speed_mm_min=? WHERE id=?`);
    const run = db.transaction(() => {
      for (const r of rows) upd.run(toMmPerMin(r.speed, r.speed_unit), r.id);
    });
    run();
  }

  if (current < 3) {
    // v3 — the detail that distinguishes a 100W MOPA marker from a diode
    // gantry, plus materials that should never go in either machine.

    addColumnIfMissing('machines', 'max_speed', 'REAL');        // in the machine's own unit
    addColumnIfMissing('machines', 'source_brand', 'TEXT');     // JPT, Raycus, …
    addColumnIfMissing('machines', 'spot_size_mm', 'TEXT');
    addColumnIfMissing('machines', 'freq_min_khz', 'REAL');
    addColumnIfMissing('machines', 'freq_max_khz', 'REAL');
    addColumnIfMissing('machines', 'lens_mm', 'TEXT');          // fitted / available lenses
    addColumnIfMissing('machines', 'pulse_widths_ns', 'TEXT');  // MOPA's fixed list

    // 'never' = do not put this in a laser. 'caution' = needs care.
    addColumnIfMissing('materials', 'hazard', 'TEXT');
    addColumnIfMissing('materials', 'hazard_note', 'TEXT');
  }

  if (current < 4) {
    // v4 — the two things that make a fiber setting non-transferable.
    //
    // Lens: same numbers through a 75mm and a 300mm lens give different spot
    // size and energy density, so a recipe without its lens is not reproducible.
    // Rotary: curved-surface settings do not carry over to flat work.
    addColumnIfMissing('entries', 'rotary', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('entries', 'rotary_diameter_mm', 'REAL');
    addColumnIfMissing('tests', 'rotary', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('tests', 'lens_mm', 'REAL');
  }

  if (current < 5) {
    // v5 — the shop side: what you buy, what you make from it, what to charge.
    db.exec(`
      -- Anything you purchase: sheet stock, paint, markers, tape, blanks,
      -- packaging. Distinct from the materials table, which describes what the
      -- laser is pointed at; plenty of supplies never go near the machine.
      CREATE TABLE IF NOT EXISTS supplies (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        category    TEXT,
        unit        TEXT NOT NULL DEFAULT 'each',  -- each|sheet|can|bottle|roll|ft|m|g|kg|ml|l
        sheet_w_mm  REAL,          -- when unit='sheet', lets a BOM consume area
        sheet_h_mm  REAL,
        supplier    TEXT,
        sku         TEXT,
        url         TEXT,
        stock_qty   REAL NOT NULL DEFAULT 0,
        reorder_at  REAL,
        material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
        notes       TEXT,
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );

      -- Every buy. Unit cost is derived from these rather than typed once and
      -- left to rot, so a price rise shows up in your costing by itself.
      CREATE TABLE IF NOT EXISTS purchases (
        id         TEXT PRIMARY KEY,
        supply_id  TEXT NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
        date       TEXT,
        qty        REAL NOT NULL,
        total_cost REAL NOT NULL,
        supplier   TEXT,
        notes      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      -- A product is a recipe: a bill of materials plus the time it takes.
      CREATE TABLE IF NOT EXISTS products (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        sku             TEXT,
        notes           TEXT,
        machine_id      TEXT REFERENCES machines(id) ON DELETE SET NULL,
        entry_id        TEXT REFERENCES entries(id)  ON DELETE SET NULL,
        file_id         TEXT REFERENCES files(id)    ON DELETE SET NULL,
        machine_minutes REAL,
        labour_minutes  REAL,
        other_cost      REAL,
        makes_qty       REAL NOT NULL DEFAULT 1,   -- units produced per run
        active          INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        deleted_at      TEXT
      );

      CREATE TABLE IF NOT EXISTS product_lines (
        id         TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        supply_id  TEXT REFERENCES supplies(id) ON DELETE SET NULL,
        qty        REAL NOT NULL DEFAULT 1,
        unit       TEXT,                 -- may differ from the supply's own unit
        note       TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_purchases_supply ON purchases(supply_id);
      CREATE INDEX IF NOT EXISTS idx_lines_product    ON product_lines(product_id);
      CREATE INDEX IF NOT EXISTS idx_supplies_live    ON supplies(deleted_at);
    `);

    // Setup is paid once per batch, not per unit — it is the whole reason a
    // run of 40 costs less each than a run of 4.
    addColumnIfMissing('products', 'setup_minutes', 'REAL');
  }

  if (current < 6) {
    // v6 — reordering. The same thing gets bought from different places over
    // time, so each purchase can carry its own link; the supply keeps the one
    // you would reach for by default.
    addColumnIfMissing('purchases', 'url', 'TEXT');
  }

  if (current < 7) {
    // v7 — three things the first live scan made obvious.

    // A Nextcloud data folder holds a lot that is not laser work. Without a way
    // to exclude folders, one scan swept in Desktop, Documents and Downloads.
    addColumnIfMissing('sources', 'exclude', 'TEXT');

    // What happens to a piece after the laser: paint fill, stain, sealer.
    // Half the finished look comes from this step and none of it was recorded.
    db.exec(`
      CREATE TABLE IF NOT EXISTS finishes (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        kind        TEXT,            -- paint_fill | paint | stain | seal | mask | dye | patina | other
        substrate   TEXT,            -- what it goes on: birch ply, acrylic, powder-coated steel
        brand       TEXT,
        product     TEXT,            -- the actual can or pen
        color       TEXT,
        color_hex   TEXT,
        mask        TEXT,            -- what you mask with, if anything
        application TEXT,            -- brush | marker | rattlecan | airbrush | roller | wipe
        coats       INTEGER,
        dry_minutes REAL,            -- touch-dry between coats
        cure_hours  REAL,            -- before it can be handled or sold
        removal     TEXT,            -- how the excess comes off the surface
        supply_id   TEXT REFERENCES supplies(id) ON DELETE SET NULL,
        qty_per_use REAL,            -- in the supply's own unit, for costing
        rating      INTEGER,
        notes       TEXT,
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_finishes_live ON finishes(deleted_at);
    `);

    // Indexes the file catalogue needs once it holds tens of thousands of rows.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_files_live    ON files(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_files_missing ON files(missing);
      CREATE INDEX IF NOT EXISTS idx_files_folder  ON files(folder);
    `);
  }

  if (current < 8) {
    // v8 — the settings entry form grows to match a dedicated laser logbook:
    // resolution/spacing, a proper air-assist level, hatch type, a cleanup
    // pass, and a couple of per-entry overrides (metal type, colour/coating,
    // thickness) so a run doesn't have to point at a fully-specified material
    // just to record what it actually was.

    addColumnIfMissing('entries', 'metal_type', 'TEXT');
    addColumnIfMissing('entries', 'color_coating', 'TEXT');
    addColumnIfMissing('entries', 'thickness_mm', 'REAL');

    // Resolution / spacing.
    addColumnIfMissing('entries', 'lpi', 'REAL');
    addColumnIfMissing('entries', 'overscan_pct', 'REAL');
    addColumnIfMissing('entries', 'image_mode', 'TEXT');
    addColumnIfMissing('entries', 'negative_image', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('entries', 'pass_through', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('entries', 'dot_width_correction_mm', 'REAL');

    // Fiber-specific.
    addColumnIfMissing('entries', 'q_pulse', 'TEXT');

    // Air assist grows from on/off to a level. The old `air_assist` column
    // stays and is kept in sync (see upsert()) so exports and filters that
    // still read it keep working.
    addColumnIfMissing('entries', 'air_assist_level', 'TEXT');
    db.exec(`UPDATE entries SET air_assist_level = CASE WHEN air_assist = 1 THEN 'high' ELSE 'off' END
              WHERE air_assist_level IS NULL`);

    // Hatch settings.
    addColumnIfMissing('entries', 'hatch_type', 'TEXT');
    db.exec(`UPDATE entries SET hatch_type = 'cross' WHERE hatch_type IS NULL AND hatch_cross = 1`);
    addColumnIfMissing('entries', 'hatch_angle_increment_deg', 'REAL');
    addColumnIfMissing('entries', 'ramp_length_mm', 'REAL');

    // Cleanup pass: a second, lighter pass run after the main one to clear
    // haze or char without re-cutting the whole job at full power.
    addColumnIfMissing('entries', 'cleanup_enabled', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('entries', 'cleanup_power', 'REAL');
    addColumnIfMissing('entries', 'cleanup_speed', 'REAL');
    addColumnIfMissing('entries', 'cleanup_passes', 'INTEGER');
    addColumnIfMissing('entries', 'cleanup_interval_mm', 'REAL');

    // Metal type on the material itself, as a proper alloy dropdown — `grade`
    // already existed as free text and is left alone.
    addColumnIfMissing('materials', 'metal_type', 'TEXT');
  }

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(String(SCHEMA_VERSION));

  return { from: current, to: SCHEMA_VERSION };
}

const migration = migrate();
if (migration.from && migration.from < migration.to) {
  console.log(`[laserlog] migrated schema v${migration.from} → v${migration.to}`);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function getMeta(key, fallback = null) {
  const r = db.prepare(`SELECT value FROM meta WHERE key=?`).get(key);
  return r ? r.value : fallback;
}

export function setMeta(key, value) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, String(value));
}

export const newId = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

/** Tables that participate in delta sync. */
export const SYNC_TABLES = [
  'machines',
  'materials',
  'entries',
  'projects',
  'tests',
  'test_cells',
  'photos',
  'files',
  'supplies',
  'purchases',
  'products',
  'product_lines',
  'finishes',
  'maintenance',
  'project_entries',
  'tags',
  'entry_tags',
  'file_tags',
  'file_entries',
];

/**
 * Generic upsert used by both the REST routes and the sync push.
 * `fields` is the whitelist of writable columns for that table.
 */
export function upsert(table, fields, payload, id = null) {
  const ts = nowISO();
  const rowId = id || payload.id || newId();
  const existing = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(rowId);

  const data = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) data[f] = payload[f];
  }

  // Every entry write funnels through here, so this is the one place that has
  // to keep the normalised speed in step with the entered value.
  if (table === 'entries' &&
      (Object.prototype.hasOwnProperty.call(data, 'speed') ||
       Object.prototype.hasOwnProperty.call(data, 'speed_unit'))) {
    const prior = existing ? db.prepare(`SELECT speed, speed_unit FROM entries WHERE id=?`).get(rowId) : null;
    const speed = Object.prototype.hasOwnProperty.call(data, 'speed') ? data.speed : prior?.speed;
    const unit = Object.prototype.hasOwnProperty.call(data, 'speed_unit')
      ? data.speed_unit : (prior?.speed_unit ?? 'mm/min');
    data.speed_mm_min = toMmPerMin(speed, unit);
  }

  // The air-assist level is what the form writes now; the plain on/off column
  // is kept alongside it so the CSV import, CSV export and LightBurn export —
  // none of which know about levels — still see the right thing.
  if (table === 'entries' && Object.prototype.hasOwnProperty.call(data, 'air_assist_level')) {
    data.air_assist = data.air_assist_level && data.air_assist_level !== 'off' ? 1 : 0;
  }

  // Same idea for hatch type vs. the old cross-hatch boolean.
  if (table === 'entries' && Object.prototype.hasOwnProperty.call(data, 'hatch_type')) {
    data.hatch_cross = data.hatch_type === 'cross' ? 1 : 0;
  }

  if (existing) {
    const keys = Object.keys(data);
    if (keys.length === 0) return get(table, rowId);
    const sets = keys.map((k) => `${k}=@${k}`).join(', ');
    db.prepare(`UPDATE ${table} SET ${sets}, updated_at=@updated_at WHERE id=@id`).run({
      ...data,
      updated_at: ts,
      id: rowId,
    });
  } else {
    const keys = Object.keys(data);
    const cols = ['id', ...keys, 'created_at', 'updated_at'];
    const vals = ['@id', ...keys.map((k) => `@${k}`), '@created_at', '@updated_at'];
    db.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${vals.join(',')})`
    ).run({ ...data, id: rowId, created_at: payload.created_at || ts, updated_at: ts });
  }
  return get(table, rowId);
}

export function get(table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
}

/** Soft delete so other devices learn about the removal on next sync. */
export function softDelete(table, id) {
  const ts = nowISO();
  const info = db
    .prepare(`UPDATE ${table} SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`)
    .run(ts, ts, id);
  return info.changes > 0;
}

export function listLive(table, { orderBy = 'updated_at DESC' } = {}) {
  return db.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY ${orderBy}`).all();
}

export default db;
