/* LaserLog — dashboard. */
import * as api from '../api.js';
import { $, esc, icons, relTime, opLabel, thickness, empty, toast } from '../ui.js';
import { entryCard, openEntryDetail, openEntryEditor } from './entries.js';

export async function renderDashboard(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Bench</h1>
        <p>What's in the library and what you touched last.</p>
      </div>
    </div>
    <div class="grid grid--stats" id="stats">
      ${'<div class="skeleton" style="height:82px"></div>'.repeat(4)}
    </div>
    <div class="section-title">Recently used</div>
    <div id="recent" class="stack"><div class="skeleton"></div></div>`;

  let stats;
  try {
    stats = await api.get('/api/stats');
  } catch {
    $('#stats', root).innerHTML = '';
    $('#recent', root).innerHTML = empty(icons.warn, 'Offline',
      'No connection and nothing cached on this device yet.');
    return;
  }

  const tiles = [
    ['Settings', stats.entries, 'library'],
    ['Files', stats.files ?? 0, 'files'],
    ['Materials', stats.materials, 'material'],
    ['Projects', stats.projects, 'project'],
  ];

  $('#stats', root).innerHTML = tiles.map(([label, value, route]) => `
    <button class="stat" data-go="${route}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
      <span class="stat__value">${value}</span>
      <span class="stat__label">${label}</span>
    </button>`).join('');

  $('#stats', root).onclick = (e) => {
    const b = e.target.closest('[data-go]');
    if (b) location.hash = '#/' + b.dataset.go;
  };

  // Anything that wants doing goes above everything else, because the bench is
  // the screen you actually look at.
  const todo = [
    ...(stats.maintenance_due || []).map((m) => ({
      kind: 'bad', route: 'maintenance', icon: 'warn',
      title: [m.machine_name, m.what].filter(Boolean).join(' — '),
      sub: `Due every ${m.interval_days} days, last done ${m.date}`,
    })),
    ...(stats.low_stock || []).map((s) => ({
      kind: 'warn', route: 'inventory', icon: 'box',
      title: `${s.name} is low`,
      sub: `${Number(s.stock_qty ?? 0)} ${s.unit || ''} left, you wanted a warning at ${s.reorder_at}`.trim(),
    })),
    ...(stats.files_missing ? [{
      kind: 'warn', route: 'files', icon: 'files',
      title: `${stats.files_missing} file${stats.files_missing === 1 ? '' : 's'} no longer on disk`,
      sub: 'Renamed, moved, or the share was not mounted when it last scanned.',
    }] : []),
  ];

  if (todo.length) {
    $('#stats', root).insertAdjacentHTML('afterend', `
      <div class="stack" style="margin-top:12px">
        ${todo.slice(0, 6).map((t) => `
          <a class="card card--tap" href="#/${t.route}" style="display:flex;align-items:center;
             gap:12px;text-decoration:none;color:inherit;border-color:${
               t.kind === 'bad' ? 'rgba(248,113,113,.4)' : 'rgba(251,191,36,.35)'};
             background:var(--${t.kind === 'bad' ? 'bad' : 'warn'}-dim)">
            <span style="color:var(--${t.kind === 'bad' ? 'bad' : 'warn'})">${icons[t.icon]}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:620">${esc(t.title)}</div>
              <div class="small muted">${esc(t.sub)}</div>
            </div>
            <span class="listitem__chev">${icons.chevron}</span>
          </a>`).join('')}
        ${todo.length > 6 ? `<div class="small muted center">and ${todo.length - 6} more</div>` : ''}
      </div>`);
  }

  // A pile of freshly scanned files is only useful once it's sorted.
  if (stats.files_uncategorized > 0) {
    $('#stats', root).insertAdjacentHTML('afterend', `
      <a class="card card--tap" href="#/files" style="display:flex;align-items:center;gap:12px;
         margin-top:12px;text-decoration:none;color:inherit">
        <span style="color:var(--accent)">${icons.folder}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:620">${stats.files_uncategorized} file${stats.files_uncategorized === 1 ? '' : 's'} not categorised</div>
          <div class="small muted">Sort them into categories so you can find them later.</div>
        </div>
        <span class="listitem__chev">${icons.chevron}</span>
      </a>`);
  }

  const [machines, materials] = await Promise.all([
    api.get('/api/machines').catch(() => []),
    api.get('/api/materials').catch(() => []),
  ]);
  ctx.machines = machines; ctx.materials = materials;

  const recent = $('#recent', root);

  if (stats.entries === 0) {
    recent.innerHTML = empty(
      icons.laser,
      'Nothing logged yet',
      materials.length
        ? 'Run a test cut, then hit the + button and write down what worked.'
        : 'Start with a machine and a few materials, then log your first settings.',
      materials.length
        ? ''
        : `<button class="btn btn--primary" id="seed">${icons.plus}<span>Load starter materials</span></button>`
    );
    $('#seed', recent)?.addEventListener('click', async () => {
      try {
        await api.post('/api/seed');
        toast('Starter machine and materials added');
        renderDashboard(root, ctx);
      } catch (err) {
        toast(err.message === 'already_seeded' ? 'Already loaded' : 'Could not load', 'bad');
      }
    });
    return;
  }

  let full = [];
  try { full = await api.get('/api/entries'); } catch { full = []; }
  const byId = new Map(full.map((e) => [e.id, e]));
  const list = stats.recent.map((r) => byId.get(r.id)).filter(Boolean).slice(0, 6);

  recent.innerHTML = list.map(entryCard).join('');
  recent.onclick = (e) => {
    const card = e.target.closest('[data-entry]');
    if (!card) return;
    const row = byId.get(card.dataset.entry);
    if (row) openEntryDetail(row, ctx, () => renderDashboard(root, ctx));
  };
}
