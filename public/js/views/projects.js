/* LaserLog — project log, with the money maths done for you. */
import * as api from '../api.js';
import {
  $, el, esc, num, money, icons, relTime, openSheet, closeSheet, confirmSheet,
  toast, readForm, field, selectField, textareaField, empty, thickness,
} from '../ui.js';
import { photoStrip } from './photos.js';
import { timerButton } from '../timer.js';

const STATUSES = [
  { value: 'idea', label: 'Idea' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'scrapped', label: 'Scrapped' },
];

const statusBadge = (s) => {
  const map = { done: 'ok', in_progress: 'partial', scrapped: 'fail' };
  const label = STATUSES.find((x) => x.value === s)?.label || s || '—';
  return `<span class="badge ${map[s] ? 'badge--' + map[s] : ''}">${esc(label)}</span>`;
};

const profitOf = (p) => {
  if (p.sale_price == null) return null;
  const costs = (Number(p.material_cost) || 0) + (Number(p.other_cost) || 0);
  return (Number(p.sale_price) || 0) * (Number(p.qty) || 1) - costs;
};

export async function renderProjects(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Projects</h1><p>What you made, what it cost, what it sold for.</p></div>
    </div>
    <div id="totals"></div>
    <div id="out"><div class="skeleton"></div></div>`;

  const out = $('#out', root);
  let rows = [];
  try { rows = await api.get('/api/projects'); }
  catch { out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.'); return; }

  if (!rows.length) {
    out.innerHTML = empty(icons.project, 'No projects yet',
      'Log a job once it comes off the bed — run time and material cost make quoting the next one easy.');
    return;
  }

  const done = rows.filter((p) => p.status === 'done');
  const revenue = done.reduce((s, p) => s + (Number(p.sale_price) || 0) * (Number(p.qty) || 1), 0);
  const profit = done.reduce((s, p) => s + (profitOf(p) || 0), 0);
  const runtime = rows.reduce((s, p) => s + (Number(p.run_time_min) || 0), 0);

  $('#totals', root).innerHTML = `
    <div class="grid grid--stats" style="margin-bottom:8px">
      <div class="stat"><span class="stat__value">${done.length}</span><span class="stat__label">Completed</span></div>
      <div class="stat"><span class="stat__value">${money(revenue)}</span><span class="stat__label">Revenue</span></div>
      <div class="stat"><span class="stat__value ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">${money(profit)}</span><span class="stat__label">Profit</span></div>
      <div class="stat"><span class="stat__value">${(runtime / 60).toFixed(1)}h</span><span class="stat__label">Machine time</span></div>
    </div>`;

  out.innerHTML = `<div class="list">${rows.map((p) => {
    const prof = profitOf(p);
    return `
      <div class="listitem" data-id="${esc(p.id)}">
        <div class="listitem__main">
          <div class="listitem__title">${esc(p.name)}</div>
          <div class="listitem__sub">
            ${[p.client, p.qty > 1 ? `×${p.qty}` : null,
               p.run_time_min ? `${num(p.run_time_min, 0)} min` : null,
               p.date].filter(Boolean).map(esc).join(' · ') || relTime(p.updated_at)}
          </div>
        </div>
        ${prof != null ? `<span class="badge ${prof >= 0 ? 'badge--ok' : 'badge--fail'}">${money(prof)}</span>` : ''}
        ${statusBadge(p.status)}
      </div>`;
  }).join('')}</div>`;

  out.onclick = (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const p = rows.find((r) => r.id === item.dataset.id);
    if (p) openProjectEditor(p, ctx, () => renderProjects(root, ctx));
  };
}

export function openProjectEditor(project, ctx, onSaved) {
  const p = project || {};
  const isNew = !p.id;
  const machines = ctx.machines || [];
  const materials = ctx.materials || [];

  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    ${field({ label: 'Project name', name: 'name', value: p.name, placeholder: 'Oak coaster set' })}
    <div class="field-row">
      ${field({ label: 'Client', name: 'client', value: p.client, placeholder: 'Optional' })}
      ${selectField({ label: 'Status', name: 'status', value: p.status || 'idea',
        options: STATUSES, blank: null })}
    </div>
    <div class="field-row">
      ${field({ label: 'Design file', name: 'file_name', value: p.file_name,
        placeholder: 'coasters-v3.lbrn2' })}
      ${field({ label: 'Date', name: 'date', value: p.date, type: 'date' })}
    </div>
    <div class="field-row">
      ${selectField({ label: 'Machine', name: 'machine_id', value: p.machine_id,
        options: machines.map((m) => ({ value: m.id, label: m.name })), blank: 'No machine' })}
      ${selectField({ label: 'Material', name: 'material_id', value: p.material_id,
        options: materials.map((m) => ({
          value: m.id, label: m.name + (m.thickness_mm ? ` — ${thickness(m.thickness_mm)}` : ''),
        })), blank: 'No material' })}
    </div>

    <div class="section-title">Time &amp; money</div>
    <div class="field-row field-row--3">
      ${field({ label: 'Quantity', name: 'qty', value: p.qty ?? 1, type: 'number', min: 1 })}
      ${field({ label: 'Run time min', name: 'run_time_min', value: p.run_time_min,
        type: 'number', step: 'any' })}
      ${field({ label: 'Price each', name: 'sale_price', value: p.sale_price,
        type: 'number', step: '0.01' })}
    </div>
    <div class="field-row">
      ${field({ label: 'Material cost', name: 'material_cost', value: p.material_cost,
        type: 'number', step: '0.01' })}
      ${field({ label: 'Other cost', name: 'other_cost', value: p.other_cost,
        type: 'number', step: '0.01', hint: 'Finishing, packaging, shipping' })}
    </div>
    <div class="card" id="calc" style="padding:12px 16px"></div>
    ${textareaField({ label: 'Notes', name: 'notes', value: p.notes,
      placeholder: 'Second batch ran 20% faster after cleaning the lens.' })}
    ${!isNew ? '<div id="photos"></div>' : ''}`;

  // Measure the run rather than guessing it.
  const runInput = $('[name=run_time_min]', body);
  if (runInput) {
    const holder = el('<div style="margin-top:-4px"></div>');
    holder.appendChild(timerButton(runInput, p.name || 'Project run'));
    runInput.closest('.field').appendChild(holder);
  }

  const calc = $('#calc', body);
  const recalc = () => {
    const d = readForm(body);
    const prof = profitOf(d);
    const perHour = d.run_time_min && prof != null
      ? prof / ((Number(d.run_time_min) || 0) / 60) : null;
    calc.innerHTML = `
      <div class="kv"><span class="kv__k">Revenue</span>
        <span class="kv__v">${money((Number(d.sale_price) || 0) * (Number(d.qty) || 1))}</span></div>
      <div class="kv"><span class="kv__k">Costs</span>
        <span class="kv__v">${money((Number(d.material_cost) || 0) + (Number(d.other_cost) || 0))}</span></div>
      <div class="kv"><span class="kv__k">Profit</span>
        <span class="kv__v ${prof >= 0 ? 'profit-pos' : 'profit-neg'}">${money(prof)}</span></div>
      ${Number.isFinite(perHour) && perHour !== null
        ? `<div class="kv"><span class="kv__k">Per machine hour</span>
             <span class="kv__v ${perHour >= 0 ? 'profit-pos' : 'profit-neg'}">${money(perHour)}</span></div>` : ''}`;
  };
  recalc();
  body.addEventListener('input', recalc);

  if (!isNew) photoStrip($('#photos', body), 'project', p.id);

  openSheet({
    title: isNew ? 'New project' : p.name || 'Project',
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete project?', 'This cannot be undone.')) {
          await api.remove('projects', p.id);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const data = readForm(body);
        if (!data.name) { toast('Name is required', 'bad'); return true; }
        if (p.id) data.id = p.id;
        const saved = await api.save('projects', data);
        toast(saved._pending ? 'Saved offline — will sync' : 'Saved');
        onSaved?.();
      } },
    ],
  });
}
