/*
 * LaserLog — products and pricing.
 *
 * A product is a recipe: what it's made of, how long it takes, how many it
 * makes per run. From that comes a real cost and three prices.
 *
 * Note on "profit": labour is inside the cost at your hourly rate, so profit
 * here is what's left AFTER paying yourself. That's the honest way round — a
 * price that only covers materials isn't a profit, it's a hobby.
 */
import * as api from '../api.js';
import { openEntryDetail } from './entries.js';
import {
  $, $$, el, esc, num, money, icons, openSheet, closeSheet, confirmSheet,
  toast, readForm, field, selectField, textareaField, empty,
} from '../ui.js';
import { UNITS } from './inventory.js';

const LINE_UNITS = [
  { value: '', label: 'same as bought' },
  { value: 'each', label: 'each' },
  { value: 'sq_in', label: 'square inches' },
  { value: 'sq_mm', label: 'square mm' },
  { value: 'sq_ft', label: 'square feet' },
  { value: 'in', label: 'inches' },
  { value: 'ft', label: 'feet' },
  { value: 'mm', label: 'mm' },
  { value: 'ml', label: 'ml' },
  { value: 'g', label: 'grams' },
];

export async function renderProducts(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Products</h1><p>What you make, what it costs, what to charge.</p></div>
      <button class="btn btn--sm btn--ghost" id="rates">${icons.settings}<span>Rates</span></button>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  const out = $('#out', root);
  const redraw = () => renderProducts(root, ctx);

  $('#rates', root).addEventListener('click', () => openRatesSheet(redraw));

  let rows = [];
  try {
    const [products, supplies, machines, entries, files] = await Promise.all([
      api.get('/api/products'),
      api.get('/api/supplies').catch(() => []),
      ctx.machines?.length ? ctx.machines : api.get('/api/machines').catch(() => []),
      api.get('/api/entries').catch(() => []),
      // Only the file kinds you would actually run, and only enough of them to
      // fill a picker — the catalogue can hold tens of thousands of rows.
      api.get('/api/files?kind=lightburn&limit=300').catch(() => ({ files: [] })),
    ]);
    rows = products;
    ctx.supplies = supplies;
    ctx.machines = machines;
    ctx.entries = entries;
    ctx.productFiles = files.files || [];
  } catch {
    out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.');
    return;
  }

  if (!ctx.supplies?.length) {
    out.innerHTML = empty(icons.box, 'Add your inventory first',
      'A product is built from things you buy. Add a few supplies and what you paid, '
      + 'then come back and build a recipe.',
      `<a class="btn btn--primary" href="#/inventory">${icons.plus}<span>Go to inventory</span></a>`);
    return;
  }

  if (!rows.length) {
    out.innerHTML = empty(icons.tag, 'No products yet',
      'Build a recipe — what goes into it and how long it takes — and it works out '
      + 'your cost and three prices.',
      `<button class="btn btn--primary" id="first">${icons.plus}<span>New product</span></button>`);
    $('#first', out)?.addEventListener('click', () => openProductEditor(null, ctx, redraw));
    return;
  }

  out.innerHTML = `<div class="stack">${rows.map((p) => `
    <article class="card card--tap" data-id="${esc(p.id)}">
      <div class="row row--between" style="align-items:flex-start;gap:12px">
        <div style="min-width:0">
          <div style="font-weight:640;font-size:15.5px">${esc(p.name)}</div>
          <div class="small muted" style="margin-top:2px">
            ${p.makes_qty > 1 ? `makes ${num(p.makes_qty, 0)} per run · ` : ''}
            ${p.line_count} part${p.line_count === 1 ? '' : 's'}
            ${p.cost != null ? ` · costs ${money(p.cost)} each` : ''}
          </div>
        </div>
        ${p.warnings?.length
          ? `<span class="badge badge--partial">${icons.warn} ${p.warnings.length}</span>` : ''}
      </div>
      <div class="params" style="margin-top:10px">
        ${(p.prices || []).map((pr) => `
          <div class="param ${pr.key === 'online' ? 'param--hero' : ''}">
            <span class="param__label">${esc(pr.label)}</span>
            <span class="param__value">${money(pr.price)}</span>
          </div>`).join('')}
      </div>
    </article>`).join('')}</div>`;

  out.onclick = (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    openProductDetail(card.dataset.id, ctx, redraw);
  };
}

