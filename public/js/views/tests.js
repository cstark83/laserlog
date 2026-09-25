/*
 * LaserLog — material test grids.
 *
 * You run a speed/power matrix on the machine, then tap each square here to
 * record how it came out. The best square gets promoted into a real saved
 * setting, carrying the axis values and the held-constant parameters with it.
 */
import * as api from '../api.js';
import {
  $, el, esc, num, icons, relTime, openSheet, closeSheet, confirmSheet, toast,
  readForm, field, selectField, textareaField, switchField, empty, thickness, stars,
  OPERATIONS, OUTCOMES, opLabel,
} from '../ui.js';
import { photoStrip } from './photos.js';

const AXES = [
  { value: 'speed', label: 'Speed' },
  { value: 'power', label: 'Power %' },
  { value: 'passes', label: 'Passes' },
  { value: 'interval', label: 'Line interval' },
  { value: 'focus', label: 'Focus offset' },
  { value: 'dpi', label: 'DPI' },
  // The two that matter for MOPA colour work.
  { value: 'frequency', label: 'Frequency kHz' },
  { value: 'pulse_width', label: 'Pulse width ns' },
];

export const LENSES = [75, 150, 300];

const axisLabel = (a) => AXES.find((x) => x.value === a)?.label || a || '—';

/** Value at step i along an axis, inclusive of both ends. */
const stepValue = (min, max, steps, i) => {
  if (steps <= 1) return min;
  return Number((min + ((max - min) / (steps - 1)) * i).toFixed(4));
};

