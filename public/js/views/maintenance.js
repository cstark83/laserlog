/**
 * LaserLog — maintenance log.
 *
 * A record of what has been done to each machine, and what is now due. The
 * table and the API have been here since the first version; nothing ever
 * showed it, which made it worthless.
 */
import * as api from '../api.js';
import {
  $, el, esc, num, icons, money, openSheet, closeSheet, confirmSheet, toast,
  readForm, field, selectField, textareaField, empty,
} from '../ui.js';

const KINDS = [
  { value: 'lens',    label: 'Lens / protective window' },
  { value: 'mirror',  label: 'Mirror' },
  { value: 'nozzle',  label: 'Nozzle' },
  { value: 'belt',    label: 'Belts and rails' },
  { value: 'filter',  label: 'Extraction filter' },
  { value: 'chiller', label: 'Chiller / coolant' },
  { value: 'rotary',  label: 'Rotary' },
  { value: 'calibr',  label: 'Calibration' },
  { value: 'other',   label: 'Other' },
];

const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Work out whether a logged job has come round again. A job can repeat on
 * days, on machine hours, or both — whichever lands first wins.
 */
export function dueState(row, machineHours) {
  let dueDate = null;
  let daysLeft = null;
  if (row.interval_days && row.date) {
    const base = Date.parse(row.date + 'T00:00:00Z');
    if (!Number.isNaN(base)) {
      dueDate = new Date(base + row.interval_days * DAY);
      daysLeft = Math.round((dueDate - Date.now()) / DAY);
    }
  }

  let hoursLeft = null;
  if (row.interval_hours && row.hours_at != null && machineHours != null) {
    hoursLeft = (row.hours_at + row.interval_hours) - machineHours;
  }

  if (daysLeft === null && hoursLeft === null) return { status: 'none' };

  const parts = [];
  if (daysLeft !== null) {
    parts.push(daysLeft < 0 ? `${-daysLeft}d overdue`
      : daysLeft === 0 ? 'due today' : `in ${daysLeft}d`);
  }
  if (hoursLeft !== null) {
    parts.push(hoursLeft < 0 ? `${num(-hoursLeft, 0)}h overdue`
      : `in ${num(hoursLeft, 0)}h`);
  }

  const worst = Math.min(
    daysLeft === null ? Infinity : daysLeft,
    hoursLeft === null ? Infinity : hoursLeft
  );
  const status = worst < 0 ? 'overdue' : worst <= 7 ? 'soon' : 'ok';
  return { status, label: parts.join(' · '), dueDate };
}

