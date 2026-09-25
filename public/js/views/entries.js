/* LaserLog — the settings library: list, detail and editor. */
import * as api from '../api.js';
import {
  $, $$, el, esc, num, icons, stars, thickness, relTime, openSheet, closeSheet,
  confirmSheet, toast, readForm, field, selectField, textareaField, switchField,
  ratingField, bindRating, OPERATIONS, OUTCOMES, outcomeBadge, opLabel, empty,
  hazardBadge, hazardBanner,
} from '../ui.js';
import { photoStrip } from './photos.js';
import { fieldGroupsFor, LENSES } from '../presets.js';
import { startTimer, activeTimer } from '../timer.js';

const filters = {
  q: '', machine_id: '', material_id: '', operation: '', favorite: false, min_rating: '',
};

/** Compare mode: pick a few settings and see them side by side. */
const compare = { on: false, ids: new Set() };

/* ------------------------------------------------------------ rendering */

export function entryCard(e) {
  const params = [];
  if (e.speed != null) {
    params.push(['Speed', num(e.speed, 0), e.speed_unit || 'mm/min', true]);
  }
  if (e.power_max != null) {
    const p = e.power_min != null && e.power_min !== e.power_max
      ? `${num(e.power_min, 0)}–${num(e.power_max, 0)}` : num(e.power_max, 0);
    params.push(['Power', p, '%', true]);
  }
  if (e.passes != null) params.push(['Passes', num(e.passes, 0), '', false]);
  if (e.line_interval_mm != null) params.push(['Interval', num(e.line_interval_mm, 3), 'mm', false]);
  if (e.dpi != null) params.push(['DPI', num(e.dpi, 0), '', false]);
  if (e.focus_offset_mm != null) params.push(['Focus', num(e.focus_offset_mm, 2), 'mm', false]);

  const sub = [
    e.material_name ? esc(e.material_name) + (e.material_thickness ? ` ${thickness(e.material_thickness)}` : '') : null,
    e.machine_name ? esc(e.machine_name) : null,
  ].filter(Boolean);

  return `
    <article class="entry" data-entry="${esc(e.id)}">
      <div class="entry__head">
        <div style="flex:1;min-width:0">
          <div class="entry__title">${esc(e.title || e.material_name || 'Untitled setting')}</div>
          <div class="entry__sub">
            ${e.operation ? `<span class="badge badge--op">${esc(opLabel(e.operation))}</span>` : ''}
            ${hazardBadge(e.material_hazard)}
            ${e.air_assist ? '<span class="badge">air</span>' : ''}
            ${sub.map((s, i) => `<span style="display:inline-flex;align-items:center;gap:6px">${
              i ? '<span class="dot"></span>' : ''}${s}</span>`).join('')}
          </div>
        </div>
        <button class="fav ${e.is_favorite ? 'is-on' : ''}" data-fav="${esc(e.id)}"
                aria-label="Favourite">${icons.star}</button>
      </div>
      <div class="params">
        ${params.map(([label, value, unit, hero]) => `
          <div class="param ${hero ? 'param--hero' : ''}">
            <span class="param__label">${label}</span>
            <span class="param__value">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
          </div>`).join('')}
      </div>
      ${(e.rating || e.outcome || e.photos?.length) ? `
        <div class="row row--wrap" style="gap:8px">
          ${e.rating ? stars(e.rating) : ''}
          ${outcomeBadge(e.outcome)}
          ${e.photos?.length ? `<span class="badge">${icons.camera} ${e.photos.length}</span>` : ''}
          <span class="spacer"></span>
          <span class="small muted nowrap">${relTime(e.updated_at)}</span>
        </div>` : ''}
    </article>`;
}

