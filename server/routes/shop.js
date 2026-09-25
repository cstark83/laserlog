/**
 * LaserLog — the shop side: supplies, purchases, products and pricing.
 */
import { Router } from 'express';
import { db, upsert, get, softDelete, newId, nowISO, listLive } from '../db.js';
import {
  costProduct, consumeForBuild, unitCostOf, lowStock,
  getPricingConfig, setPricingConfig, convertToSupplyUnits,
} from '../pricing.js';

export const suppliesRouter = Router();
export const productsRouter = Router();
export const pricingRouter = Router();

const SUPPLY_FIELDS = ['name', 'category', 'unit', 'sheet_w_mm', 'sheet_h_mm',
  'supplier', 'sku', 'url', 'stock_qty', 'reorder_at', 'material_id', 'notes', 'archived'];

const PURCHASE_FIELDS = ['supply_id', 'date', 'qty', 'total_cost', 'supplier', 'url', 'notes'];

const PRODUCT_FIELDS = ['name', 'sku', 'notes', 'machine_id', 'entry_id', 'file_id',
  'machine_minutes', 'labour_minutes', 'setup_minutes', 'other_cost', 'makes_qty', 'active'];

const LINE_FIELDS = ['product_id', 'supply_id', 'qty', 'unit', 'note'];

/* --------------------------------------------------------- supplies */

const hydrateSupply = (s) => ({ ...s, ...unitCostOf(s.id) });

suppliesRouter.get('/', (req, res) => {
  const rows = listLive('supplies', { orderBy: 'name COLLATE NOCASE' })
    .filter((s) => (req.query.archived === '1' ? true : !s.archived));
  // The list carries the reorder link too, so a low-stock row is one tap from
  // the shop page rather than three.
  res.json(rows.map((s) => ({ ...hydrateSupply(s), reorder: reorderInfo(s) })));
});

suppliesRouter.get('/low', (_req, res) =>
  res.json(lowStock().map((s) => ({ ...hydrateSupply(s), reorder: reorderInfo(s) }))));

/**
 * Where to buy this again. The supply's own link is the default, but a more
 * recent purchase from somewhere else wins — that is where you actually got it
 * last, and it is usually where you would look first.
 */
function reorderInfo(s) {
  const last = db.prepare(
    `SELECT supplier, url, date, qty, total_cost FROM purchases
      WHERE supply_id=? AND deleted_at IS NULL
      ORDER BY COALESCE(date, created_at) DESC LIMIT 1`
  ).get(s.id);

  const url = (last && last.url) || s.url || null;
  const supplier = (last && last.supplier) || s.supplier || null;

  return {
    supplier,
    url,
    sku: s.sku || null,
    from_last_purchase: Boolean(last && (last.url || last.supplier)),
    last_date: last?.date || null,
    last_unit_cost: last && last.qty > 0
      ? Number((last.total_cost / last.qty).toFixed(4)) : null,
    low: s.reorder_at != null && s.stock_qty <= s.reorder_at,
  };
}

suppliesRouter.get('/:id', (req, res) => {
  const s = get('supplies', req.params.id);
  if (!s || s.deleted_at) return res.status(404).json({ error: 'not_found' });
  res.json({
    ...hydrateSupply(s),
    reorder: reorderInfo(s),
    purchase_history: db.prepare(
      `SELECT * FROM purchases WHERE supply_id=? AND deleted_at IS NULL
        ORDER BY COALESCE(date, created_at) DESC`
    ).all(s.id),
    used_in: db.prepare(
      `SELECT p.id, p.name FROM products p
         JOIN product_lines l ON l.product_id = p.id
        WHERE l.supply_id = ? AND p.deleted_at IS NULL AND l.deleted_at IS NULL
        GROUP BY p.id ORDER BY p.name COLLATE NOCASE`
    ).all(s.id),
  });
});