export async function renderTests(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Test grids</h1><p>Run a matrix, rate the squares, keep the winner.</p></div>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  const out = $('#out', root);
  let rows = [];
  try { rows = await api.get('/api/tests'); }
  catch { out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.'); return; }

  if (!rows.length) {
    out.innerHTML = empty(icons.grid, 'No test grids yet',
      'Set up a speed vs power matrix before you burn a new material — then record which square won.');
    return;
  }

  out.innerHTML = `<div class="list">${rows.map((t) => `
    <div class="listitem" data-id="${esc(t.id)}">
      <div class="listitem__main">
        <div class="listitem__title">${esc(t.name)}</div>
        <div class="listitem__sub">
          ${esc(axisLabel(t.x_axis))} × ${esc(axisLabel(t.y_axis))}
          · ${t.x_steps || 0}×${t.y_steps || 0}
          ${t.operation ? '· ' + esc(opLabel(t.operation)) : ''}
          · ${relTime(t.updated_at)}
        </div>
      </div>
      ${(t.winner_col != null) ? '<span class="badge badge--ok">Winner picked</span>' : ''}
      <span class="listitem__chev">${icons.chevron}</span>
    </div>`).join('')}</div>`;

  out.onclick = async (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const full = await api.get(`/api/tests/${item.dataset.id}`);
    openTestGrid(full, ctx, () => renderTests(root, ctx));
  };
}

/* ------------------------------------------------------------- the grid */

export function openTestGrid(test, ctx, onChanged) {
  const body = el('<div class="stack"></div>');
  const cells = new Map((test.cells || []).map((c) => [`${c.col},${c.row}`, c]));

  const fixed = test.fixed_json ? JSON.parse(test.fixed_json) : {};
  const material = (ctx.materials || []).find((m) => m.id === test.material_id);
  const machine = (ctx.machines || []).find((m) => m.id === test.machine_id);

  const draw = () => {
    const cols = test.x_steps || 1;
    const rowsN = test.y_steps || 1;

    let table = '<table class="tgrid"><thead><tr><th></th>';
    for (let c = 0; c < cols; c++) {
      table += `<th>${num(stepValue(test.x_min, test.x_max, cols, c), 2)}</th>`;
    }
    table += '</tr></thead><tbody>';

    // Top row = highest Y value, so it reads like a graph.
    for (let r = rowsN - 1; r >= 0; r--) {
      table += `<tr><th>${num(stepValue(test.y_min, test.y_max, rowsN, r), 2)}</th>`;
      for (let c = 0; c < cols; c++) {
        const cell = cells.get(`${c},${r}`);
        const rating = cell?.rating || 0;
        const isWinner = test.winner_col === c && test.winner_row === r;
        table += `<td>
          <button class="tcell ${rating ? 'r' + rating : ''} ${isWinner ? 'is-winner' : ''}"
                  data-c="${c}" data-r="${r}">
            <span class="tcell__r">${rating ? rating : '·'}</span>
            ${cell?.outcome ? `<span>${cell.outcome === 'success' ? '✓' : cell.outcome === 'fail' ? '✕' : '~'}</span>` : ''}
          </button></td>`;
      }
      table += '</tr>';
    }
    table += '</tbody></table>';

    body.innerHTML = `
      <div class="small muted">
        ${[machine?.name, material ? material.name + (material.thickness_mm ? ` ${thickness(material.thickness_mm)}` : '') : null,
           test.operation ? opLabel(test.operation) : null].filter(Boolean).map(esc).join(' · ')}
      </div>
      <div class="card" style="padding:12px">
        <div class="small muted center" style="margin-bottom:8px">
          <strong>${esc(axisLabel(test.y_axis))}</strong> (down) ×
          <strong>${esc(axisLabel(test.x_axis))}</strong> (across) — tap a square to rate it
        </div>
        <div class="tgrid-wrap">${table}</div>
      </div>
      ${Object.keys(fixed).length ? `
        <div class="card">
          <div class="field__label" style="margin-bottom:6px">Held constant</div>
          ${Object.entries(fixed).map(([k, v]) => {
            const label = k.replace(/_mm$/, '').replace(/_/g, ' ');
            const shown = k === 'air_assist' ? (v ? 'Yes' : 'No')
                        : k.endsWith('_mm') ? `${num(v, 3)} mm` : v;
            return `<div class="kv"><span class="kv__k">${esc(label)}</span>
              <span class="kv__v kv__v--mono">${esc(shown)}</span></div>`;
          }).join('')}
        </div>` : ''}
      ${test.notes ? `<div class="card"><div style="white-space:pre-wrap">${esc(test.notes)}</div></div>` : ''}
      <div id="photos"></div>`;

    photoStrip($('#photos', body), 'test', test.id, test.photos || []);

    $('.tgrid', body).addEventListener('click', (e) => {
      const b = e.target.closest('.tcell');
      if (!b) return;
      rateCell(Number(b.dataset.c), Number(b.dataset.r));
    });
  };

  const rateCell = (c, r) => {
    const cols = test.x_steps || 1;
    const rowsN = test.y_steps || 1;
    const xv = stepValue(test.x_min, test.x_max, cols, c);
    const yv = stepValue(test.y_min, test.y_max, rowsN, r);
    const cell = cells.get(`${c},${r}`) || {};

    const form = el('<form class="stack"></form>');
    form.innerHTML = `
      <div class="card" style="padding:12px 16px">
        <div class="kv"><span class="kv__k">${esc(axisLabel(test.x_axis))}</span>
          <span class="kv__v kv__v--mono">${num(xv, 2)}</span></div>
        <div class="kv"><span class="kv__k">${esc(axisLabel(test.y_axis))}</span>
          <span class="kv__v kv__v--mono">${num(yv, 2)}</span></div>
      </div>
      <div class="field">
        <span class="field__label">Rating</span>
        <div class="chips" style="margin-top:4px">
          ${[1, 2, 3, 4, 5].map((n) => `
            <button type="button" class="chip ${cell.rating === n ? 'is-on' : ''}"
                    data-rate="${n}">${n}</button>`).join('')}
        </div>
      </div>
      ${selectField({ label: 'Outcome', name: 'outcome', value: cell.outcome,
        options: OUTCOMES, blank: 'Not recorded' })}
      ${textareaField({ label: 'Notes', name: 'notes', value: cell.notes,
        placeholder: 'Cut through cleanly, slight char on the back.', rows: 2 })}`;

    let rating = cell.rating || 0;
    form.querySelector('.chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rate]');
      if (!b) return;
      rating = rating === Number(b.dataset.rate) ? 0 : Number(b.dataset.rate);
      [...form.querySelectorAll('[data-rate]')].forEach((x) =>
        x.classList.toggle('is-on', Number(x.dataset.rate) === rating));
    });

    openSheet({
      title: `Square ${c + 1} × ${r + 1}`,
      body: form,
      actions: [
        { label: 'Make this the winner', icon: icons.star, onClick: async () => {
            const d = readForm(form);
            await api.put(`/api/tests/${test.id}/cells/${c}/${r}`,
              { x_value: xv, y_value: yv, rating, outcome: d.outcome, notes: d.notes });
            const entry = await api.post(`/api/tests/${test.id}/promote`, { col: c, row: r });
            toast('Saved to your settings library');
            test.winner_col = c; test.winner_row = r;
            cells.set(`${c},${r}`, { ...cell, col: c, row: r, rating, outcome: d.outcome, notes: d.notes });
            draw();
            onChanged?.();
          } },
        { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
            const d = readForm(form);
            const saved = await api.put(`/api/tests/${test.id}/cells/${c}/${r}`,
              { x_value: xv, y_value: yv, rating, outcome: d.outcome, notes: d.notes });
            cells.set(`${c},${r}`, saved);
            draw();
          } },
      ],
    });
  };

  draw();

  openSheet({
    title: test.name,
    body,
    wide: true,
    actions: [
      { label: 'Edit setup', icon: icons.edit, onClick: () => {
          openTestEditor(test, ctx, onChanged); return true;
        } },
      { label: 'Get the file', icon: icons.download, onClick: () => {
          openFileSheet(test); return true;
        } },
      { label: 'Done', kind: 'primary', onClick: () => { onChanged?.(); } },
    ],
  });
}