/* --------------------------------------------------------------- detail */

export async function openProductDetail(id, ctx, onChanged) {
  let qty = 1;
  let keepFocus = false;        // true while the quantity box is being typed in
  const body = el('<div class="stack"></div>');

  const load = async () => {
    let c;
    try { c = await api.get(`/api/products/${id}/costing?qty=${qty}`); }
    catch { body.innerHTML = '<p class="muted">Could not load.</p>'; return; }

    body.innerHTML = `
      <div class="field">
        <span class="field__label">Price a batch of</span>
        <div class="batchrow">
          <input type="number" id="qty-input" inputmode="numeric" min="1" max="100000"
                 step="1" value="${num(qty, 0)}" aria-label="Batch quantity">
          <span class="batchrow__unit">units</span>
        </div>
        <div class="chips" style="margin-top:8px">
          ${[1, 4, 10, 25, 50, 100].map((n) => `
            <button class="chip ${n === qty ? 'is-on' : ''}" data-qty="${n}">${n}</button>`).join('')}
        </div>
      </div>

      <div class="pricegrid">
        ${c.prices.map((p) => `
          <div class="pricecard ${p.key === 'online' ? 'is-hero' : ''}">
            <div class="pricecard__label">${esc(p.label)}</div>
            <div class="pricecard__price">${money(p.each)}</div>
            <div class="pricecard__unit">each${qty > 1 ? ` · ${money(p.price)} total` : ''}</div>
            <div class="pricecard__foot">
              ${p.fee_pct ? `after ${p.fee_pct}% fees you keep ${money(p.net)}<br>` : ''}
              profit ${money(p.profit)}${p.margin_pct != null ? ` · ${p.margin_pct}%` : ''}
            </div>
          </div>`).join('')}
      </div>

      <div class="section-title">Where the cost goes</div>
      <div class="card">
        <div class="kv"><span class="kv__k">Materials</span>
          <span class="kv__v">${money(c.breakdown.materials)}</span></div>
        <div class="kv"><span class="kv__k">Machine time
          <span class="muted">(${num(c.time.machine_minutes, 0)} min @ ${money(c.rates.machine_rate)}/hr)</span></span>
          <span class="kv__v">${money(c.breakdown.machine)}</span></div>
        <div class="kv"><span class="kv__k">Your time
          <span class="muted">(${num(c.time.labour_minutes, 0)} min @ ${money(c.rates.labour_rate)}/hr)</span></span>
          <span class="kv__v">${money(c.breakdown.labour)}</span></div>
        ${c.breakdown.other ? `<div class="kv"><span class="kv__k">Other</span>
          <span class="kv__v">${money(c.breakdown.other)}</span></div>` : ''}
        <div class="kv"><span class="kv__k"><strong>Total for ${num(qty, 0)}</strong></span>
          <span class="kv__v"><strong>${money(c.breakdown.total)}</strong></span></div>
        <div class="kv"><span class="kv__k">Per unit</span>
          <span class="kv__v">${money(c.breakdown.per_unit)}</span></div>
      </div>

      <div class="section-title">Parts used</div>
      <div class="card">
        ${c.lines.length ? c.lines.map((l) => `
          <div class="kv">
            <span class="kv__k">${esc(l.supply_name || 'Unattached line')}
              ${l.short_by ? `<br><span style="color:var(--bad)">short ${num(l.short_by, 2)} ${esc(l.supply_unit)}</span>` : ''}
            </span>
            <span class="kv__v">
              ${l.qty_in_supply_units != null
                ? `${num(l.qty_in_supply_units, 3)} ${esc(l.supply_unit || '')}` : '—'}
              ${l.cost != null ? ` · ${money(l.cost)}` : '<span style="color:var(--warn)"> · no price</span>'}
            </span>
          </div>`).join('') : '<div class="small muted">No parts yet.</div>'}
      </div>

      ${(c.entry_id || c.file_id) ? `
        <div class="section-title">How it's made</div>
        <div class="card stack">
          ${c.entry_id ? `
            <button type="button" class="btn btn--block" id="open-entry">
              ${icons.library}<span>${esc(c.entry_title || 'Open the setting')}</span>
            </button>` : ''}
          ${c.file_id ? `
            <a class="btn btn--block" href="/api/files/${esc(c.file_id)}/raw" download>
              ${icons.download}<span>${esc(c.file_name || 'Download the file')}</span>
            </a>` : ''}
        </div>` : ''}

      ${c.warnings.length ? `
        <div class="card" style="background:var(--warn-dim);border-color:rgba(251,191,36,.3)">
          ${c.warnings.map((w) => `<div class="small" style="color:var(--warn)">${esc(w)}</div>`).join('')}
        </div>` : ''}

      <button class="btn btn--block" id="build">${icons.check}<span>I made ${num(qty, 0)} — take it out of stock</span></button>`;

    const openEntry = $('#open-entry', body);
    if (openEntry) {
      openEntry.addEventListener('click', async () => {
        try {
          const entry = await api.get(`/api/entries/${c.entry_id}`);
          closeSheet();
          openEntryDetail(entry, ctx, onChanged);
        } catch { toast('That setting has been deleted', 'bad'); }
      });
    }

    $('.chips', body).onclick = (e) => {
      const b = e.target.closest('[data-qty]');
      if (!b) return;
      qty = Number(b.dataset.qty);
      keepFocus = false;
      load();
    };

    // Typing a quantity rebuilds the costing, so the listeners go on first —
    // anything that throws while restoring focus must not leave the box dead.
    const qtyInput = $('#qty-input', body);

    let typing;
    qtyInput.addEventListener('input', () => {
      clearTimeout(typing);
      typing = setTimeout(() => {
        const n = Math.min(Math.max(Math.round(Number(qtyInput.value) || 1), 1), 100000);
        if (n === qty) return;
        qty = n;
        keepFocus = true;
        load();
      }, 450);
    });

    // Enter closes the keyboard on a phone rather than doing nothing.
    qtyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); qtyInput.blur(); }
    });

    // Put the cursor back after the re-render. A number input refuses
    // setSelectionRange, so that part is best-effort only.
    if (keepFocus) {
      qtyInput.focus();
      try {
        const v = qtyInput.value;
        qtyInput.setSelectionRange(v.length, v.length);
      } catch { /* number inputs don't support selection — focus is enough */ }
    }

    $('#build', body).addEventListener('click', async () => {
      const r = await api.post(`/api/products/${id}/build`, { qty, log_project: true });
      if (r.short?.length) {
        toast(`Stock went negative on ${r.short.map((s) => s.name).join(', ')}`, 'bad');
      } else {
        toast(`Stock updated for ${qty}`);
      }
      onChanged?.();
      load();
    });
  };

  await load();

  openSheet({
    title: 'Pricing',
    body,
    wide: true,
    actions: [
      { label: 'Edit recipe', icon: icons.edit, onClick: async () => {
          const p = await api.get(`/api/products/${id}`);
          openProductEditor(p, ctx, onChanged);
          return true;
        } },
      { label: 'Done', kind: 'primary', onClick: () => onChanged?.() },
    ],
  });
}

