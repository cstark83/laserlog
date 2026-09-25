/**
 * LaserLog — finishes.
 *
 * What happens to a piece after the laser: the paint that goes into an
 * engraving, what masks the surface while it does, and what seals it after.
 * Half the look of a finished product comes from this step and none of it
 * was being written down.
 */
import * as api from '../api.js';
import {
  $, el, esc, num, icons, openSheet, closeSheet, confirmSheet, toast, readForm,
  field, selectField, textareaField, ratingField, bindRating, stars, empty,
} from '../ui.js';
import { photoStrip } from './photos.js';

const KINDS = [
  { value: 'paint_fill', label: 'Paint fill (into an engraving)' },
  { value: 'paint',      label: 'Paint (over a surface)' },
  { value: 'stain',      label: 'Stain / dye' },
  { value: 'seal',       label: 'Sealer / topcoat' },
  { value: 'mask',       label: 'Masking' },
  { value: 'patina',     label: 'Patina / oxide' },
  { value: 'other',      label: 'Other' },
];

const APPLICATIONS = ['Rattlecan', 'Airbrush', 'Paint marker', 'Brush',
  'Roller', 'Wipe on', 'Dip', 'Squeegee'];

const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label || k || 'Finish';

export async function renderFinishes(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Finishes</h1><p>Paint fill, stain and sealer — what you used and how it went on.</p></div>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  const out = $('#out', root);
  let rows = [];
  try { rows = await api.get('/api/finishes'); }
  catch { out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.'); return; }
  rows = rows.filter((r) => !r.archived);
  ctx.finishes = rows;

  if (!ctx.supplies?.length) {
    ctx.supplies = await api.get('/api/supplies').catch(() => []);
  }

  if (!rows.length) {
    out.innerHTML = empty(icons.flame, 'No finishes yet',
      'Write down the paint, the mask and the sealer that gave you a result you liked — '
      + 'the colour is only half of it, the coats and the cure time are the rest.');
    return;
  }

  const groups = new Map();
  for (const f of rows) {
    const k = kindLabel(f.kind);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }

  out.innerHTML = [...groups.entries()].map(([kind, items]) => `
    <div class="section-title">${esc(kind)}</div>
    <div class="list">
      ${items.map((f) => `
        <div class="listitem" data-id="${esc(f.id)}">
          <span class="swatch" style="background:${esc(f.color_hex || 'var(--surface-3)')}"></span>
          <div class="listitem__main">
            <div class="listitem__title">${esc(f.name)}</div>
            <div class="listitem__sub">
              ${[f.brand, f.color, f.substrate,
                 f.coats ? `${num(f.coats, 0)} coat${f.coats === 1 ? '' : 's'}` : null,
                 f.application].filter(Boolean).map(esc).join(' · ') || 'No details'}
            </div>
            ${f.rating ? `<div style="margin-top:4px">${stars(f.rating)}</div>` : ''}
          </div>
          <span class="listitem__chev">${icons.chevron}</span>
        </div>`).join('')}
    </div>`).join('');

  out.onclick = (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const f = rows.find((r) => r.id === item.dataset.id);
    if (f) openFinishEditor(f, ctx, () => renderFinishes(root, ctx));
  };
}

export function openFinishEditor(finish, ctx, onSaved) {
  const f = finish || {};
  const isNew = !f.id;
  const supplies = ctx.supplies || [];
  const body = el('<form class="stack"></form>');

  body.innerHTML = `
    ${field({ label: 'Name', name: 'name', value: f.name,
      placeholder: 'White fill on stained walnut' })}

    <div class="field-row">
      ${selectField({ label: 'What it is', name: 'kind', value: f.kind || 'paint_fill',
        options: KINDS, blank: null })}
      ${field({ label: 'Goes on', name: 'substrate', value: f.substrate,
        placeholder: 'Birch ply, acrylic, powder-coated steel' })}
    </div>

    <div class="field-row">
      ${field({ label: 'Brand', name: 'brand', value: f.brand, placeholder: 'Rust-Oleum' })}
      ${field({ label: 'Product', name: 'product', value: f.product,
        placeholder: '2X Ultra Cover, gloss' })}
    </div>

    <div class="field-row">
      ${field({ label: 'Colour', name: 'color', value: f.color, placeholder: 'Heirloom white' })}
      ${field({ label: 'Swatch', name: 'color_hex', value: f.color_hex || '#ffffff',
        type: 'color' })}
    </div>

    <div class="section-title">How it goes on</div>

    <div class="field-row">
      ${selectField({ label: 'Applied with', name: 'application', value: f.application,
        options: APPLICATIONS, blank: '—' })}
      ${field({ label: 'Coats', name: 'coats', value: f.coats, type: 'number', min: 1 })}
    </div>

    ${field({ label: 'Masked with', name: 'mask', value: f.mask,
      placeholder: 'Transfer tape, laser-cut through before painting',
      hint: 'Leave blank if the surface goes in bare' })}

    ${textareaField({ label: 'Getting the excess off', name: 'removal', value: f.removal, rows: 2,
      placeholder: 'Peel the tape while still tacky, then 320 grit flat on a block.' })}

    <div class="field-row">
      ${field({ label: 'Dry between coats (min)', name: 'dry_minutes', value: f.dry_minutes,
        type: 'number', step: 'any' })}
      ${field({ label: 'Cure before handling (hrs)', name: 'cure_hours', value: f.cure_hours,
        type: 'number', step: 'any',
        hint: 'What stops you boxing it too early' })}
    </div>

    <div class="section-title">Cost</div>
    <div class="field-row">
      ${selectField({ label: 'Comes out of', name: 'supply_id', value: f.supply_id,
        options: supplies.map((s) => ({ value: s.id, label: `${s.name}${s.unit ? ` (${s.unit})` : ''}` })),
        blank: 'Not tracked' })}
      ${field({ label: 'Used per piece', name: 'qty_per_use', value: f.qty_per_use,
        type: 'number', step: 'any', hint: 'In that supply’s own unit' })}
    </div>

    <div class="section-title">How it came out</div>
    ${ratingField('rating', f.rating || 0)}
    ${textareaField({ label: 'Notes', name: 'notes', value: f.notes,
      placeholder: 'Second coat is what kills the grain showing through. Bleeds under tape if the engrave is deeper than 0.4mm.' })}
    ${!isNew ? '<div id="photos"></div>' : ''}`;

  bindRating(body);
  if (!isNew) photoStrip($('#photos', body), 'finish', f.id);

  openSheet({
    title: isNew ? 'New finish' : f.name || 'Finish',
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete finish?', 'The products using it keep their own numbers.')) {
          await api.remove('finishes', f.id);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const data = readForm(body);
        if (!data.name) { toast('Give it a name', 'bad'); return true; }
        if (f.id) data.id = f.id;
        const saved = await api.save('finishes', data);
        toast(saved._pending ? 'Saved offline — will sync' : 'Saved');
        onSaved?.();
      } },
    ],
  });
}