suppliesRouter.post('/', (req, res) => {
  try { res.status(201).json(hydrateSupply(upsert('supplies', SUPPLY_FIELDS, req.body || {}))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

suppliesRouter.put('/:id', (req, res) => {
  const s = get('supplies', req.params.id);
  if (!s || s.deleted_at) return res.status(404).json({ error: 'not_found' });
  res.json(hydrateSupply(upsert('supplies', SUPPLY_FIELDS, req.body || {}, req.params.id)));
});

suppliesRouter.delete('/:id', (req, res) => {
  if (!softDelete('supplies', req.params.id)) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

/**
 * Record a buy. Stock goes up by the quantity, and the unit cost used in every
 * costing shifts to the new weighted average automatically.
 */
suppliesRouter.post('/:id/purchases', (req, res) => {
  const s = get('supplies', req.params.id);
  if (!s || s.deleted_at) return res.status(404).json({ error: 'not_found' });

  const qty = Number(req.body?.qty);
  const total = Number(req.body?.total_cost);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'qty_required' });
  if (!Number.isFinite(total) || total < 0) return res.status(400).json({ error: 'cost_required' });

  const run = db.transaction(() => {
    const p = upsert('purchases', PURCHASE_FIELDS, {
      ...req.body, supply_id: s.id,
      date: req.body.date || new Date().toISOString().slice(0, 10),
    });
    db.prepare(`UPDATE supplies SET stock_qty = stock_qty + ?, updated_at=? WHERE id=?`)
      .run(qty, nowISO(), s.id);
    return p;
  });
  const purchase = run();

  res.status(201).json({ purchase, supply: hydrateSupply(get('supplies', s.id)) });
});

suppliesRouter.delete('/:id/purchases/:pid', (req, res) => {
  const p = get('purchases', req.params.pid);
  if (!p || p.deleted_at) return res.status(404).json({ error: 'not_found' });
  const run = db.transaction(() => {
    softDelete('purchases', p.id);
    db.prepare(`UPDATE supplies SET stock_qty = stock_qty - ?, updated_at=? WHERE id=?`)
      .run(Number(p.qty) || 0, nowISO(), p.supply_id);
  });
  run();
  res.json({ ok: true });
});

/** Manual stock correction — a count, breakage, or an offcut put back. */
suppliesRouter.post('/:id/adjust', (req, res) => {
  const s = get('supplies', req.params.id);
  if (!s || s.deleted_at) return res.status(404).json({ error: 'not_found' });
  const delta = Number(req.body?.delta);
  const setTo = Number(req.body?.set_to);

  if (Number.isFinite(setTo)) {
    db.prepare(`UPDATE supplies SET stock_qty=?, updated_at=? WHERE id=?`).run(setTo, nowISO(), s.id);
  } else if (Number.isFinite(delta)) {
    db.prepare(`UPDATE supplies SET stock_qty = stock_qty + ?, updated_at=? WHERE id=?`)
      .run(delta, nowISO(), s.id);
  } else {
    return res.status(400).json({ error: 'delta_or_set_to_required' });
  }
  res.json(hydrateSupply(get('supplies', s.id)));
});

/* --------------------------------------------------------- products */

const hydrateProduct = (p, { withCosting = false, qty = 1 } = {}) => {
  const lines = db.prepare(
    `SELECT l.*, s.name AS supply_name, s.unit AS supply_unit
       FROM product_lines l LEFT JOIN supplies s ON s.id = l.supply_id
      WHERE l.product_id=? AND l.deleted_at IS NULL ORDER BY l.created_at`
  ).all(p.id);
  const out = { ...p, lines };
  out.entry_title = p.entry_id
    ? (() => {
        const e = db.prepare(
          `SELECT e.title, mt.name AS material_name FROM entries e
             LEFT JOIN materials mt ON mt.id = e.material_id WHERE e.id=?`).get(p.entry_id);
        return e ? (e.title || e.material_name || null) : null;
      })()
    : null;
  out.file_name = p.file_id
    ? db.prepare(`SELECT name FROM files WHERE id=?`).get(p.file_id)?.name ?? null
    : null;
  if (withCosting) out.costing = costProduct(p.id, { qty });
  return out;
};

productsRouter.get('/', (req, res) => {
  const rows = listLive('products', { orderBy: 'name COLLATE NOCASE' });
  // The list is where you glance at prices, so cost each one at a single unit.
  res.json(rows.map((p) => {
    const c = costProduct(p.id, { qty: 1 });
    return {
      ...p,
      line_count: db.prepare(
        `SELECT COUNT(*) n FROM product_lines WHERE product_id=? AND deleted_at IS NULL`
      ).get(p.id).n,
      cost: c?.breakdown.total ?? null,
      prices: c?.prices ?? [],
      warnings: c?.warnings ?? [],
    };
  }));
});

productsRouter.get('/:id', (req, res) => {
  const p = get('products', req.params.id);
  if (!p || p.deleted_at) return res.status(404).json({ error: 'not_found' });
  const qty = Math.max(Number(req.query.qty) || 1, 0.0001);
  res.json(hydrateProduct(p, { withCosting: true, qty }));
});

productsRouter.get('/:id/costing', (req, res) => {
  const qty = Math.max(Number(req.query.qty) || 1, 0.0001);
  const c = costProduct(req.params.id, { qty });
  if (!c) return res.status(404).json({ error: 'not_found' });

  // The pricing sheet is also where you go to re-run a repeat order, so it
  // carries the links to the setting and the file rather than making you hunt.
  const p = get('products', req.params.id);
  if (p) {
    c.entry_id = p.entry_id ?? null;
    c.file_id = p.file_id ?? null;
    // Plenty of settings have no title — they are known by their material.
    // Check the row exists, then work out something to call it.
    const en = p.entry_id
      ? db.prepare(
          `SELECT e.id, e.title, e.operation, mt.name AS material_name, mt.thickness_mm
             FROM entries e LEFT JOIN materials mt ON mt.id = e.material_id
            WHERE e.id=? AND e.deleted_at IS NULL`).get(p.entry_id)
      : null;
    const fl = p.file_id
      ? db.prepare(`SELECT id, name FROM files WHERE id=? AND deleted_at IS NULL`).get(p.file_id)
      : null;

    c.entry_id = en?.id ?? null;                            // null if it is gone
    c.entry_title = en
      ? en.title || [en.material_name, en.thickness_mm ? `${en.thickness_mm}mm` : null, en.operation]
          .filter(Boolean).join(' ') || 'Open the setting'
      : null;
    c.file_id = fl?.id ?? null;
    c.file_name = fl?.name ?? null;
  }
  res.json(c);
});

/**
 * Cost a product that hasn't been saved yet, so the editor can show live
 * prices while you're still typing the bill of materials. Writes a scratch
 * row inside a transaction and rolls it back — the costing logic then has
 * exactly one implementation rather than a second copy in the browser.
 */
productsRouter.post('/preview', (req, res) => {
  const qty = Math.max(Number(req.query.qty) || Number(req.body?.qty) || 1, 0.0001);
  const body = req.body || {};
  let costing = null;
  let began = false;

  try {
    db.exec('BEGIN');
    began = true;
    const scratchId = newId();
    upsert('products', PRODUCT_FIELDS, {
      ...body,
      // The editor previews while you're still typing, so a draft with no
      // name yet still has to cost rather than blowing up on NOT NULL.
      name: body.name || 'Draft',
      id: scratchId,
    }, scratchId);
    replaceLines(scratchId, body.lines);
    costing = costProduct(scratchId, { qty });
  } catch (e) {
    return res.status(400).json({ error: 'could_not_cost', detail: e.message });
  } finally {
    if (began) { try { db.exec('ROLLBACK'); } catch { /* already unwound */ } }
  }

  if (!costing) return res.status(400).json({ error: 'could_not_cost' });
  res.json({ ...costing, product_id: null });
});

productsRouter.post('/', (req, res) => {
  const run = db.transaction(() => {
    const p = upsert('products', PRODUCT_FIELDS, req.body || {});
    replaceLines(p.id, req.body?.lines);
    return p;
  });
  res.status(201).json(hydrateProduct(run(), { withCosting: true }));
});

productsRouter.put('/:id', (req, res) => {
  const existing = get('products', req.params.id);
  if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
  const run = db.transaction(() => {
    const p = upsert('products', PRODUCT_FIELDS, req.body || {}, req.params.id);
    if (Array.isArray(req.body?.lines)) replaceLines(p.id, req.body.lines);
    return p;
  });
  res.json(hydrateProduct(run(), { withCosting: true }));
});

function replaceLines(productId, lines) {
  if (!Array.isArray(lines)) return;
  db.prepare(`DELETE FROM product_lines WHERE product_id=?`).run(productId);
  for (const l of lines) {
    if (!l || (!l.supply_id && !l.note)) continue;
    upsert('product_lines', LINE_FIELDS, { ...l, product_id: productId, id: undefined });
  }
}

productsRouter.delete('/:id', (req, res) => {
  if (!softDelete('products', req.params.id)) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

/** Made a batch — take it out of stock. */
productsRouter.post('/:id/build', (req, res) => {
  const qty = Math.max(Number(req.body?.qty) || 1, 0.0001);
  try {
    const result = consumeForBuild(req.params.id, qty);

    // Optionally record it as a project so it shows up in the job history.
    if (req.body?.log_project) {
      const p = get('products', req.params.id);
      const channel = (result.costing.prices || [])
        .find((x) => x.key === req.body.channel) || result.costing.prices[0];
      upsert('projects', [
        'name', 'client', 'machine_id', 'qty', 'run_time_min',
        'material_cost', 'other_cost', 'sale_price', 'status', 'date', 'notes',
      ], {
        name: `${p.name} ×${qty}`,
        client: req.body.client || null,
        machine_id: p.machine_id,
        qty,
        run_time_min: result.costing.time.machine_minutes,
        material_cost: result.costing.breakdown.materials,
        other_cost: result.costing.breakdown.other,
        sale_price: channel ? channel.each : null,
        status: 'done',
        date: new Date().toISOString().slice(0, 10),
        notes: `Built from product "${p.name}". Cost ${result.costing.breakdown.total}.`,
      });
    }

    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------------------------------------------------------- pricing */

pricingRouter.get('/', (_req, res) => res.json(getPricingConfig()));

pricingRouter.put('/', (req, res) => {
  const body = req.body || {};
  const cfg = {};
  for (const k of ['labour_rate', 'machine_rate', 'round_to']) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (Number.isFinite(n) && n >= 0) cfg[k] = n;
    }
  }
  if (Array.isArray(body.channels)) {
    cfg.channels = body.channels
      .filter((c) => c && c.key && c.label)
      .map((c) => ({
        key: String(c.key).slice(0, 24),
        label: String(c.label).slice(0, 48),
        markup: Math.max(Number(c.markup) || 1, 0.01),
        fee_pct: Math.min(Math.max(Number(c.fee_pct) || 0, 0), 95),
        note: c.note ? String(c.note).slice(0, 120) : '',
      }));
  }
  res.json(setPricingConfig(cfg));
});

/** What-if helper: price an arbitrary cost without saving a product. */
pricingRouter.post('/quote', (req, res) => {
  const cost = Number(req.body?.cost);
  if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'cost_required' });
  const cfg = getPricingConfig();
  const roundTo = Number(cfg.round_to) || 0.5;
  res.json({
    cost,
    prices: cfg.channels.map((ch) => {
      const target = cost * (Number(ch.markup) || 1);
      const fee = Math.min(Math.max(Number(ch.fee_pct) || 0, 0), 95);
      const listed = fee > 0 ? target / (1 - fee / 100) : target;
      const price = Number((Math.ceil(listed / roundTo) * roundTo).toFixed(2));
      const net = price - price * (fee / 100);
      return {
        key: ch.key, label: ch.label, price,
        net: Number(net.toFixed(2)),
        profit: Number((net - cost).toFixed(2)),
      };
    }),
  });
});

/** Unit conversion preview, so the BOM editor can show what a line costs. */
pricingRouter.post('/convert', (req, res) => {
  const { qty, unit, supply_id } = req.body || {};
  const supply = supply_id ? get('supplies', supply_id) : null;
  if (!supply) return res.status(404).json({ error: 'supply_not_found' });
  const converted = convertToSupplyUnits(qty, unit, supply);
  const { unit_cost } = unitCostOf(supply.id);
  res.json({
    converted,
    supply_unit: supply.unit,
    unit_cost,
    cost: converted != null && unit_cost != null
      ? Number((converted * unit_cost).toFixed(4)) : null,
  });
});