/* --------------------------------------------------------------- editor */

export function openProductEditor(product, ctx, onSaved) {
  const p = product || {};
  const isNew = !p.id;
  const supplies = ctx.supplies || [];
  let lines = (p.lines || []).map((l) => ({ ...l }));

  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    ${field({ label: 'Product name', name: 'name', value: p.name,
      placeholder: 'Engraved coaster set (4)' })}
    <div class="field-row">
      ${field({ label: 'Makes per run', name: 'makes_qty', value: p.makes_qty ?? 1,
        type: 'number', step: 'any', min: 0.0001,
        hint: 'One run of 4 coasters = 4' })}
      ${selectField({ label: 'Machine', name: 'machine_id', value: p.machine_id,
        options: (ctx.machines || []).map((m) => ({ value: m.id, label: m.name })),
        blank: 'No machine' })}
    </div>

    <div class="section-title">Time</div>
    <div class="field-row field-row--3">
      ${field({ label: 'Setup min', name: 'setup_minutes', value: p.setup_minutes,
        type: 'number', step: 'any', hint: 'Once per batch' })}
      ${field({ label: 'Machine min', name: 'machine_minutes', value: p.machine_minutes,
        type: 'number', step: 'any', hint: 'Per run' })}
      ${field({ label: 'Your min', name: 'labour_minutes', value: p.labour_minutes,
        type: 'number', step: 'any', hint: 'Per run' })}
    </div>
    ${field({ label: 'Other cost per run', name: 'other_cost', value: p.other_cost,
      type: 'number', step: '0.01', hint: 'Anything not in the parts list' })}

    <div class="section-title">How it's made</div>
    <span class="field__hint" style="margin-top:-6px">
      Linking the setting and the file means you are one tap from the numbers and
      the artwork when a repeat order comes in, instead of hunting for both.
    </span>
    ${selectField({ label: 'Setting it runs at', name: 'entry_id', value: p.entry_id,
      options: (ctx.entries || []).map((en) => ({
        value: en.id,
        label: [en.title || en.material_name || 'Untitled',
                en.machine_name, en.speed != null ? `${en.speed}${en.speed_unit || ''}` : null]
          .filter(Boolean).join(' · '),
      })), blank: 'Not linked' })}
    ${selectField({ label: 'Design file', name: 'file_id', value: p.file_id,
      options: (ctx.productFiles || []).map((f) => ({
        value: f.id, label: f.folder ? `${f.name} — ${f.folder}` : f.name,
      })), blank: 'Not linked' })}

    <div class="section-title">What it's made of</div>
    <div id="lines" class="stack"></div>
    <button type="button" class="btn btn--sm" id="add-line">${icons.plus}<span>Add a part</span></button>

    <div class="section-title">Live costing</div>
    <div id="costing" class="card"><div class="small muted">Fill in the recipe…</div></div>

    ${textareaField({ label: 'Notes', name: 'notes', value: p.notes, rows: 2 })}`;

  const linesHost = $('#lines', body);
  const costingHost = $('#costing', body);

  const drawLines = () => {
    linesHost.innerHTML = lines.length ? lines.map((l, i) => `
      <div class="card" style="padding:12px" data-line="${i}">
        <div class="field-row" style="grid-template-columns:2fr 1fr">
          <div class="field">
            <label class="field__label">Supply</label>
            <select data-f="supply_id">
              <option value="">— pick one —</option>
              ${supplies.map((s) => `<option value="${esc(s.id)}" ${s.id === l.supply_id ? 'selected' : ''}>
                ${esc(s.name)} (${esc(s.unit)})</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label">How much</label>
            <input type="number" step="any" inputmode="decimal" data-f="qty" value="${esc(l.qty ?? 1)}">
          </div>
        </div>
        <div class="field-row" style="grid-template-columns:1fr 1fr auto;align-items:end">
          <div class="field">
            <label class="field__label">Measured in</label>
            <select data-f="unit">
              ${LINE_UNITS.map((u) => `<option value="${u.value}" ${u.value === (l.unit || '') ? 'selected' : ''}>
                ${esc(u.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label">Note</label>
            <input type="text" data-f="note" value="${esc(l.note || '')}" placeholder="optional">
          </div>
          <button type="button" class="btn btn--icon btn--ghost" data-del="${i}"
            aria-label="Remove">${icons.trash}</button>
        </div>
      </div>`).join('') : '<div class="small muted">Nothing yet — add a part.</div>';
  };

  let timer;
  const recost = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const d = readForm(body);
      try {
        const c = await api.post('/api/products/preview?qty=' + (Number(d.makes_qty) || 1),
          { ...d, lines });
        costingHost.innerHTML = `
          <div class="kv"><span class="kv__k">Materials</span>
            <span class="kv__v">${money(c.breakdown.materials)}</span></div>
          <div class="kv"><span class="kv__k">Machine + your time</span>
            <span class="kv__v">${money(c.breakdown.machine + c.breakdown.labour)}</span></div>
          <div class="kv"><span class="kv__k"><strong>Cost per unit</strong></span>
            <span class="kv__v"><strong>${money(c.breakdown.per_unit)}</strong></span></div>
          <div style="margin-top:10px" class="params">
            ${c.prices.map((pr) => `
              <div class="param ${pr.key === 'online' ? 'param--hero' : ''}">
                <span class="param__label">${esc(pr.label)}</span>
                <span class="param__value">${money(pr.each)}</span>
              </div>`).join('')}
          </div>
          ${c.warnings.length ? `<div class="small" style="color:var(--warn);margin-top:10px">
            ${c.warnings.map(esc).join('<br>')}</div>` : ''}`;
      } catch {
        costingHost.innerHTML = '<div class="small muted">Could not cost that yet.</div>';
      }
    }, 300);
  };

  const readLines = () => {
    lines = $$('[data-line]', linesHost).map((row) => {
      const o = {};
      for (const f of $$('[data-f]', row)) {
        const k = f.dataset.f;
        o[k] = f.type === 'number' ? (f.value === '' ? null : Number(f.value)) : f.value;
      }
      return o;
    });
  };

  drawLines();
  recost();

  linesHost.addEventListener('input', () => { readLines(); recost(); });
  linesHost.addEventListener('change', () => { readLines(); recost(); });
  linesHost.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    readLines();
    lines.splice(Number(del.dataset.del), 1);
    drawLines();
    recost();
  });

  $('#add-line', body).addEventListener('click', () => {
    readLines();
    lines.push({ supply_id: '', qty: 1, unit: '', note: '' });
    drawLines();
  });

  body.addEventListener('input', (e) => {
    if (!e.target.closest('#lines')) recost();
  });

  openSheet({
    title: isNew ? 'New product' : p.name || 'Product',
    body,
    wide: true,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete product?', 'The recipe goes; your stock is untouched.')) {
          await api.del(`/api/products/${p.id}`);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        readLines();
        const d = readForm(body);
        if (!d.name) { toast('Name is required', 'bad'); return true; }
        const payload = { ...d, lines: lines.filter((l) => l.supply_id) };
        if (p.id) await api.put(`/api/products/${p.id}`, payload);
        else await api.post('/api/products', payload);
        toast('Saved');
        onSaved?.();
      } },
    ],
  });
}

/* ---------------------------------------------------------------- rates */

export function openRatesSheet(onSaved) {
  const body = el('<form class="stack"></form>');

  api.get('/api/pricing').then((cfg) => {
    body.innerHTML = `
      <div class="small muted">
        Your time is part of the cost, so the profit figures are what's left
        <em>after</em> paying yourself.
      </div>
      <div class="field-row">
        ${field({ label: 'Your rate $/hr', name: 'labour_rate', value: cfg.labour_rate,
          type: 'number', step: 'any' })}
        ${field({ label: 'Machine $/hr', name: 'machine_rate', value: cfg.machine_rate,
          type: 'number', step: 'any', hint: 'Power, wear, consumables' })}
      </div>
      ${field({ label: 'Round prices up to', name: 'round_to', value: cfg.round_to,
        type: 'number', step: 'any', hint: '0.5 gives $12.50, $13.00…' })}

      <div class="section-title">Channels</div>
      ${cfg.channels.map((ch, i) => `
        <div class="card" style="padding:12px" data-ch="${i}">
          <div style="font-weight:620;margin-bottom:8px">${esc(ch.label)}</div>
          <div class="field-row">
            <div class="field">
              <label class="field__label">Markup ×</label>
              <input type="number" step="any" inputmode="decimal" data-c="markup" value="${esc(ch.markup)}">
            </div>
            <div class="field">
              <label class="field__label">Fees %</label>
              <input type="number" step="any" inputmode="decimal" data-c="fee_pct" value="${esc(ch.fee_pct)}">
            </div>
          </div>
          ${ch.note ? `<div class="field__hint" style="margin-top:6px">${esc(ch.note)}</div>` : ''}
          <input type="hidden" data-c="key" value="${esc(ch.key)}">
          <input type="hidden" data-c="label" value="${esc(ch.label)}">
          <input type="hidden" data-c="note" value="${esc(ch.note || '')}">
        </div>`).join('')}

      <div class="field__hint">
        Fees are taken out of the listed price, not added to it — a 9.5% fee means
        the app lists at cost×markup ÷ 0.905 so you actually keep what you intended.
      </div>`;
  });

  openSheet({
    title: 'Rates & channels',
    body,
    actions: [
      { label: 'Cancel', onClick: () => {} },
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const d = readForm(body);
        const channels = $$('[data-ch]', body).map((row) => {
          const o = {};
          for (const f of $$('[data-c]', row)) o[f.dataset.c] = f.value;
          return o;
        });
        await api.put('/api/pricing', {
          labour_rate: Number(d.labour_rate),
          machine_rate: Number(d.machine_rate),
          round_to: Number(d.round_to),
          channels,
        });
        toast('Saved');
        onSaved?.();
      } },
    ],
  });
}
