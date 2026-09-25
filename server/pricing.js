/**
 * LaserLog — costing and pricing.
 *
 * Works out what a product actually costs you to make, then what to charge on
 * three channels. Two things here are easy to get wrong and are done properly:
 *
 *  1. Unit cost comes from a weighted average of what you ACTUALLY paid across
 *     every purchase, not a price typed in once and left to go stale.
 *
 *  2. Platform fees are grossed up, not added on. If Etsy takes 9.5% and you
 *     want $20 in hand, you list at 20/(1-0.095) = $22.10, not $21.90. Adding
 *     the percentage leaves you short on every single sale, and the gap grows
 *     with the price.
 */
import { db, getMeta, setMeta } from './db.js';

/* --------------------------------------------------------------- config */

export const DEFAULT_PRICING = {
  labour_rate: 25,      // $/hour of your hands-on time
  machine_rate: 8,      // $/hour of machine time — power, wear, consumables
  round_to: 0.5,        // round prices up to the nearest this
  channels: [
    { key: 'online', label: 'Online', markup: 2.6, fee_pct: 9.5,
      note: 'Marketplace cut plus payment processing' },
    { key: 'market', label: 'Market / fairs', markup: 2.2, fee_pct: 3,
      note: 'Card reader fee' },
    { key: 'ff', label: 'Friends & family', markup: 1.25, fee_pct: 0,
      note: 'Covers cost and a little for your time' },
  ],
};

export function getPricingConfig() {
  const raw = getMeta('pricing');
  if (!raw) return { ...DEFAULT_PRICING };
  try {
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_PRICING,
      ...saved,
      channels: Array.isArray(saved.channels) && saved.channels.length
        ? saved.channels : DEFAULT_PRICING.channels,
    };
  } catch {
    return { ...DEFAULT_PRICING };
  }
}

export function setPricingConfig(cfg) {
  const merged = { ...getPricingConfig(), ...cfg };
  setMeta('pricing', JSON.stringify(merged));
  return merged;
}

/* ----------------------------------------------------------- unit maths */

const MM_PER_IN = 25.4;

/** Multipliers into a canonical unit, per dimension family. */
const FAMILIES = {
  length: { mm: 1, cm: 10, m: 1000, in: MM_PER_IN, ft: MM_PER_IN * 12, yd: MM_PER_IN * 36 },
  area:   { sq_mm: 1, sq_cm: 100, sq_m: 1e6, sq_in: MM_PER_IN ** 2, sq_ft: (MM_PER_IN * 12) ** 2 },
  mass:   { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 },
  volume: { ml: 1, l: 1000, floz: 29.5735 },
  count:  { each: 1, pair: 2, dozen: 12 },
};

const familyOf = (unit) => {
  for (const [name, table] of Object.entries(FAMILIES)) {
    if (unit in table) return name;
  }
  return null;
};

/**
 * How many of `supply.unit` a bill-of-materials line consumes.
 *
 * The interesting case is buying by the sheet and consuming by area: a
 * 300×600mm sheet costing $8 used 40 sq in deep is 0.143 of a sheet, $1.15.
 * Returns null when the conversion isn't meaningful, so the caller can flag
 * it rather than silently costing it at zero.
 */
export function convertToSupplyUnits(qty, lineUnit, supply) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return null;

  const supUnit = supply?.unit || 'each';
  const from = lineUnit || supUnit;

  if (from === supUnit) return n;

  // Sheet stock consumed as area.
  if (supUnit === 'sheet' && familyOf(from) === 'area') {
    const w = Number(supply.sheet_w_mm), h = Number(supply.sheet_h_mm);
    if (!w || !h) return null;                      // no sheet size recorded
    const sqmm = n * FAMILIES.area[from];
    return sqmm / (w * h);
  }

  // Roll / length stock consumed as length.
  if ((supUnit === 'roll' || familyOf(supUnit) === 'length') && familyOf(from) === 'length') {
    const rollLen = supUnit === 'roll' ? Number(supply.sheet_w_mm) : null;
    const mm = n * FAMILIES.length[from];
    if (supUnit === 'roll') return rollLen ? mm / rollLen : null;
    return mm / FAMILIES.length[supUnit];
  }

  // Same dimensional family — straight conversion.
  const fam = familyOf(from);
  if (fam && fam === familyOf(supUnit)) {
    return (n * FAMILIES[fam][from]) / FAMILIES[fam][supUnit];
  }

  return null;
}