export async function renderEntries(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Settings library</h1>
        <p>Every combination you've proven on the machine.</p>
      </div>
    </div>
    <div class="stack" style="margin-bottom:16px">
      <div class="searchbar">
        ${icons.search}
        <input type="search" id="q" placeholder="Search material, machine, notes…"
               value="${esc(filters.q)}" autocomplete="off">
      </div>
      <div class="chips" id="chips"></div>
      <div class="row" style="gap:8px">
        <button class="btn btn--sm ${compare.on ? 'btn--primary' : ''}" id="cmp-toggle">
          ${icons.sliders}<span>${compare.on ? 'Cancel compare' : 'Compare'}</span>
        </button>
        <button class="btn btn--sm btn--primary" id="cmp-go" style="display:none"></button>
      </div>
    </div>
    <div id="results" class="stack"><div class="skeleton"></div><div class="skeleton"></div></div>`;

  const [machines, materials] = await Promise.all([
    api.get('/api/machines').catch(() => []),
    api.get('/api/materials').catch(() => []),
  ]);
  ctx.machines = machines; ctx.materials = materials;

  renderChips($('#chips', root), machines, materials, () => load(root, ctx));

  const q = $('#q', root);
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { filters.q = q.value.trim(); load(root, ctx); }, 220);
  });

  $('#cmp-toggle', root).addEventListener('click', () => {
    compare.on = !compare.on;
    compare.ids.clear();
    renderEntries(root, ctx);
  });

  $('#cmp-go', root).addEventListener('click', () => {
    const picked = (ctx.entries || []).filter((e) => compare.ids.has(e.id));
    if (picked.length >= 2) openCompare(picked, ctx);
  });

  await load(root, ctx);
}

function syncCompareBar(root) {
  const go = $('#cmp-go', root);
  if (!go) return;
  const n = compare.ids.size;
  go.style.display = compare.on && n >= 1 ? '' : 'none';
  go.disabled = n < 2;
  go.innerHTML = `${icons.sliders}<span>Compare ${n} setting${n === 1 ? '' : 's'}</span>`;
}

function renderChips(host, machines, materials, onChange) {
  const chip = (label, on, attrs = '') =>
    `<button class="chip ${on ? 'is-on' : ''}" ${attrs}>${esc(label)}</button>`;

  host.innerHTML = [
    chip('★ Favourites', filters.favorite, 'data-f="favorite"'),
    ...OPERATIONS.map((o) => chip(o.label, filters.operation === o.value, `data-op="${o.value}"`)),
    machines.length > 1
      ? `<select class="chip" data-sel="machine_id" style="max-width:150px">
           <option value="">All machines</option>
           ${machines.map((m) => `<option value="${esc(m.id)}" ${filters.machine_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
         </select>` : '',
    materials.length
      ? `<select class="chip" data-sel="material_id" style="max-width:170px">
           <option value="">All materials</option>
           ${materials.map((m) => `<option value="${esc(m.id)}" ${filters.material_id === m.id ? 'selected' : ''}>${esc(m.name)}${m.thickness_mm ? ' ' + thickness(m.thickness_mm) : ''}</option>`).join('')}
         </select>` : '',
  ].join('');

  host.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b || b.tagName === 'SELECT') return;
    if (b.dataset.f === 'favorite') filters.favorite = !filters.favorite;
    if (b.dataset.op) filters.operation = filters.operation === b.dataset.op ? '' : b.dataset.op;
    renderChips(host, machines, materials, onChange);
    onChange();
  });

  host.addEventListener('change', (e) => {
    const s = e.target.closest('[data-sel]');
    if (!s) return;
    filters[s.dataset.sel] = s.value;
    onChange();
  });
}