/* --------------------------------------------------- download the file */

/**
 * The grid as a runnable file. The .lbrn arrives with one layer per square,
 * already set — the transcribing step is where material tests usually go wrong.
 */
function openFileSheet(test) {
  const cells = (test.x_steps || 1) * (test.y_steps || 1);

  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    <div id="capacity"></div>

    <div class="field-row field-row--3">
      ${field({ label: 'Square mm', name: 'cell', value: 10, type: 'number', step: 'any', min: 1 })}
      ${field({ label: 'Gap mm', name: 'gap', value: 3, type: 'number', step: 'any', min: 0 })}
      ${field({ label: 'Label mm', name: 'labelSize', value: 3, type: 'number', step: 'any', min: 1 })}
    </div>
    ${switchField({ label: 'Engrave the axis numbers', name: 'label', checked: true })}
    <span class="field__hint">
      Numbers are burnt next to the rows and columns so the piece still makes sense
      on the bench without the app. If your LightBurn reads them oddly, turn this
      off — the squares themselves are unaffected.
    </span>
    <div id="dl"></div>`;

  const link = () => {
    const d = readForm(body);
    const p = new URLSearchParams({
      cell: d.cell ?? 10, gap: d.gap ?? 3,
      labelSize: d.labelSize ?? 3, label: d.label ? '1' : '0',
    });
    return `/api/tests/${test.id}/file?${p.toString()}`;
  };

  const draw = () => {
    // LightBurn has 30 cut layers. With the axis numbers engraved, the legend
    // takes one of them, so the capacity depends on that switch.
    const labelled = readForm(body).label;
    const max = labelled ? 29 : 30;
    const tooBig = cells > max;

    $('#capacity', body).innerHTML = tooBig
      ? `<div class="card" style="background:var(--bad-dim);border-color:rgba(248,113,113,.3)">
           <div class="small" style="color:var(--bad)">
             ${cells} squares — LightBurn has 30 cut layers${labelled
               ? ', and the engraved numbers use one of them' : ''}.
             Drop the grid to ${max} squares or fewer${labelled
               ? ', or switch the numbers off to get all 30' : ''}.
           </div>
         </div>`
      : `<div class="small muted">
           ${cells} squares, each on its own LightBurn layer with its settings already
           filled in. Open it, frame it, check the cut list, run it.
         </div>`;

    $('#dl', body).innerHTML = tooBig ? '' : `
      <a class="btn btn--primary btn--block" href="${link()}&format=lbrn" download>
        ${icons.download}<span>Download .lbrn for LightBurn</span></a>
      <a class="btn btn--block" href="${link()}&format=svg" download style="margin-top:8px">
        ${icons.download}<span>Download .svg (settings not included)</span></a>`;
  };
  draw();
  body.addEventListener('input', draw);

  openSheet({
    title: 'Test grid file',
    body,
    actions: [{ label: 'Done', kind: 'primary', onClick: () => {} }],
  });
}

/* ------------------------------------------------------------- editor */

export function openTestEditor(test, ctx, onSaved) {
  const t = test || {};
  const isNew = !t.id;
  const fixed = t.fixed_json ? JSON.parse(t.fixed_json) : {};
  const machines = ctx.machines || [];
  const materials = ctx.materials || [];

  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    ${field({ label: 'Test name', name: 'name', value: t.name,
      placeholder: '3mm ply — speed vs power' })}
    <div class="field-row">
      ${selectField({ label: 'Machine', name: 'machine_id', value: t.machine_id,
        options: machines.map((m) => ({ value: m.id, label: m.name })), blank: 'No machine' })}
      ${selectField({ label: 'Operation', name: 'operation', value: t.operation || 'cut',
        options: OPERATIONS, blank: null })}
    </div>
    ${selectField({ label: 'Material', name: 'material_id', value: t.material_id,
      options: materials.map((m) => ({
        value: m.id, label: m.name + (m.thickness_mm ? ` — ${thickness(m.thickness_mm)}` : ''),
      })), blank: 'No material' })}

    <div class="section-title">Across (columns)</div>
    <div class="field-row field-row--3">
      ${selectField({ label: 'Axis', name: 'x_axis', value: t.x_axis || 'speed',
        options: AXES, blank: null })}
      ${field({ label: 'From', name: 'x_min', value: t.x_min ?? 200, type: 'number', step: 'any' })}
      ${field({ label: 'To', name: 'x_max', value: t.x_max ?? 1200, type: 'number', step: 'any' })}
    </div>
    ${field({ label: 'Columns', name: 'x_steps', value: t.x_steps ?? 6, type: 'number',
      min: 2, max: 12 })}

    <div class="section-title">Down (rows)</div>
    <div class="field-row field-row--3">
      ${selectField({ label: 'Axis', name: 'y_axis', value: t.y_axis || 'power',
        options: AXES, blank: null })}
      ${field({ label: 'From', name: 'y_min', value: t.y_min ?? 20, type: 'number', step: 'any' })}
      ${field({ label: 'To', name: 'y_max', value: t.y_max ?? 100, type: 'number', step: 'any' })}
    </div>
    ${field({ label: 'Rows', name: 'y_steps', value: t.y_steps ?? 5, type: 'number',
      min: 2, max: 12 })}

    <div class="section-title">Held constant</div>
    <div class="field-row field-row--3">
      ${field({ label: 'Passes', name: 'fx_passes', value: fixed.passes, type: 'number', min: 1 })}
      ${field({ label: 'Interval mm', name: 'fx_line_interval_mm', value: fixed.line_interval_mm,
        type: 'number', step: 'any' })}
      ${field({ label: 'Focus mm', name: 'fx_focus_offset_mm', value: fixed.focus_offset_mm,
        type: 'number', step: 'any' })}
    </div>
    <div class="field-row field-row--3">
      ${field({ label: 'Speed', name: 'fx_speed', value: fixed.speed, type: 'number', step: 'any' })}
      ${field({ label: 'Power %', name: 'fx_power_max', value: fixed.power_max, type: 'number', step: 'any' })}
      ${field({ label: 'Freq kHz', name: 'fx_frequency_khz', value: fixed.frequency_khz,
        type: 'number', step: 'any' })}
    </div>
    <label class="switch">
      <input type="checkbox" name="fx_air_assist" ${fixed.air_assist ? 'checked' : ''}>
      <span class="switch__track"></span>
      <span class="field__label" style="margin:0">Air assist on</span>
    </label>

    <div class="section-title">Setup this grid was run on</div>
    <div class="field-row">
      ${selectField({ label: 'Lens', name: 'lens_mm', value: t.lens_mm,
        options: LENSES.map((l) => ({ value: l, label: `${l}mm` })), blank: 'Not recorded',
        hint: 'Settings do not carry between lenses' })}
      <div></div>
    </div>
    ${switchField({ label: 'Run on the rotary', name: 'rotary', checked: t.rotary })}
    ${textareaField({ label: 'Notes', name: 'notes', value: t.notes,
      placeholder: 'Masked both sides. 10mm squares, 2mm gap.' })}`;

  openSheet({
    title: isNew ? 'New test grid' : 'Edit test',
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete test grid?', 'Every recorded square goes with it.')) {
          await api.remove('tests', t.id);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const d = readForm(body);
        if (!d.name) { toast('Name is required', 'bad'); return true; }

        const fx = {};
        for (const [k, v] of Object.entries(d)) {
          if (k.startsWith('fx_') && v !== null && v !== 0) fx[k.slice(3)] = v;
          if (k.startsWith('fx_')) delete d[k];
        }
        d.fixed_json = Object.keys(fx).length ? JSON.stringify(fx) : null;

        if (d.x_axis === d.y_axis) { toast('Pick two different axes', 'bad'); return true; }
        if (t.id) d.id = t.id;

        const saved = await api.save('tests', d);
        toast('Saved');
        onSaved?.();
        if (isNew && saved.id && !saved._pending) {
          const full = await api.get(`/api/tests/${saved.id}`);
          openTestGrid(full, ctx, onSaved);
        }
      } },
    ],
  });
}
