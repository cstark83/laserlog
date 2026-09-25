/* LaserLog — materials and machines. */
import * as api from '../api.js';
import {
  $, el, esc, num, icons, thickness, money, openSheet, closeSheet, confirmSheet,
  toast, readForm, field, selectField, textareaField, switchField, empty,
  HAZARDS, hazardBadge, hazardBanner,
} from '../ui.js';
import { photoStrip } from './photos.js';
import { MACHINE_PRESETS, MACHINE_ROLES, SOURCE_TYPES } from '../presets.js';

/* ------------------------------------------------------------ materials */

const CATEGORIES = ['Plywood', 'Hardwood', 'MDF', 'Acrylic', 'Leather', 'Paper',
  'Fabric', 'Metal', 'Stone', 'Glass', 'Rubber', 'Foam', 'Other'];

let showArchivedMaterials = false;

export async function renderMaterials(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Materials</h1><p>Your stock, with thickness and cost.</p></div>
      <button class="btn btn--sm btn--ghost" id="arch">
        ${showArchivedMaterials ? 'Hide archived' : 'Show archived'}
      </button>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  $('#arch', root).addEventListener('click', () => {
    showArchivedMaterials = !showArchivedMaterials;
    renderMaterials(root, ctx);
  });

  const out = $('#out', root);
  let rows = [];
  try { rows = await api.get('/api/materials' + (showArchivedMaterials ? '?archived=1' : '')); }
  catch { out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.'); return; }
  ctx.materials = rows;

  if (!rows.length) {
    out.innerHTML = empty(icons.material, 'No materials yet',
      'Add the sheet stock you actually keep around — name, thickness, what it cost.');
    return;
  }

  // Group by category so a long list stays scannable.
  const groups = new Map();
  for (const m of rows) {
    const k = m.category || 'Uncategorised';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }

  // Anything flagged "never" gets said once at the top, before you go looking.
  const never = rows.filter((m) => m.hazard === 'never');
  const banner = never.length ? `
    <div class="hazard hazard--never" style="margin-bottom:var(--sp-4)">
      <div class="hazard__head">${icons.warn} Never put these in either machine</div>
      <div class="hazard__body">${never.map((m) => esc(m.name)).join(' · ')}</div>
    </div>` : '';

  out.innerHTML = banner + [...groups.entries()].map(([cat, items]) => `
    <div class="section-title">${esc(cat)}</div>
    <div class="list">
      ${items.map((m) => `
        <div class="listitem" data-id="${esc(m.id)}" ${m.archived ? 'style="opacity:.55"' : ''}>
          <div class="listitem__main">
            <div class="listitem__title">
              ${esc(m.name)}
              ${m.archived ? '<span class="badge" style="margin-left:6px">Archived</span>' : ''}
              ${m.thickness_mm ? `<span class="badge badge--thick" style="margin-left:6px">${thickness(m.thickness_mm)}</span>` : ''}
              ${m.hazard ? `<span style="margin-left:6px">${hazardBadge(m.hazard)}</span>` : ''}
            </div>
            <div class="listitem__sub">
              ${[m.color, m.brand, m.supplier, m.cost ? `${money(m.cost)} ${m.cost_unit || ''}`.trim() : null]
                .filter(Boolean).map(esc).join(' · ') || 'No details'}
            </div>
          </div>
          <span class="listitem__chev">${icons.chevron}</span>
        </div>`).join('')}
    </div>`).join('');

  out.onclick = (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const m = rows.find((r) => r.id === item.dataset.id);
    if (m) openMaterialEditor(m, ctx, () => renderMaterials(root, ctx));
  };
}

export function openMaterialEditor(material, ctx, onSaved) {
  const m = material || {};
  const isNew = !m.id;
  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    <div id="haz-banner">${hazardBanner(m)}</div>
    ${field({ label: 'Name', name: 'name', value: m.name,
              placeholder: 'Baltic birch plywood' })}
    <div class="field-row">
      ${selectField({ label: 'Category', name: 'category', value: m.category,
        options: CATEGORIES, blank: 'Uncategorised' })}
      ${field({ label: 'Thickness mm', name: 'thickness_mm', value: m.thickness_mm,
        type: 'number', step: 'any' })}
    </div>
    <div class="field-row">
      ${field({ label: 'Colour / finish', name: 'color', value: m.color, placeholder: 'Natural' })}
      ${field({ label: 'Grade / alloy', name: 'grade', value: m.grade,
        placeholder: '304, 316, 6061, 260 brass' })}
    </div>
    <div class="field-row">
      ${field({ label: 'Brand', name: 'brand', value: m.brand })}
      ${field({ label: 'Coating / film', name: 'coated', value: m.coated,
        placeholder: 'PVC film, anodised, powder-coated' })}
    </div>
    ${switchField({ label: 'Reflective metal (copper, brass, bare alu)', name: 'reflective',
      checked: m.reflective })}
    <div class="field-row">
      ${field({ label: 'Supplier', name: 'supplier', value: m.supplier, placeholder: 'MakerStock' })}
      ${field({ label: 'Product link', name: 'url', value: m.url, type: 'url' })}
    </div>
    ${m.reflective ? '' : ''}
    <div class="field-row">
      ${field({ label: 'Cost', name: 'cost', value: m.cost, type: 'number', step: '0.01' })}
      ${selectField({ label: 'Per', name: 'cost_unit', value: m.cost_unit,
        options: ['sheet', 'sq ft', 'sq m', 'each', 'ft', 'm'], blank: '—' })}
    </div>
    <div class="field-row">
      ${field({ label: 'Sheet width mm', name: 'sheet_w_mm', value: m.sheet_w_mm, type: 'number', step: 'any' })}
      ${field({ label: 'Sheet height mm', name: 'sheet_h_mm', value: m.sheet_h_mm, type: 'number', step: 'any' })}
    </div>
    ${textareaField({ label: 'Notes', name: 'notes', value: m.notes,
      placeholder: 'Warps if stored flat. Masking tape on both sides for clean cuts.' })}

    ${!isNew ? switchField({ label: 'Archived — hide from lists and pickers',
      name: 'archived', checked: m.archived }) : ''}

    <div class="section-title">Safety</div>
    ${selectField({ label: 'Hazard flag', name: 'hazard', value: m.hazard,
      options: HAZARDS, blank: 'Safe to laser',
      hint: 'Shown as a warning anywhere this material is picked' })}
    ${textareaField({ label: 'Why', name: 'hazard_note', value: m.hazard_note, rows: 2,
      placeholder: 'What it gives off, what it does to the machine, what to do instead.' })}
    ${!isNew ? '<div id="photos"></div>' : ''}`;

  // Keep the banner honest while the flag is being changed.
  const hazSel = $('[name=hazard]', body);
  const hazNote = $('[name=hazard_note]', body);
  const redraw = () => {
    $('#haz-banner', body).innerHTML =
      hazardBanner({ hazard: hazSel.value, hazard_note: hazNote.value });
  };
  hazSel.addEventListener('change', redraw);
  hazNote.addEventListener('input', redraw);

  if (!isNew) photoStrip($('#photos', body), 'material', m.id);

  openSheet({
    title: isNew ? 'New material' : m.name || 'Material',
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete material?',
            'Settings that reference it keep their numbers but lose the material link.')) {
          await api.remove('materials', m.id);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const data = readForm(body);
        if (!data.name) { toast('Name is required', 'bad'); return true; }
        if (m.id) data.id = m.id;
        const saved = await api.save('materials', data);
        toast(saved._pending ? 'Saved offline — will sync' : 'Saved');
        onSaved?.();
      } },
    ],
  });
}

/* ------------------------------------------------------------- machines */

const KINDS = [
  { value: 'diode', label: 'Diode' },
  { value: 'co2', label: 'CO2' },
  { value: 'fiber', label: 'Fiber' },
  { value: 'uv', label: 'UV' },
  { value: 'other', label: 'Other' },
];

let showArchivedMachines = false;

export async function renderMachines(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Machines</h1><p>Settings are meaningless without knowing which machine ran them.</p></div>
      <button class="btn btn--sm btn--ghost" id="arch">
        ${showArchivedMachines ? 'Hide archived' : 'Show archived'}
      </button>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  $('#arch', root).addEventListener('click', () => {
    showArchivedMachines = !showArchivedMachines;
    renderMachines(root, ctx);
  });

  const out = $('#out', root);
  let rows = [];
  try { rows = await api.get('/api/machines' + (showArchivedMachines ? '?archived=1' : '')); }
  catch { out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.'); return; }
  ctx.machines = rows;

  if (!rows.length) {
    out.innerHTML = empty(icons.machine, 'No machines yet',
      'Add your laser — the wattage and bed size are what matter later.');
    return;
  }

  out.innerHTML = `<div class="list">${rows.map((m) => `
    <div class="listitem" data-id="${esc(m.id)}" ${m.archived ? 'style="opacity:.55"' : ''}>
      <span class="swatch" style="background:${esc(m.color || 'var(--accent)')}"></span>
      <div class="listitem__main">
        <div class="listitem__title">${esc(m.name)}
          ${m.archived ? '<span class="badge" style="margin-left:6px">Archived</span>' : ''}</div>
        <div class="listitem__sub">
          ${[KINDS.find((k) => k.value === m.kind)?.label,
             m.power_w ? `${num(m.power_w, 0)}W` : null,
             m.wavelength_nm ? `${num(m.wavelength_nm, 0)}nm` : null,
             (m.bed_w_mm && m.bed_h_mm) ? `${num(m.bed_w_mm, 0)}×${num(m.bed_h_mm, 0)}mm` : null,
             m.controller].filter(Boolean).map(esc).join(' · ') || 'No details'}
        </div>
        ${m.eyewear_od ? `<div class="listitem__sub" style="color:var(--warn)">
          ${icons.warn} ${esc(m.eyewear_od)}</div>` : ''}
      </div>
      <span class="listitem__chev">${icons.chevron}</span>
    </div>`).join('')}</div>`;

  out.onclick = (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const m = rows.find((r) => r.id === item.dataset.id);
    if (m) openMachineEditor(m, ctx, () => renderMachines(root, ctx));
  };
}

export function openMachineEditor(machine, ctx, onSaved) {
  const m = machine || {};
  const isNew = !m.id;
  const body = el('<form class="stack"></form>');

  const draw = (v) => {
    body.innerHTML = `
      ${isNew ? `
        ${selectField({ label: 'Start from a preset', name: '_preset', value: '',
          options: MACHINE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
          blank: 'Blank machine', hint: 'Fills in the details, then edit anything' })}
        <hr class="divider">` : ''}

      ${field({ label: 'Name', name: 'name', value: v.name, placeholder: 'AtomStack X40 Max' })}

      <div class="field-row">
        ${selectField({ label: 'Type', name: 'kind', value: v.kind || 'diode',
          options: KINDS, blank: null })}
        ${selectField({ label: 'Source', name: 'source_type', value: v.source_type,
          options: SOURCE_TYPES, blank: '—' })}
      </div>

      <div class="field-row">
        ${selectField({ label: 'Mainly used for', name: 'role', value: v.role || 'mixed',
          options: MACHINE_ROLES, blank: null,
          hint: 'Decides which fields the settings form shows' })}
        ${field({ label: 'Power W', name: 'power_w', value: v.power_w,
          type: 'number', step: 'any' })}
      </div>

      <div class="field-row">
        ${field({ label: 'Bed width mm', name: 'bed_w_mm', value: v.bed_w_mm, type: 'number', step: 'any' })}
        ${field({ label: 'Bed height mm', name: 'bed_h_mm', value: v.bed_h_mm, type: 'number', step: 'any' })}
      </div>

      <div class="field-row">
        ${field({ label: 'Controller', name: 'controller', value: v.controller, placeholder: 'GRBL' })}
        ${selectField({ label: 'Speed unit it uses', name: 'speed_unit',
          value: v.speed_unit || 'mm/min', options: ['mm/min', 'mm/s', 'in/min'], blank: null,
          hint: 'What the machine reports' })}
      </div>

      ${switchField({ label: 'Has assist gas', name: 'has_gas_assist', checked: v.has_gas_assist })}

      ${(v.kind === 'fiber' || v.kind === 'uv') ? `
        <div class="section-title">Source</div>
        <div class="field-row">
          ${field({ label: 'Source brand', name: 'source_brand', value: v.source_brand,
            placeholder: 'JPT, Raycus, MAX' })}
          ${field({ label: 'Spot size', name: 'spot_size_mm', value: v.spot_size_mm,
            placeholder: 'M² ≤ 1.5' })}
        </div>
        <div class="field-row">
          ${field({ label: 'Frequency min kHz', name: 'freq_min_khz', value: v.freq_min_khz,
            type: 'number', step: 'any' })}
          ${field({ label: 'Frequency max kHz', name: 'freq_max_khz', value: v.freq_max_khz,
            type: 'number', step: 'any' })}
        </div>
        ${field({ label: 'Pulse widths ns', name: 'pulse_widths_ns', value: v.pulse_widths_ns,
          placeholder: '2, 4, 8, 14, 20, 30, 45, 60, 80, 100, 130, 200, 250, 350, 500',
          hint: 'The fixed list your MOPA source offers — shown as a reminder on the settings form' })}
        ${field({ label: 'Lenses you have', name: 'lens_mm', value: v.lens_mm,
          placeholder: '75, 150, 300',
          hint: 'Comma separated. These become the lens choices on a setting.' })}` : ''}

      <div class="section-title">Safety</div>
      <div class="field-row">
        ${field({ label: 'Wavelength nm', name: 'wavelength_nm', value: v.wavelength_nm,
          type: 'number', step: 'any', hint: '450 diode · 1064 fiber · 10600 CO2' })}
        ${field({ label: 'Eyewear rating', name: 'eyewear_od', value: v.eyewear_od,
          placeholder: 'OD5+ @ 1064nm' })}
      </div>
      ${textareaField({ label: 'Eyewear notes', name: 'eyewear_note', value: v.eyewear_note,
        rows: 2, placeholder: 'Which glasses, and which ones do NOT work on this machine.' })}

      <div class="section-title">Other</div>
      <div class="field-row">
        ${field({ label: 'Machine hours', name: 'hours', value: v.hours, type: 'number', step: 'any' })}
        ${field({ label: 'Serial', name: 'serial', value: v.serial })}
      </div>
      ${field({ label: 'Colour tag', name: 'color', value: v.color || '#7c5cff',
        hint: 'Hex colour used to tell machines apart in lists' })}
      ${!isNew ? switchField({ label: 'Archived — hide from lists and pickers',
        name: 'archived', checked: v.archived }) : ''}
      ${textareaField({ label: 'Notes', name: 'notes', value: v.notes,
        placeholder: 'Lens cleaned Aug 2026. Air assist pump on channel 3.' })}`;

    const presetSel = $('[name=_preset]', body);
    if (presetSel) {
      presetSel.addEventListener('change', (e) => {
        const p = MACHINE_PRESETS.find((x) => x.id === e.target.value);
        draw(p ? { ...p.values } : {});
      });
    }

    // Picking Fiber brings out the source fields, so redraw and keep the typing.
    $('[name=kind]', body).addEventListener('change', () => {
      const cur = readForm(body);
      delete cur._preset;
      draw({ ...v, ...cur });
    });
  };

  draw(m);

  openSheet({
    title: isNew ? 'New machine' : m.name || 'Machine',
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete machine?', 'Settings keep their numbers but lose the machine link.')) {
          await api.remove('machines', m.id);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const data = readForm(body);
        delete data._preset;
        if (!data.name) { toast('Name is required', 'bad'); return true; }
        if (m.id) data.id = m.id;
        const saved = await api.save('machines', data);
        toast(saved._pending ? 'Saved offline — will sync' : 'Saved');
        onSaved?.();
      } },
    ],
  });
}