async function load(root, ctx) {
  const out = $('#results', root);
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.machine_id) p.set('machine_id', filters.machine_id);
  if (filters.material_id) p.set('material_id', filters.material_id);
  if (filters.operation) p.set('operation', filters.operation);
  if (filters.favorite) p.set('favorite', '1');
  if (filters.min_rating) p.set('min_rating', filters.min_rating);

  let rows = [];
  try { rows = await api.get('/api/entries?' + p.toString()); }
  catch { out.innerHTML = empty(icons.warn, 'Could not load', 'No connection and nothing cached yet.'); return; }

  ctx.entries = rows;

  if (rows.length === 0) {
    const anyFilter = filters.q || filters.operation || filters.machine_id ||
                      filters.material_id || filters.favorite;
    out.innerHTML = anyFilter
      ? empty(icons.search, 'Nothing matches', 'Try clearing a filter or widening the search.')
      : empty(icons.library, 'No settings yet',
              'Add the first one after your next test cut — speed, power, passes and whether it worked.');
    return;
  }

  out.innerHTML = rows.map(entryCard).join('');
  paintSelection(out);
  syncCompareBar(root);

  out.onclick = async (e) => {
    if (compare.on) {
      const card = e.target.closest('[data-entry]');
      if (!card) return;
      const id = card.dataset.entry;
      if (compare.ids.has(id)) compare.ids.delete(id);
      else if (compare.ids.size >= 4) { toast('Four at a time is the limit', 'bad'); return; }
      else compare.ids.add(id);
      paintSelection(out);
      syncCompareBar(root);
      return;
    }

    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      const row = rows.find((r) => r.id === fav.dataset.fav);
      const next = row.is_favorite ? 0 : 1;
      fav.classList.toggle('is-on', Boolean(next));
      row.is_favorite = next;
      await api.save('entries', { id: row.id, is_favorite: next });
      return;
    }
    const card = e.target.closest('[data-entry]');
    if (card) {
      const row = rows.find((r) => r.id === card.dataset.entry);
      if (row) openEntryDetail(row, ctx, () => load(root, ctx));
    }
  };
}

function paintSelection(out) {
  for (const card of $$('[data-entry]', out)) {
    const on = compare.on && compare.ids.has(card.dataset.entry);
    card.style.borderColor = on ? 'var(--accent)' : '';
    card.style.background = on ? 'var(--accent-dim)' : '';
  }
}

/* -------------------------------------------------------------- compare */

const CMP_ROWS = [
  ['Machine', (e) => e.machine_name],
  ['Material', (e) => e.material_name
    ? e.material_name + (e.material_thickness ? ` ${thickness(e.material_thickness)}` : '') : null],
  ['Operation', (e) => (e.operation ? opLabel(e.operation) : null)],
  ['Speed', (e) => (e.speed != null ? `${num(e.speed, 0)} ${e.speed_unit || 'mm/min'}` : null)],
  ['Power max', (e) => (e.power_max != null ? `${num(e.power_max)}%` : null)],
  ['Power min', (e) => (e.power_min != null ? `${num(e.power_min)}%` : null)],
  ['Passes', (e) => e.passes],
  ['Line interval', (e) => (e.line_interval_mm != null ? `${num(e.line_interval_mm, 3)} mm` : null)],
  ['DPI', (e) => e.dpi],
  ['Air assist', (e) => (e.air_assist ? 'Yes' : 'No')],
  ['Focus offset', (e) => (e.focus_offset_mm != null ? `${num(e.focus_offset_mm, 2)} mm` : null)],
  ['Z step', (e) => (e.z_step_mm != null ? `${num(e.z_step_mm, 2)} mm` : null)],
  ['Frequency', (e) => (e.frequency_khz != null ? `${num(e.frequency_khz)} kHz` : null)],
  ['Kerf', (e) => (e.kerf_mm != null ? `${num(e.kerf_mm, 3)} mm` : null)],
  ['Lens', (e) => (e.lens_mm != null ? `${num(e.lens_mm, 0)} mm` : null)],
  ['Rotary', (e) => (e.rotary ? 'Yes' : 'No')],
  ['Rating', (e) => (e.rating ? `${e.rating}/5` : null)],
  ['Outcome', (e) => e.outcome],
];