export async function renderMaintenance(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Maintenance</h1><p>What has been done, and what is due again.</p></div>
    </div>
    <div id="out"><div class="skeleton"></div></div>`;

  const out = $('#out', root);
  let rows = [];
  let machines = ctx.machines || [];
  try {
    [rows, machines] = await Promise.all([
      api.get('/api/maintenance'),
      api.get('/api/machines').catch(() => machines),
    ]);
  } catch { out.innerHTML = empty(icons.warn, 'Offline', 'Nothing cached yet.'); return; }
  ctx.machines = machines;

  const refresh = () => renderMaintenance(root, ctx);
  const machineById = new Map(machines.map((m) => [m.id, m]));

  if (!rows.length) {
    out.innerHTML = empty(icons.settings, 'Nothing logged yet',
      'Log a lens clean or a belt check once, give it a repeat interval, and it '
      + 'will tell you when it comes round again.',
      `<button class="btn btn--primary" id="first">${icons.plus}<span>Log a job</span></button>`);
    $('#first', out).addEventListener('click', () => openMaintenanceEditor(null, ctx, refresh));
    return;
  }

  const decorated = rows.map((r) => ({
    ...r,
    due: dueState(r, machineById.get(r.machine_id)?.hours ?? null),
    machine_name: machineById.get(r.machine_id)?.name || null,
  }));

  const due = decorated.filter((r) => r.due.status === 'overdue' || r.due.status === 'soon')
    .sort((a, b) => (a.due.status === 'overdue' ? -1 : 1) - (b.due.status === 'overdue' ? -1 : 1));

  const row = (r) => `
    <div class="listitem" data-id="${esc(r.id)}">
      <div class="listitem__main">
        <div class="listitem__title">
          ${esc(r.what)}
          ${r.due.status === 'overdue' ? '<span class="badge badge--fail" style="margin-left:6px">Overdue</span>'
            : r.due.status === 'soon' ? '<span class="badge badge--partial" style="margin-left:6px">Due soon</span>' : ''}
        </div>
        <div class="listitem__sub">
          ${[r.machine_name, KINDS.find((k) => k.value === r.kind)?.label,
             r.date, r.hours_at != null ? `at ${num(r.hours_at, 0)}h` : null,
             r.cost ? money(r.cost) : null,
             r.part_number].filter(Boolean).map(esc).join(' · ')}
        </div>
        ${r.due.label ? `<div class="listitem__sub" style="color:var(--${
          r.due.status === 'overdue' ? 'bad' : r.due.status === 'soon' ? 'warn' : 'text-3'})">
          Next ${esc(r.due.label)}</div>` : ''}
      </div>
      <span class="listitem__chev">${icons.chevron}</span>
    </div>`;

  out.innerHTML = `
    ${due.length ? `
      <div class="hazard hazard--caution" style="margin-bottom:var(--sp-4)">
        <div class="hazard__head">${icons.warn} ${due.length} job${due.length === 1 ? '' : 's'} due</div>
        <div class="hazard__body">${due.map((r) =>
          esc([r.machine_name, r.what].filter(Boolean).join(' — '))).join(' · ')}</div>
      </div>` : ''}
    <div class="section-title">History</div>
    <div class="list">${decorated.map(row).join('')}</div>`;

  out.onclick = (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const r = rows.find((x) => x.id === item.dataset.id);
    if (r) openMaintenanceEditor(r, ctx, refresh);
  };
}

export function openMaintenanceEditor(entry, ctx, onSaved) {
  const r = entry || {};
  const isNew = !r.id;
  const machines = ctx.machines || [];
  const body = el('<form class="stack"></form>');

  body.innerHTML = `
    ${field({ label: 'What was done', name: 'what', value: r.what,
      placeholder: 'Cleaned the protective window' })}

    <div class="field-row">
      ${selectField({ label: 'Machine', name: 'machine_id', value: r.machine_id,
        options: machines.map((m) => ({ value: m.id, label: m.name })), blank: 'No machine' })}
      ${selectField({ label: 'Kind', name: 'kind', value: r.kind,
        options: KINDS, blank: '—' })}
    </div>

    <div class="field-row">
      ${field({ label: 'Date', name: 'date', value: r.date || today(), type: 'date' })}
      ${field({ label: 'Machine hours at the time', name: 'hours_at', value: r.hours_at,
        type: 'number', step: 'any', hint: 'Leave blank if you do not track hours' })}
    </div>

    <div class="section-title">Repeat</div>
    <div class="field-row">
      ${field({ label: 'Every N days', name: 'interval_days', value: r.interval_days,
        type: 'number', min: 1 })}
      ${field({ label: 'Or every N machine hours', name: 'interval_hours',
        value: r.interval_hours, type: 'number', step: 'any',
        hint: 'Whichever comes first' })}
    </div>

    <div class="field-row">
      ${field({ label: 'Cost', name: 'cost', value: r.cost, type: 'number', step: '0.01' })}
      ${field({ label: 'Part number', name: 'part_number', value: r.part_number,
        placeholder: 'What to order again' })}
    </div>

    ${textareaField({ label: 'Notes', name: 'notes', value: r.notes,
      placeholder: 'Window was hazed on the underside, not the top. Isopropyl and a lens wipe.' })}`;

  openSheet({
    title: isNew ? 'Log maintenance' : r.what || 'Maintenance',
    body,
    actions: [
      // The common case is "I just did this again" — log it fresh rather than
      // overwriting the record of the last time, so the history survives.
      ...(isNew ? [] : [{ label: 'Did it again', icon: icons.sync, onClick: async () => {
        const data = readForm(body);
        delete data.id;
        data.date = today();
        await api.save('maintenance', data);
        toast('Logged for today');
        onSaved?.();
      } }]),
      ...(isNew ? [] : [{ label: 'Delete', kind: 'danger', icon: icons.trash, onClick: async () => {
        closeSheet();
        if (await confirmSheet('Delete this entry?', 'The rest of the history is untouched.')) {
          await api.remove('maintenance', r.id);
          toast('Deleted'); onSaved?.();
        }
        return true;
      } }]),
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
        const data = readForm(body);
        if (!data.what) { toast('Say what was done', 'bad'); return true; }
        if (r.id) data.id = r.id;
        const saved = await api.save('maintenance', data);
        toast(saved._pending ? 'Saved offline — will sync' : 'Saved');
        onSaved?.();
      } },
    ],
  });
}
