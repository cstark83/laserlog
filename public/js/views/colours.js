/*
 * MOPA colour palette.
 *
 * On stainless, a MOPA source produces colour by oxide-layer thickness, which
 * is a function of frequency, pulse width, speed, power and hatch spacing.
 * Hit it again a week later with the numbers slightly off and you get a
 * different colour — so the only way to reproduce a colour is to have written
 * down exactly what made it. That's what this screen is.
 */
import * as api from '../api.js';
import {
  $, el, esc, num, icons, relTime, openSheet, closeSheet, confirmSheet, toast,
  readForm, field, selectField, textareaField, ratingField, bindRating,
  empty, thickness,
} from '../ui.js';
import { MOPA_COLOUR_HINTS, speedLabel } from '../presets.js';
import { photoStrip } from './photos.js';

export async function renderColours(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Colour palette</h1>
        <p>The parameter sets that produced each colour, so you can hit it again.</p>
      </div>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  const out = $('#out', root);

  const [entries, machines, materials] = await Promise.all([
    api.get('/api/entries').catch(() => []),
    ctx.machines?.length ? ctx.machines : api.get('/api/machines').catch(() => []),
    ctx.materials?.length ? ctx.materials : api.get('/api/materials').catch(() => []),
  ]);
  ctx.machines = machines; ctx.materials = materials;

  const swatches = entries.filter((e) => e.color_hex || e.color_result);

  if (!swatches.length) {
    out.innerHTML = empty(
      icons.flame,
      'No colours recorded yet',
      'When a MOPA run gives you a colour worth keeping, save it here with the exact frequency, '
      + 'pulse width, speed and hatch that produced it.',
      `<button class="btn btn--primary" id="add-first">${icons.plus}<span>Record a colour</span></button>`
    );
    $('#add-first', out)?.addEventListener('click', () =>
      openColourEditor(null, ctx, () => renderColours(root, ctx)));
    renderHints(out);
    return;
  }

  out.innerHTML = `
    <div class="swatchgrid">
      ${swatches.map((e) => swatchCard(e)).join('')}
    </div>
    <div id="hints" style="margin-top:28px"></div>`;

  renderHints($('#hints', out));

  $('.swatchgrid', out).onclick = (e) => {
    const card = e.target.closest('[data-entry]');
    if (!card) return;
    const entry = swatches.find((x) => x.id === card.dataset.entry);
    if (entry) openColourEditor(entry, ctx, () => renderColours(root, ctx));
  };
}

function swatchCard(e) {
  const hex = e.color_hex || '#888888';
  return `
    <article class="swatch-card" data-entry="${esc(e.id)}">
      <div class="swatch-card__chip" style="background:${esc(hex)}"></div>
      <div class="swatch-card__body">
        <div class="swatch-card__name">${esc(e.color_result || e.title || 'Colour')}</div>
        <div class="swatch-card__params mono">
          ${[e.frequency_khz != null ? `${num(e.frequency_khz, 0)}kHz` : null,
             e.pulse_width_ns != null ? `${num(e.pulse_width_ns, 0)}ns` : null,
             e.speed != null ? `${num(e.speed, 0)}${e.speed_unit === 'mm/s' ? '' : ' ' + (e.speed_unit || '')}${e.speed_unit === 'mm/s' ? 'mm/s' : ''}` : null,
             e.power_max != null ? `${num(e.power_max, 0)}%` : null,
            ].filter(Boolean).map(esc).join(' · ')}
        </div>
        <div class="swatch-card__sub small muted">
          ${[e.line_interval_mm != null ? `hatch ${num(e.line_interval_mm, 3)}mm` : null,
             e.material_name ? esc(e.material_name) : null].filter(Boolean).join(' · ')}
        </div>
      </div>
    </article>`;
}

function renderHints(host) {
  if (!host) return;
  host.insertAdjacentHTML('beforeend', `
    <div class="section-title">Rough directions</div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">
        Starting directions only — the actual numbers depend on your source, lens, alloy and
        surface finish. Run a grid on scrap and record what you get.
      </div>
      ${MOPA_COLOUR_HINTS.map((h) => `
        <div class="kv">
          <span class="kv__k">${esc(h.name)}</span>
          <span class="kv__v" style="font-weight:500;text-align:right;max-width:60%">${esc(h.hint)}</span>
        </div>`).join('')}
    </div>`);
}