export function openCompare(picked, ctx) {
  const cell = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

  const rowsHTML = CMP_ROWS.map(([label, fn]) => {
    const vals = picked.map((e) => cell(fn(e)));
    const allSame = vals.every((v) => v === vals[0]);
    // Only the differences matter when you're deciding what to change.
    return `<tr>
      <th style="text-align:left;padding:9px 12px;color:var(--text-2);font-weight:550;
                 font-size:13px;white-space:nowrap;border-bottom:1px solid var(--border)">
        ${esc(label)}</th>
      ${vals.map((v) => `
        <td style="padding:9px 12px;font-family:var(--mono);font-size:13.5px;
                   border-bottom:1px solid var(--border);white-space:nowrap;
                   ${allSame ? 'color:var(--text-3)' : 'color:var(--text);font-weight:600;background:var(--accent-dim)'}">
          ${esc(v)}</td>`).join('')}
    </tr>`;
  }).join('');

  openSheet({
    title: `Comparing ${picked.length}`,
    wide: true,
    body: `
      <div class="small muted" style="margin-bottom:12px">
        Highlighted cells are where these settings disagree.
      </div>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;width:100%;min-width:${140 + picked.length * 150}px">
          <thead><tr>
            <th style="border-bottom:1px solid var(--border-2)"></th>
            ${picked.map((e) => `
              <th style="text-align:left;padding:9px 12px;font-size:13px;font-weight:650;
                         border-bottom:1px solid var(--border-2);max-width:170px">
                ${esc(e.title || e.material_name || 'Untitled')}
                ${e.rating ? `<div style="margin-top:3px">${stars(e.rating)}</div>` : ''}
              </th>`).join('')}
          </tr></thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>`,
    actions: [{ label: 'Done', kind: 'primary', onClick: () => {} }],
  });
}

/**
 * Plain-text version of a setting, for pasting into a forum or group chat.
 * This is the practical stand-in for the community library in the paid app.
 */
export function asShareText(e) {
  const L = [];
  L.push(e.title || e.material_name || 'Laser setting');
  if (e.material_name) {
    L.push(`Material: ${e.material_name}${e.material_thickness ? ` ${thickness(e.material_thickness)}` : ''}`);
  }
  if (e.machine_name) L.push(`Machine: ${e.machine_name}`);
  if (e.operation) L.push(`Operation: ${opLabel(e.operation)}`);
  if (e.speed != null) L.push(`Speed: ${num(e.speed, 0)} ${e.speed_unit || 'mm/min'}`);
  if (e.power_max != null) {
    L.push(`Power: ${e.power_min != null && e.power_min !== e.power_max
      ? `${num(e.power_min)}–${num(e.power_max)}` : num(e.power_max)}%`);
  }
  if (e.passes != null) L.push(`Passes: ${e.passes}`);
  if (e.line_interval_mm != null) L.push(`Line interval: ${num(e.line_interval_mm, 3)} mm`);
  if (e.dpi != null) L.push(`DPI: ${e.dpi}`);
  if (e.focus_offset_mm != null) L.push(`Focus offset: ${num(e.focus_offset_mm, 2)} mm`);
  if (e.frequency_khz != null) L.push(`Frequency: ${num(e.frequency_khz)} kHz`);
  L.push(`Air assist: ${e.air_assist ? 'on' : 'off'}`);
  if (e.rating) L.push(`Result: ${e.rating}/5`);
  if (e.notes) L.push('', e.notes);
  return L.join('\n');
}

/* --------------------------------------------------------------- detail */