/* --------------------------------------------------------- supply costs */

/**
 * Weighted average unit cost across every purchase of a supply.
 * Also returns the most recent price, because a rising cost is worth seeing.
 */
export function unitCostOf(supplyId) {
  const agg = db.prepare(
    `SELECT SUM(qty) AS qty, SUM(total_cost) AS cost, COUNT(*) AS n
       FROM purchases WHERE supply_id=? AND deleted_at IS NULL`
  ).get(supplyId);

  const last = db.prepare(
    `SELECT qty, total_cost, date FROM purchases
      WHERE supply_id=? AND deleted_at IS NULL
      ORDER BY COALESCE(date, created_at) DESC LIMIT 1`
  ).get(supplyId);

  const avg = agg && agg.qty > 0 ? agg.cost / agg.qty : null;
  const lastUnit = last && last.qty > 0 ? last.total_cost / last.qty : null;

  return {
    unit_cost: avg,
    last_unit_cost: lastUnit,
    purchases: agg?.n || 0,
    total_qty: agg?.qty || 0,
    total_spend: agg?.cost || 0,
    trend: (avg != null && lastUnit != null && avg > 0)
      ? Number((((lastUnit - avg) / avg) * 100).toFixed(1)) : null,
  };
}

/* ------------------------------------------------------------- costing */

const roundUpTo = (value, step) => {
  const s = Number(step);
  if (!s || s <= 0) return Number(value.toFixed(2));
  return Number((Math.ceil(value / s) * s).toFixed(2));
};

/**
 * Full costing for one product.
 *
 * `qty` is how many units you're pricing — material and machine time scale
 * with it, so a product that makes 4 coasters per run costs a quarter of the
 * run per coaster.
 */