/* --------------------------------------------------------------- editor */

export function openColourEditor(entry, ctx, onSaved) {
  const e = entry || {};
  const isNew = !e.id;
  const machines = (ctx.machines || []).filter((m) => m.kind === 'fiber' || !m.kind);
  const materials = ctx.materials || [];

  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    <div class="row" style="gap:12px;align-items:center">
      <input type="color" name="color_hex" value="${esc(e.color_hex || '#c9922b')}"
             style="width:64px;height:64px;padding:2px;border-radius:14px;cursor:pointer;
                    background:var(--surface-2);border:1px solid var(--border)">
      <div style="flex:1">
        ${field({ label: 'Colour name', name: 'color_result', value: e.color_result,
          placeholder: 'Gold, deep blue, rainbow…' })}
      </div>
    </div>

    <div class="field-row">
      ${selectField({ label: 'Machine', name: 'machine_id', value: e.machine_id,
        options: machines.map((m) => ({ value: m.id, label: m.name })), blank: 'No machine' })}
      ${selectField({ label: 'Material', name: 'material_id', value: e.material_id,
        options: materials.map((m) => ({
          value: m.id,
          label: m.name + (m.thickness_mm ? ` — ${thickness(m.thickness_mm)}` : ''),
        })), blank: 'No material' })}
    </div>

    <div class="section-title">What produced it</div>
    <div class="field-row">
      ${field({ label: 'Frequency kHz', name: 'frequency_khz', value: e.frequency_khz,
        type: 'number', step: 'any' })}
      ${field({ label: 'Pulse width ns', name: 'pulse_width_ns', value: e.pulse_width_ns,
        type: 'number', step: 'any', hint: 'The MOPA knob that makes colour possible' })}
    </div>
    <div class="field-row">
      ${field({ label: 'Speed', name: 'speed', value: e.speed, type: 'number', step: 'any' })}
      ${selectField({ label: 'Unit', name: 'speed_unit', value: e.speed_unit || 'mm/s',
        options: ['mm/s', 'mm/min'], blank: null })}
    </div>
    <div class="field-row field-row--3">
      ${field({ label: 'Power %', name: 'power_max', value: e.power_max, type: 'number', step: 'any' })}
      ${field({ label: 'Hatch mm', name: 'line_interval_mm', value: e.line_interval_mm,
        type: 'number', step: 'any' })}
      ${field({ label: 'Passes', name: 'passes', value: e.passes, type: 'number', min: 1 })}
    </div>
    <div class="field-row">
      ${field({ label: 'Hatch angle °', name: 'hatch_angle_deg', value: e.hatch_angle_deg,
        type: 'number', step: 'any' })}
      ${field({ label: 'Focus offset mm', name: 'focus_offset_mm', value: e.focus_offset_mm,
        type: 'number', step: 'any', hint: 'Colour is very sensitive to this' })}
    </div>

    ${ratingField('rating', e.rating || 0)}
    ${textareaField({ label: 'Notes', name: 'notes', value: e.notes,
      placeholder: 'Surface sanded to 400 then wiped with IPA. Colour shifts if the plate is warm.' })}
    ${!isNew ? '<div id="photos"></div>' : ''}`;

  bindRating(body);
  if (!isNew) photoStrip($('#photos', body), 'entry', e.id, e.photos || []);

  openSheet({
    title: isNew ? 'Record a colour' : (e.color_result || 'Colour'),
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete this colour?', 'It goes from every device on the next sync.')) {
          await api.remove('entries', e.id);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const d = readForm(body);
        if (!d.color_result) { toast('Give the colour a name', 'bad'); return true; }
        // Colours live in the settings library like anything else — this screen
        // is a lens on the entries that recorded one.
        d.operation = d.operation || 'engrave';
        d.title = d.title || `${d.color_result} on stainless`;
        d.outcome = d.outcome || 'success';
        if (e.id) d.id = e.id;
        const saved = await api.save('entries', d);
        toast(saved._pending ? 'Saved offline — will sync' : 'Saved');
        onSaved?.();
      } },
    ],
  });
}