export function openEntryDetail(entry, ctx, onChanged) {
  const body = el('<div class="stack"></div>');

  const rows = [
    ['Machine', entry.machine_name],
    ['Material', entry.material_name
      ? entry.material_name + (entry.material_thickness ? ` · ${thickness(entry.material_thickness)}` : '')
      : null],
    ['Operation', entry.operation ? opLabel(entry.operation) : null],
    ['Speed', entry.speed != null ? `${num(entry.speed, 0)} ${entry.speed_unit || 'mm/min'}` : null],
    ['Power max', entry.power_max != null ? `${num(entry.power_max)}%` : null],
    ['Power min', entry.power_min != null ? `${num(entry.power_min)}%` : null],
    ['Passes', entry.passes],
    ['Line interval', entry.line_interval_mm != null ? `${num(entry.line_interval_mm, 3)} mm` : null],
    ['DPI', entry.dpi],
    ['Air assist', entry.air_assist ? 'Yes' : 'No'],
    ['Focus offset', entry.focus_offset_mm != null ? `${num(entry.focus_offset_mm, 2)} mm` : null],
    ['Z step', entry.z_step_mm != null ? `${num(entry.z_step_mm, 2)} mm` : null],
    ['Pass depth', entry.pass_depth_mm != null ? `${num(entry.pass_depth_mm, 2)} mm` : null],
    ['Frequency', entry.frequency_khz != null ? `${num(entry.frequency_khz)} kHz` : null],
    ['Pulse width', entry.pulse_width_ns != null ? `${num(entry.pulse_width_ns)} ns` : null],
    ['Kerf', entry.kerf_mm != null ? `${num(entry.kerf_mm, 3)} mm` : null],
    ['Lens', entry.lens_mm != null ? `${num(entry.lens_mm, 0)} mm` : null],
    ['Rotary', entry.rotary
      ? `Yes${entry.rotary_diameter_mm ? ` — ${num(entry.rotary_diameter_mm, 1)}mm dia` : ''}` : null],
    ['Hatch angle', entry.hatch_angle_deg != null ? `${num(entry.hatch_angle_deg, 0)}°` : null],
    ['Cross-hatch', entry.hatch_cross ? 'Yes' : null],
    ['Bidirectional', entry.bidir ? 'Yes' : null],
    ['Wobble', entry.wobble_on
      ? [entry.wobble_amp_mm != null ? `${num(entry.wobble_amp_mm, 2)}mm` : null,
         entry.wobble_freq_hz != null ? `${num(entry.wobble_freq_hz, 0)}Hz` : null]
        .filter(Boolean).join(' @ ') || 'Yes'
      : null],
    ['Colour', entry.color_result],
    ['Edge', { none: 'Clean', light: 'Light char / dross', heavy: 'Heavy char / dross' }[entry.dross]],
    ['Edge quality', entry.edge_quality != null ? `${num(entry.edge_quality, 0)} / 5` : null],
    ['Taper', entry.taper_note],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  body.innerHTML = `
    ${hazardBanner({ hazard: entry.material_hazard, hazard_note: entry.material_hazard_note })}
    <div class="row row--wrap">
      ${entry.rating ? stars(entry.rating, 'stars--lg') : ''}
      ${outcomeBadge(entry.outcome)}
      ${entry.is_favorite ? '<span class="badge" style="color:var(--star)">★ Favourite</span>' : ''}
    </div>
    <div class="card">
      ${rows.map(([k, v]) => `
        <div class="kv"><span class="kv__k">${esc(k)}</span>
        <span class="kv__v kv__v--mono">${esc(v)}</span></div>`).join('')}
    </div>
    ${entry.tags?.length ? `<div class="row row--wrap">${entry.tags.map((t) => `<span class="badge">#${esc(t)}</span>`).join('')}</div>` : ''}
    ${entry.notes ? `<div class="card"><div class="field__label" style="margin-bottom:6px">Notes</div>
      <div style="white-space:pre-wrap">${esc(entry.notes)}</div></div>` : ''}
    <div id="photos"></div>
    <div class="small muted">Updated ${relTime(entry.updated_at)}</div>`;

  photoStrip($('#photos', body), 'entry', entry.id, entry.photos || []);

  openSheet({
    title: entry.title || entry.material_name || 'Setting',
    body,
    actions: [
      { label: activeTimer() ? 'Timer running' : 'Start timer', icon: icons.sync, onClick: () => {
          if (activeTimer()) { toast('A job is already being timed'); return true; }
          startTimer(entry.title || entry.material_name || 'Laser job');
          toast('Timing — stop it from the bar at the top');
          closeSheet();
        } },
      { label: 'Copy', icon: icons.copy, onClick: async () => {
          const text = asShareText(entry);
          try {
            if (navigator.share) await navigator.share({ text });
            else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
          } catch { /* user dismissed the share sheet */ }
          return true;
        } },
      { label: 'Duplicate', icon: icons.copy, onClick: async () => {
          await api.post(`/api/entries/${entry.id}/duplicate`);
          toast('Duplicated'); onChanged?.();
        } },
      { label: 'Edit', kind: 'primary', icon: icons.edit, onClick: () => {
          openEntryEditor(entry, ctx, onChanged); return true;
        } },
    ],
  });
}

/* --------------------------------------------------------------- editor */

export function openEntryEditor(entry, ctx, onSaved) {
  const e = entry || {};
  const isNew = !e.id;
  const machines = ctx.machines || [];
  const materials = ctx.materials || [];

  const body = el(`<form class="stack" id="entry-form" autocomplete="off"></form>`);

  /**
   * The form follows the machine. A galvo marker and a diode gantry share
   * almost none of their parameters, and a form showing all of both is a form
   * nobody fills in — so `fieldGroupsFor` decides what appears.
   *
   * Values already typed are carried across a redraw, so switching machine
   * halfway through does not wipe what you have entered.
   */
  const draw = (v) => {
    const machine = machines.find((m) => m.id === v.machine_id) || null;
    const g = fieldGroupsFor(machine);
    const lensList = machine?.lens_mm
      ? String(machine.lens_mm).split(/[,;/]/).map((x) => Number(x.trim())).filter(Boolean)
      : LENSES;

    body.innerHTML = `
    ${field({ label: 'Title', name: 'title', value: v.title,
              placeholder: 'e.g. 3mm ply — clean cut, no flashback' })}

    <div class="field-row">
      ${selectField({ label: 'Machine', name: 'machine_id', value: v.machine_id,
        options: machines.map((m) => ({ value: m.id, label: m.name })), blank: 'No machine' })}
      ${selectField({ label: 'Operation', name: 'operation', value: v.operation || 'cut',
        options: OPERATIONS, blank: null })}
    </div>

    ${selectField({ label: 'Material', name: 'material_id', value: v.material_id,
      options: materials.map((m) => ({
        value: m.id,
        label: (m.hazard === 'never' ? '⚠ ' : m.hazard ? '! ' : '')
          + m.name + (m.thickness_mm ? ` — ${thickness(m.thickness_mm)}` : '')
          + (m.color ? ` (${m.color})` : ''),
      })), blank: 'No material' })}
    <div id="mat-hazard"></div>

    <div class="section-title">The numbers</div>

    <div class="field-row">
      ${field({ label: 'Speed', name: 'speed', value: v.speed, type: 'number', step: 'any' })}
      ${selectField({ label: 'Unit', name: 'speed_unit',
        value: v.speed_unit || machine?.speed_unit || 'mm/min',
        options: ['mm/min', 'mm/s', 'in/min', '%'], blank: null,
        hint: machine?.speed_unit ? `${machine.name} reports ${machine.speed_unit}` : null })}
    </div>

    <div class="field-row">
      ${field({ label: 'Power max %', name: 'power_max', value: v.power_max, type: 'number',
                step: 'any', min: 0, max: 100 })}
      ${field({ label: 'Power min %', name: 'power_min', value: v.power_min, type: 'number',
                step: 'any', min: 0, max: 100, hint: 'For ramped / cut-through modes' })}
    </div>

    <div class="field-row field-row--3">
      ${field({ label: 'Passes', name: 'passes', value: v.passes, type: 'number', min: 1 })}
      ${field({ label: g.galvo ? 'Hatch spacing mm' : 'Interval mm', name: 'line_interval_mm',
                value: v.line_interval_mm, type: 'number', step: 'any' })}
      ${g.raster ? field({ label: 'DPI', name: 'dpi', value: v.dpi, type: 'number' }) : ''}
    </div>

    <div class="field-row field-row--3">
      ${field({ label: 'Focus offset mm', name: 'focus_offset_mm', value: v.focus_offset_mm,
                type: 'number', step: 'any' })}
      ${field({ label: 'Z step mm', name: 'z_step_mm', value: v.z_step_mm, type: 'number', step: 'any' })}
      ${field({ label: 'Pass depth mm', name: 'pass_depth_mm', value: v.pass_depth_mm,
                type: 'number', step: 'any' })}
    </div>

    ${g.pulse ? `
      <div class="section-title">Pulse</div>
      <div class="field-row field-row--3">
        ${field({ label: 'Frequency kHz', name: 'frequency_khz', value: v.frequency_khz,
                  type: 'number', step: 'any',
                  hint: (machine?.freq_min_khz && machine?.freq_max_khz)
                    ? `${num(machine.freq_min_khz, 0)}–${num(machine.freq_max_khz, 0)}` : null })}
        ${field({ label: 'Pulse width ns', name: 'pulse_width_ns', value: v.pulse_width_ns,
                  type: 'number', step: 'any',
                  hint: machine?.pulse_widths_ns ? `Fitted: ${machine.pulse_widths_ns}` : null })}
        ${field({ label: 'Kerf mm', name: 'kerf_mm', value: v.kerf_mm, type: 'number', step: 'any' })}
      </div>` : `
      <details ${(v.frequency_khz != null || v.pulse_width_ns != null || v.kerf_mm != null) ? 'open' : ''}>
        <summary class="field__label" style="cursor:pointer;padding:8px 0">
          Frequency, pulse width &amp; kerf
        </summary>
        <div class="field-row field-row--3" style="margin-top:8px">
          ${field({ label: 'Frequency kHz', name: 'frequency_khz', value: v.frequency_khz,
                    type: 'number', step: 'any' })}
          ${field({ label: 'Pulse width ns', name: 'pulse_width_ns', value: v.pulse_width_ns,
                    type: 'number', step: 'any' })}
          ${field({ label: 'Kerf mm', name: 'kerf_mm', value: v.kerf_mm, type: 'number', step: 'any' })}
        </div>
      </details>`}

    ${g.galvo ? `
      <div class="section-title">Scan pattern</div>
      <div class="field-row">
        ${field({ label: 'Hatch angle °', name: 'hatch_angle_deg', value: v.hatch_angle_deg,
                  type: 'number', step: 'any', hint: '0, 45 and 90 behave differently on brushed stock' })}
        ${field({ label: 'Wobble amplitude mm', name: 'wobble_amp_mm', value: v.wobble_amp_mm,
                  type: 'number', step: 'any' })}
      </div>
      ${switchField({ label: 'Cross-hatch (second pass at 90°)', name: 'hatch_cross',
        checked: v.hatch_cross })}
      ${switchField({ label: 'Bidirectional scan', name: 'bidir', checked: v.bidir })}
      ${switchField({ label: 'Wobble on', name: 'wobble_on', checked: v.wobble_on })}
      ${v.wobble_on || v.wobble_freq_hz != null ? field({
        label: 'Wobble frequency Hz', name: 'wobble_freq_hz', value: v.wobble_freq_hz,
        type: 'number', step: 'any' }) : ''}` : ''}

    ${g.colour ? `
      <div class="section-title">Colour</div>
      <div class="field-row">
        ${field({ label: 'Colour it produced', name: 'color_result', value: v.color_result,
          placeholder: 'Gold, blue, black anneal' })}
        ${field({ label: 'Swatch', name: 'color_hex', value: v.color_hex || '#c9a227',
          type: 'color' })}
      </div>` : ''}

    ${switchField({ label: 'Air assist on', name: 'air_assist', checked: v.air_assist })}

    <div class="section-title">Setup</div>
    <span class="field__hint" style="margin-top:-6px">
      A fiber setting is only reproducible with the lens it was made on — spot size
      and energy density change with focal length. Rotary work doesn't carry to flat.
    </span>
    <div class="field-row">
      ${selectField({ label: 'Lens', name: 'lens_mm', value: v.lens_mm,
        options: lensList.map((l) => ({ value: l, label: `${l}mm` })),
        blank: 'Not recorded' })}
      ${field({ label: 'Rotary diameter mm', name: 'rotary_diameter_mm',
        value: v.rotary_diameter_mm, type: 'number', step: 'any',
        placeholder: 'e.g. 80 for a tumbler' })}
    </div>
    ${switchField({ label: 'Run on the rotary', name: 'rotary', checked: v.rotary })}

    <div class="section-title">How it came out</div>
    ${ratingField('rating', v.rating || 0)}
    ${selectField({ label: 'Outcome', name: 'outcome', value: v.outcome,
      options: OUTCOMES, blank: 'Not recorded' })}

    ${g.quality ? `
      <div class="field-row">
        ${selectField({ label: 'Edge', name: 'dross', value: v.dross,
          options: [
            { value: 'none', label: 'Clean' },
            { value: 'light', label: 'Light char / dross' },
            { value: 'heavy', label: 'Heavy char / dross' },
          ], blank: 'Not recorded' })}
        ${selectField({ label: 'Edge quality', name: 'edge_quality', value: v.edge_quality,
          options: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} / 5` })),
          blank: 'Not rated' })}
      </div>
      ${field({ label: 'Taper / squareness', name: 'taper_note', value: v.taper_note,
        placeholder: 'Back face 0.3mm narrower — raise focus 1mm' })}` : ''}

    ${textareaField({ label: 'Notes', name: 'notes', value: v.notes,
      placeholder: 'Flashback on the underside, needs masking. Cut through at 2 passes.' })}
    ${field({ label: 'Tags', name: '_tags', value: (v.tags || []).join(', '),
      placeholder: 'ply, coasters, production', hint: 'Comma separated' })}
    ${switchField({ label: 'Favourite', name: 'is_favorite', checked: v.is_favorite })}
    ${!isNew ? '<div id="photos" style="margin-top:8px"></div>' : ''}`;

    bindRating(body);

    // Warn the moment a flagged material is picked, not after the job has run.
    const matSel = $('[name=material_id]', body);
    const showHazard = () => {
      const mat = materials.find((x) => x.id === matSel.value);
      $('#mat-hazard', body).innerHTML = mat ? hazardBanner(mat) : '';
    };
    matSel.addEventListener('change', showHazard);
    showHazard();

    // Anything that changes which fields belong on the form redraws it,
    // carrying whatever has been typed so far.
    for (const name of ['machine_id', 'wobble_on']) {
      const ctrl = $(`[name=${name}]`, body);
      if (ctrl) ctrl.addEventListener('change', () => {
        const cur = readForm(body);
        cur.tags = String(cur._tags || '').split(',').map((s) => s.trim()).filter(Boolean);
        delete cur._tags;
        draw({ ...v, ...cur });
      });
    }
  };

  draw({ ...e });

  if (!isNew) photoStrip($('#photos', body), 'entry', e.id, e.photos || []);

  openSheet({
    title: isNew ? 'New setting' : 'Edit setting',
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
          closeSheet();
          if (await confirmSheet('Delete this setting?',
              'It disappears from every device on the next sync.')) {
            await api.remove('entries', e.id);
            toast('Deleted'); onSaved?.();
          }
          return true;
        } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
          const data = readForm(body);
          const tags = String(data._tags || '')
            .split(',').map((s) => s.trim()).filter(Boolean);
          delete data._tags;
          if (e.id) data.id = e.id;
          data.tags = tags;
          if (!data.title && !data.material_id) {
            toast('Give it a title or pick a material', 'bad');
            return true;
          }
          const saved = await api.save('entries', data);
          toast(saved._pending ? 'Saved offline — will sync' : 'Saved');
          onSaved?.();
        } },
    ],
  });
}