export function costProduct(productId, { qty = 1, config } = {}) {
  const product = db.prepare(
    `SELECT * FROM products WHERE id=? AND deleted_at IS NULL`
  ).get(productId);
  if (!product) return null;

  const cfg = config || getPricingConfig();
  const lines = db.prepare(
    `SELECT * FROM product_lines WHERE product_id=? AND deleted_at IS NULL
      ORDER BY created_at`
  ).all(productId);

  const makes = Number(product.makes_qty) || 1;
  const runs = qty / makes;                  // how many runs to make `qty` units

  const materialLines = [];
  let materials = 0;
  const warnings = [];

  for (const line of lines) {
    const supply = line.supply_id
      ? db.prepare(`SELECT * FROM supplies WHERE id=?`).get(line.supply_id) : null;

    if (!supply) {
      warnings.push(`A bill-of-materials line has no supply attached — not costed.`);
      materialLines.push({ ...line, supply_name: null, cost: null, issue: 'no_supply' });
      continue;
    }

    const perRun = convertToSupplyUnits(line.qty, line.unit, supply);
    const { unit_cost, last_unit_cost, purchases } = unitCostOf(supply.id);

    if (perRun === null) {
      warnings.push(`${supply.name}: can't convert ${line.unit || '?'} into ${supply.unit}.`);
      materialLines.push({ ...line, supply_name: supply.name, cost: null, issue: 'no_conversion' });
      continue;
    }
    if (unit_cost === null) {
      warnings.push(`${supply.name}: no purchases recorded, so it costs nothing yet.`);
      materialLines.push({
        ...line, supply_name: supply.name, supply_unit: supply.unit,
        qty_in_supply_units: Number((perRun * runs).toFixed(4)),
        unit_cost: null, cost: null, issue: 'no_price',
      });
      continue;
    }

    const used = perRun * runs;
    const cost = used * unit_cost;
    materials += cost;
    materialLines.push({
      ...line,
      supply_name: supply.name,
      supply_unit: supply.unit,
      qty_in_supply_units: Number(used.toFixed(4)),
      unit_cost: Number(unit_cost.toFixed(4)),
      last_unit_cost: last_unit_cost != null ? Number(last_unit_cost.toFixed(4)) : null,
      purchases,
      cost: Number(cost.toFixed(4)),
      stock_qty: supply.stock_qty,
      short_by: supply.stock_qty < used ? Number((used - supply.stock_qty).toFixed(4)) : 0,
    });
  }

  const machineMin = (Number(product.machine_minutes) || 0) * runs;
  // Setup is charged once for the whole batch; the rest scales with the runs.
  const setupMin = Number(product.setup_minutes) || 0;
  const labourMin = setupMin + (Number(product.labour_minutes) || 0) * runs;
  const machineCost = (machineMin / 60) * (Number(cfg.machine_rate) || 0);
  const labourCost = (labourMin / 60) * (Number(cfg.labour_rate) || 0);
  const other = (Number(product.other_cost) || 0) * runs;

  const cost = materials + machineCost + labourCost + other;

  const prices = (cfg.channels || []).map((ch) => {
    const markup = Number(ch.markup) || 1;
    const feePct = Math.min(Math.max(Number(ch.fee_pct) || 0, 0), 95);
    const target = cost * markup;                 // what you want to keep
    // Gross up so the fee comes out of the buyer's price, not your margin.
    const listed = feePct > 0 ? target / (1 - feePct / 100) : target;
    const price = roundUpTo(listed, cfg.round_to);
    const fees = price * (feePct / 100);
    const net = price - fees;
    return {
      key: ch.key,
      label: ch.label,
      note: ch.note,
      markup,
      fee_pct: feePct,
      price,
      each: Number((price / qty).toFixed(2)),
      fees: Number(fees.toFixed(2)),
      net: Number(net.toFixed(2)),
      profit: Number((net - cost).toFixed(2)),
      margin_pct: net > 0 ? Number((((net - cost) / net) * 100).toFixed(1)) : null,
      hourly: (machineMin + labourMin) > 0
        ? Number((((net - cost) / ((machineMin + labourMin) / 60))).toFixed(2)) : null,
    };
  });

  return {
    product_id: product.id,
    name: product.name,
    qty,
    makes_qty: makes,
    runs: Number(runs.toFixed(3)),
    breakdown: {
      materials: Number(materials.toFixed(2)),
      machine: Number(machineCost.toFixed(2)),
      labour: Number(labourCost.toFixed(2)),
      other: Number(other.toFixed(2)),
      total: Number(cost.toFixed(2)),
      per_unit: Number((cost / qty).toFixed(2)),
    },
    time: {
      machine_minutes: Number(machineMin.toFixed(1)),
      labour_minutes: Number(labourMin.toFixed(1)),
      setup_minutes: setupMin,
      total_minutes: Number((machineMin + labourMin).toFixed(1)),
    },
    rates: { labour_rate: cfg.labour_rate, machine_rate: cfg.machine_rate },
    lines: materialLines,
    prices,
    warnings,
  };
}

/* ------------------------------------------------------- stock movement */

/**
 * Consume stock for a build. Returns what it took and what you were short of.
 * Stock is allowed to go negative — telling you afterwards is more useful
 * than refusing a build you have already physically done.
 */
export function consumeForBuild(productId, qty = 1) {
  const costing = costProduct(productId, { qty });
  if (!costing) throw new Error('product_not_found');

  const taken = [];
  const short = [];
  const upd = db.prepare(`UPDATE supplies SET stock_qty = stock_qty - ?, updated_at=? WHERE id=?`);
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    for (const line of costing.lines) {
      if (!line.supply_id || line.qty_in_supply_units == null) continue;
      const used = line.qty_in_supply_units;
      const supply = db.prepare(`SELECT stock_qty, name, unit FROM supplies WHERE id=?`).get(line.supply_id);
      if (!supply) continue;
      upd.run(used, now, line.supply_id);
      taken.push({ supply_id: line.supply_id, name: supply.name, used, unit: supply.unit });
      if (supply.stock_qty < used) {
        short.push({
          name: supply.name,
          short_by: Number((used - supply.stock_qty).toFixed(4)),
          unit: supply.unit,
        });
      }
    }
  });
  run();

  return { ok: true, qty, taken, short, costing };
}

/** Everything at or below its reorder point. */
export function lowStock() {
  return db.prepare(
    `SELECT * FROM supplies
      WHERE deleted_at IS NULL AND archived = 0
        AND reorder_at IS NOT NULL AND stock_qty <= reorder_at
      ORDER BY (stock_qty - reorder_at), name COLLATE NOCASE`
  ).all();
}
