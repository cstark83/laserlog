/*
 * LaserLog — inventory.
 *
 * What you buy, what you paid, and how much is left. Unit cost is worked out
 * from real purchases rather than typed once, so when a sheet price goes up
 * your product costings move with it on their own.
 */
import * as api from '../api.js';
import {
  $, el, esc, num, money, icons, relTime, openSheet, closeSheet, confirmSheet,
  toast, readForm, field, selectField, textareaField, switchField, empty,
} from '../ui.js';

export const UNITS = [
  { value: 'each', label: 'each' },
  { value: 'sheet', label: 'sheet' },
  { value: 'roll', label: 'roll' },
  { value: 'can', label: 'can' },
  { value: 'bottle', label: 'bottle' },
  { value: 'ft', label: 'feet' },
  { value: 'm', label: 'metres' },
  { value: 'g', label: 'grams' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'litres' },
];

const CATEGORIES = ['Sheet stock', 'Blanks', 'Finishing', 'Packaging',
  'Consumables', 'Hardware', 'Other'];

/** amazon.com/dp/B0… → amazon.com — just enough to know where the link goes. */
function shortHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

let showArchivedSupplies = false;

export async function renderInventory(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Inventory</h1><p>What you buy, what it cost, what's left.</p></div>
      <button class="btn btn--sm btn--ghost" id="arch">
        ${showArchivedSupplies ? 'Hide archived' : 'Show archived'}
      </button>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  $('#arch', root).addEventListener('click', () => {
    showArchivedSupplies = !showArchivedSupplies;
    renderInventory(root, ctx);
  });

  const out = $('#out', root);
  let rows = [];
  try { rows = await api.get('/api/supplies' + (showArchivedSupplies ? '?archived=1' : '')); }
  catch { out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.'); return; }
  ctx.supplies = rows;

  if (!rows.length) {
    out.innerHTML = empty(icons.box, 'Nothing in inventory yet',
      'Add the things you buy — sheet stock, paint, tape, boxes. Record what you paid '
      + 'and the costing works itself out.',
      `<button class="btn btn--primary" id="first">${icons.plus}<span>Add a supply</span></button>`);
    $('#first', out)?.addEventListener('click', () =>
      openSupplyEditor(null, ctx, () => renderInventory(root, ctx)));
    return;
  }

  const low = rows.filter((s) => s.reorder_at != null && s.stock_qty <= s.reorder_at);
  const spend = rows.reduce((t, s) => t + (Number(s.total_spend) || 0), 0);

  const groups = new Map();
  for (const s of rows) {
    const k = s.category || 'Uncategorised';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  out.innerHTML = `
    <div class="grid grid--stats" style="margin-bottom:8px">
      <div class="stat"><span class="stat__value">${rows.length}</span>
        <span class="stat__label">Items</span></div>
      <div class="stat"><span class="stat__value">${money(spend)}</span>
        <span class="stat__label">Total spend</span></div>
      <div class="stat"><span class="stat__value ${low.length ? 'profit-neg' : ''}">${low.length}</span>
        <span class="stat__label">Low stock</span></div>
      <div class="stat"><span class="stat__value">${groups.size}</span>
        <span class="stat__label">Categories</span></div>
    </div>

    ${low.length ? `
      <div class="card" style="background:var(--warn-dim);border-color:rgba(251,191,36,.3);margin-bottom:8px">
        <div class="small" style="color:var(--warn);font-weight:650;margin-bottom:8px">
          ${icons.warn} Running low — ${low.length} item${low.length === 1 ? '' : 's'}
        </div>
        <div class="stack" style="gap:6px">
          ${low.map((s) => `
            <div class="row row--between" style="gap:10px">
              <span class="small">${esc(s.name)}
                <span class="muted">· ${num(s.stock_qty, 2)} ${esc(s.unit)} left</span></span>
              ${s.reorder?.url
                ? `<a class="btn btn--sm" href="${esc(s.reorder.url)}" target="_blank" rel="noopener"
                     onclick="event.stopPropagation()">${icons.external}<span>Buy</span></a>`
                : '<span class="small muted">no link</span>'}
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${[...groups.entries()].map(([cat, items]) => `
      <div class="section-title">${esc(cat)}</div>
      <div class="list">
        ${items.map((s) => {
          const isLow = s.reorder_at != null && s.stock_qty <= s.reorder_at;
          return `
          <div class="listitem" data-id="${esc(s.id)}">
            <div class="listitem__main">
              <div class="listitem__title">${esc(s.name)}</div>
              <div class="listitem__sub">
                ${s.unit_cost != null
                  ? `${money(s.unit_cost)} / ${esc(s.unit)}`
                  : '<span style="color:var(--warn)">no price yet</span>'}
                ${s.trend ? ` · <span class="${s.trend > 0 ? 'profit-neg' : 'profit-pos'}">${s.trend > 0 ? '+' : ''}${s.trend}%</span>` : ''}
                ${s.reorder?.supplier ? ` · ${esc(s.reorder.supplier)}` : ''}
              </div>
            </div>
            ${s.reorder?.url
              ? `<a class="btn btn--icon btn--ghost" href="${esc(s.reorder.url)}" target="_blank"
                   rel="noopener" title="Buy again" aria-label="Buy again"
                   onclick="event.stopPropagation()">${icons.external}</a>` : ''}
            <div style="text-align:right;flex:none">
              <div class="kv__v ${isLow ? 'profit-neg' : ''}" style="font-size:15px">
                ${num(s.stock_qty, 2)}</div>
              <div class="small muted">${esc(s.unit)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('')}`;

  out.onclick = (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const s = rows.find((r) => r.id === item.dataset.id);
    if (s) openSupplyDetail(s.id, ctx, () => renderInventory(root, ctx));
  };
}

/* --------------------------------------------------------------- detail */

export async function openSupplyDetail(id, ctx, onChanged) {
  let s;
  try { s = await api.get(`/api/supplies/${id}`); }
  catch { toast('Could not load', 'bad'); return; }

  const body = el('<div class="stack"></div>');
  body.innerHTML = `
    <div class="grid grid--2">
      <div class="stat"><span class="stat__value">${num(s.stock_qty, 2)}</span>
        <span class="stat__label">In stock (${esc(s.unit)})</span></div>
      <div class="stat"><span class="stat__value">${s.unit_cost != null ? money(s.unit_cost) : '—'}</span>
        <span class="stat__label">Avg per ${esc(s.unit)}</span></div>
    </div>

    <div class="reorder ${s.reorder?.low ? 'is-low' : ''}">
      <div class="reorder__head">
        ${icons.cart}
        <span>Buy it again</span>
        ${s.reorder?.low ? '<span class="badge badge--partial">running low</span>' : ''}
      </div>
      <div class="reorder__grid">
        <div>
          <div class="reorder__label">Where from</div>
          <div class="reorder__value">${s.reorder?.supplier ? esc(s.reorder.supplier) : '—'}</div>
        </div>
        <div>
          <div class="reorder__label">Last paid</div>
          <div class="reorder__value">${s.reorder?.last_unit_cost != null
            ? `${money(s.reorder.last_unit_cost)} <span class="muted" style="font-size:12px">/ ${esc(s.unit)}</span>`
            : '—'}</div>
        </div>
        ${s.reorder?.sku ? `
        <div>
          <div class="reorder__label">Part number</div>
          <div class="reorder__value mono" style="font-size:14px">${esc(s.reorder.sku)}</div>
        </div>` : ''}
        ${s.reorder?.last_date ? `
        <div>
          <div class="reorder__label">Last bought</div>
          <div class="reorder__value" style="font-size:15px">${esc(s.reorder.last_date)}</div>
        </div>` : ''}
      </div>
      ${s.reorder?.url
        ? `<a class="btn btn--primary btn--block" href="${esc(s.reorder.url)}"
             target="_blank" rel="noopener" style="margin-top:12px">
             ${icons.external}<span>Open the product page</span></a>
           <div class="reorder__src">${esc(shortHost(s.reorder.url))}${
             s.reorder.from_last_purchase ? ' · from your last purchase' : ''}</div>`
        : `<div class="field__hint" style="margin-top:10px">
             No link saved yet. Tap Edit and paste the product page under
             “Where to buy it again”, and it'll be one tap from here.
           </div>`}
    </div>

    <div class="card">
      ${s.last_unit_cost != null ? `<div class="kv"><span class="kv__k">Average paid</span>
        <span class="kv__v">${money(s.unit_cost)} / ${esc(s.unit)}
        ${s.trend ? `<span class="${s.trend > 0 ? 'profit-neg' : 'profit-pos'}"> (last buy ${s.trend > 0 ? '+' : ''}${s.trend}%)</span>` : ''}
        </span></div>` : ''}
      <div class="kv"><span class="kv__k">Purchases</span><span class="kv__v">${s.purchases}</span></div>
      <div class="kv"><span class="kv__k">Total spend</span><span class="kv__v">${money(s.total_spend)}</span></div>
      ${s.reorder_at != null ? `<div class="kv"><span class="kv__k">Reorder at</span>
        <span class="kv__v">${num(s.reorder_at, 2)} ${esc(s.unit)}</span></div>` : ''}
      ${(s.unit === 'sheet' && s.sheet_w_mm) ? `<div class="kv"><span class="kv__k">Sheet size</span>
        <span class="kv__v">${num(s.sheet_w_mm, 0)}×${num(s.sheet_h_mm, 0)}mm</span></div>` : ''}
      ${s.supplier ? `<div class="kv"><span class="kv__k">Supplier</span>
        <span class="kv__v">${esc(s.supplier)}</span></div>` : ''}
    </div>

    <div class="row" style="gap:8px">
      <button class="btn btn--primary" id="buy" style="flex:1">${icons.plus}<span>Record a buy</span></button>
      <button class="btn" id="adjust">${icons.sliders}<span>Adjust</span></button>
    </div>

    ${s.used_in?.length ? `
      <div class="section-title">Used in</div>
      <div class="row row--wrap">
        ${s.used_in.map((p) => `<span class="badge">${esc(p.name)}</span>`).join('')}
      </div>` : ''}

    ${s.purchase_history?.length ? `
      <div class="section-title">Purchase history</div>
      <div class="card">
        ${s.purchase_history.map((p) => `
          <div class="kv">
            <span class="kv__k">${esc(p.date || relTime(p.created_at))}
              ${p.supplier ? `· ${esc(p.supplier)}` : ''}
              ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener"
                   style="margin-left:6px" title="Open">${icons.external}</a>` : ''}</span>
            <span class="kv__v">${num(p.qty, 2)} ${esc(s.unit)} · ${money(p.total_cost)}
              <span class="muted">(${money(p.total_cost / p.qty)}/${esc(s.unit)})</span></span>
          </div>`).join('')}
      </div>` : ''}`;

  $('#buy', body).addEventListener('click', () => {
    closeSheet();
    openPurchaseSheet(s, () => openSupplyDetail(id, ctx, onChanged));
  });

  $('#adjust', body).addEventListener('click', () => {
    closeSheet();
    openAdjustSheet(s, () => openSupplyDetail(id, ctx, onChanged));
  });

  openSheet({
    title: s.name,
    body,
    actions: [
      { label: 'Edit', icon: icons.edit, onClick: () => {
          openSupplyEditor(s, ctx, onChanged); return true;
        } },
      { label: 'Done', kind: 'primary', onClick: () => onChanged?.() },
    ],
  });
}

function openPurchaseSheet(supply, onSaved) {
  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    <div class="small muted">Stock goes up, and the average cost used in your
      product pricing updates to include this buy.</div>
    <div class="field-row">
      ${field({ label: `Quantity (${supply.unit})`, name: 'qty', value: '',
        type: 'number', step: 'any', min: 0 })}
      ${field({ label: 'Total paid', name: 'total_cost', value: '',
        type: 'number', step: '0.01', min: 0, hint: 'What the whole lot cost' })}
    </div>
    <div class="field-row">
      ${field({ label: 'Date', name: 'date',
        value: new Date().toISOString().slice(0, 10), type: 'date' })}
      ${field({ label: 'Bought from', name: 'supplier',
        value: supply.reorder?.supplier || supply.supplier || '' })}
    </div>
    ${field({ label: 'Link for this buy', name: 'url', value: supply.reorder?.url || supply.url || '',
      type: 'url', hint: 'If you bought it somewhere new, this becomes the buy-again link' })}
    <div id="preview" class="card" style="padding:12px 16px"></div>
    ${textareaField({ label: 'Notes', name: 'notes', value: '', rows: 2 })}`;

  const preview = $('#preview', body);
  const calc = () => {
    const d = readForm(body);
    const q = Number(d.qty), c = Number(d.total_cost);
    preview.innerHTML = (q > 0 && Number.isFinite(c))
      ? `<div class="kv"><span class="kv__k">Works out at</span>
           <span class="kv__v">${money(c / q)} per ${esc(supply.unit)}</span></div>
         ${supply.unit_cost != null ? `<div class="kv"><span class="kv__k">Current average</span>
           <span class="kv__v">${money(supply.unit_cost)}</span></div>` : ''}`
      : `<div class="small muted">Enter a quantity and what you paid.</div>`;
  };
  calc();
  body.addEventListener('input', calc);

  openSheet({
    title: `Buy — ${supply.name}`,
    body,
    actions: [
      { label: 'Cancel', onClick: () => {} },
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
          const d = readForm(body);
          if (!(Number(d.qty) > 0)) { toast('Quantity is required', 'bad'); return true; }
          if (!Number.isFinite(Number(d.total_cost))) { toast('Total paid is required', 'bad'); return true; }
          await api.post(`/api/supplies/${supply.id}/purchases`, d);
          toast('Recorded');
          onSaved?.();
        } },
    ],
  });
}

function openAdjustSheet(supply, onSaved) {
  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    <div class="small muted">For a stock count, breakage, or putting an offcut back.
      This doesn't change costs — only how much you have.</div>
    ${field({ label: `Set stock to (${supply.unit})`, name: 'set_to',
      value: num(supply.stock_qty, 3), type: 'number', step: 'any' })}`;

  openSheet({
    title: `Adjust — ${supply.name}`,
    body,
    actions: [
      { label: 'Cancel', onClick: () => {} },
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
          const d = readForm(body);
          await api.post(`/api/supplies/${supply.id}/adjust`, { set_to: Number(d.set_to) });
          toast('Stock updated');
          onSaved?.();
        } },
    ],
  });
}

/* --------------------------------------------------------------- editor */

export function openSupplyEditor(supply, ctx, onSaved) {
  const s = supply || {};
  const isNew = !s.id;
  const body = el('<form class="stack"></form>');

  const render = (unit) => {
    body.innerHTML = `
      ${field({ label: 'Name', name: 'name', value: s.name,
        placeholder: 'Basswood 3mm, Posca black, mailer boxes…' })}
      <div class="field-row">
        ${selectField({ label: 'Category', name: 'category', value: s.category,
          options: CATEGORIES, blank: 'Uncategorised' })}
        ${selectField({ label: 'Bought by the', name: 'unit', value: unit,
          options: UNITS, blank: null })}
      </div>

      ${unit === 'sheet' ? `
        <div class="field-row">
          ${field({ label: 'Sheet width mm', name: 'sheet_w_mm', value: s.sheet_w_mm,
            type: 'number', step: 'any' })}
          ${field({ label: 'Sheet height mm', name: 'sheet_h_mm', value: s.sheet_h_mm,
            type: 'number', step: 'any' })}
        </div>
        <span class="field__hint">
          With a sheet size recorded, a product can consume this in square inches
          and the cost works itself out.
        </span>` : ''}

      ${unit === 'roll' ? field({ label: 'Roll length mm', name: 'sheet_w_mm',
        value: s.sheet_w_mm, type: 'number', step: 'any',
        hint: 'Lets a product consume this by the inch or foot' }) : ''}

      <div class="section-title">Buying it again</div>
      <div class="field-row">
        ${field({ label: 'Where from', name: 'supplier', value: s.supplier,
          placeholder: 'Amazon, MakerStock, Menards…' })}
        ${field({ label: 'SKU / part no.', name: 'sku', value: s.sku })}
      </div>
      ${field({ label: 'Where to buy it again', name: 'url', value: s.url, type: 'url',
        placeholder: 'https://…',
        hint: 'Paste the product page. It becomes a one-tap button on the item.' })}
      <div class="field-row">
        ${field({ label: `In stock`, name: 'stock_qty', value: s.stock_qty ?? 0,
          type: 'number', step: 'any' })}
        ${field({ label: 'Warn me at', name: 'reorder_at', value: s.reorder_at,
          type: 'number', step: 'any', hint: 'Low-stock threshold' })}
      </div>
      ${textareaField({ label: 'Notes', name: 'notes', value: s.notes, rows: 2 })}
      ${!isNew ? switchField({ label: 'Archived — hide from lists and pickers',
        name: 'archived', checked: s.archived }) : ''}`;

    $('[name=unit]', body).addEventListener('change', (e) => render(e.target.value));
  };
  render(s.unit || 'each');

  openSheet({
    title: isNew ? 'New supply' : s.name || 'Supply',
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete supply?',
            'Products using it lose their cost for that line.')) {
          await api.del(`/api/supplies/${s.id}`);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const d = readForm(body);
        if (!d.name) { toast('Name is required', 'bad'); return true; }
        if (s.id) await api.put(`/api/supplies/${s.id}`, d);
        else await api.post('/api/supplies', d);
        toast('Saved');
        onSaved?.();
      } },
    ],
  });
}
