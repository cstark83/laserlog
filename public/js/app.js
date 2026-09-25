/* LaserLog — shell, router, auth gate. */
import * as api from './api.js';
import { $, el, esc, icons, toast, openSheet, readForm, field } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderEntries, openEntryEditor } from './views/entries.js';
import { renderMaterials, renderMachines, openMaterialEditor, openMachineEditor } from './views/library.js';
import { renderProjects, openProjectEditor } from './views/projects.js';
import { renderTests, openTestEditor } from './views/tests.js';
import { renderSettings } from './views/settings.js';
import { renderFiles, openSourceEditor } from './views/files.js';
import { renderColours, openColourEditor } from './views/colours.js';
import { renderInventory, openSupplyEditor } from './views/inventory.js';
import { renderProducts, openProductEditor } from './views/products.js';
import { renderFinishes, openFinishEditor } from './views/finishes.js';
import { renderMaintenance, openMaintenanceEditor } from './views/maintenance.js';
import { drawTimerBar, activeTimer, startTimer } from './timer.js';

const ctx = { machines: [], materials: [], entries: [], projects: [] };

const ROUTES = {
  bench:     { title: 'Bench',     icon: 'home',     nav: true,  render: renderDashboard },
  library:   { title: 'Library',   icon: 'library',  nav: true,  render: renderEntries },
  files:     { title: 'Files',     icon: 'files',    nav: true,  render: renderFiles },
  materials: { title: 'Materials', icon: 'material', nav: true,  render: renderMaterials },
  more:      { title: 'More',      icon: 'settings', nav: true,  render: renderMore },
  products:  { title: 'Products',  icon: 'tag',      nav: false, render: renderProducts },
  inventory: { title: 'Inventory', icon: 'box',      nav: false, render: renderInventory },
  colours:   { title: 'Colours',   icon: 'flame',    nav: false, render: renderColours },
  finishes:  { title: 'Finishes',  icon: 'flame',    nav: false, render: renderFinishes },
  tests:     { title: 'Tests',     icon: 'grid',     nav: false, render: renderTests },
  machines:  { title: 'Machines',  icon: 'machine',  nav: false, render: renderMachines },
  projects:  { title: 'Projects',  icon: 'project',  nav: false, render: renderProjects },
  maintenance: { title: 'Maintenance', icon: 'settings', nav: false, render: renderMaintenance },
  settings:  { title: 'Settings',  icon: 'settings', nav: false, render: renderSettings },
};

const route = () => (location.hash.replace(/^#\/?/, '') || 'bench').split('?')[0];

/* --------------------------------------------------------------- shell */

function shell() {
  document.body.innerHTML = `
    <div class="app">
      <header class="topbar">
        <a class="brand" href="#/bench" style="color:inherit;text-decoration:none">
          <span class="brand__mark">${icons.laser}</span>
          <span class="topbar__title">LaserLog</span>
        </a>
        <span class="spacer"></span>
        <span id="status"></span>
      </header>
      <div id="offline-bar"></div>
      <div id="timer-bar"></div>
      <main id="view"></main>
      <nav class="nav">
        ${Object.entries(ROUTES).filter(([, r]) => r.nav).map(([key, r]) => `
          <a class="nav__item" href="#/${key}" data-route="${key}">
            ${icons[r.icon]}<span>${esc(r.title)}</span>
          </a>`).join('')}
      </nav>
      <button class="fab" id="fab" aria-label="Add">${icons.plus}</button>
    </div>`;

  $('#fab').addEventListener('click', onAdd);
  api.onStateChange(drawStatus);
  drawStatus();
}

function drawStatus() {
  const bar = $('#offline-bar');
  const status = $('#status');
  if (!bar || !status) return;

  if (!api.state.online) {
    bar.innerHTML = `<div class="offline-bar">${icons.offline}
      <span>Offline${api.state.pending ? ` — ${api.state.pending} change${api.state.pending === 1 ? '' : 's'} queued` : ''}</span>
    </div>`;
  } else if (api.state.pending) {
    bar.innerHTML = `<div class="offline-bar" style="background:var(--accent-dim);color:var(--accent);border-color:rgba(139,92,246,.3)">
      ${icons.sync}<span>${api.state.pending} change${api.state.pending === 1 ? '' : 's'} waiting to sync</span>
    </div>`;
  } else {
    bar.innerHTML = '';
  }
  status.innerHTML = '';
}

/** The + button does the right thing for wherever you are. */
function onAdd() {
  const r = route();
  const refresh = () => render();
  if (r === 'materials') return openMaterialEditor(null, ctx, refresh);
  if (r === 'machines') return openMachineEditor(null, ctx, refresh);
  if (r === 'projects') return openProjectEditor(null, ctx, refresh);
  if (r === 'tests') return openTestEditor(null, ctx, refresh);
  if (r === 'files') return openSourceEditor(null, ctx, refresh);
  if (r === 'colours') return openColourEditor(null, ctx, refresh);
  if (r === 'inventory') return openSupplyEditor(null, ctx, refresh);
  if (r === 'products') return openProductEditor(null, ctx, refresh);
  if (r === 'finishes') return openFinishEditor(null, ctx, refresh);
  if (r === 'maintenance') return openMaintenanceEditor(null, ctx, refresh);
  return openEntryEditor(null, ctx, refresh);
}

/* -------------------------------------------------------------- "more" */

async function renderMore(root) {
  root.innerHTML = `
    <div class="page-head"><div><h1>More</h1></div></div>
    <div class="list">
      ${[['products', 'Products & pricing', 'tag', 'What it costs you and what to charge'],
         ['inventory', 'Inventory', 'box', 'What you buy, what it cost, what is left'],
         ['colours', 'Colour palette', 'flame', 'MOPA colours on stainless, and what made them'],
         ['finishes', 'Finishes', 'flame', 'Paint fill, stain and sealer — what went on and how'],
         ['tests', 'Test grids', 'grid', 'Run a matrix, rate the squares, keep the winner'],
         ['machines', 'Machines', 'machine', 'Your lasers and their defaults'],
         ['projects', 'Projects', 'project', 'Jobs, run time and what they earned'],
         ['maintenance', 'Maintenance', 'settings', 'What you cleaned and replaced, and what is due'],
         ['settings', 'Settings & backup', 'settings', 'Sync, export, install on your phone']]
        .map(([key, title, icon, sub]) => `
        <a class="listitem" href="#/${key}" style="text-decoration:none;color:inherit">
          <span style="color:var(--accent)">${icons[icon]}</span>
          <div class="listitem__main">
            <div class="listitem__title">${esc(title)}</div>
            <div class="listitem__sub">${esc(sub)}</div>
          </div>
          <span class="listitem__chev">${icons.chevron}</span>
        </a>`).join('')}
    </div>`;
}

/* -------------------------------------------------------------- router */

async function render() {
  const key = route();
  const r = ROUTES[key] || ROUTES.bench;
  const view = $('#view');
  if (!view) return;

  document.title = key === 'bench' ? 'LaserLog' : `${r.title} · LaserLog`;
  for (const a of document.querySelectorAll('.nav__item')) {
    a.classList.toggle('is-active', a.dataset.route === key);
  }
  $('#fab').style.display = key === 'settings' || key === 'more' ? 'none' : '';

  // The bar survives route changes; stopping it drops you into a project with
  // the run time already filled in, which is the only reason you timed it.
  drawTimerBar((r) => {
    if (!r) return;
    openProjectEditor({ run_time_min: Math.max(Number(r.minutes.toFixed(1)), 0.1), name: r.label || '',
                        date: new Date().toISOString().slice(0, 10) },
                      ctx, () => render());
  });

  try {
    await r.render(view, ctx);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty">${icons.warn}<h3>Something broke</h3>
      <p>${esc(e.message)}</p></div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);

window.addEventListener('laserlog:synced', (e) => {
  const { pushed, conflicts } = e.detail;
  toast(conflicts
    ? `Synced ${pushed} change${pushed === 1 ? '' : 's'} — ${conflicts} overwritten by a newer edit`
    : `Synced ${pushed} change${pushed === 1 ? '' : 's'}`);
  render();
});

/* ---------------------------------------------------------------- auth */

function authScreen(mode) {
  const isSetup = mode === 'setup';
  document.body.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">
          <span class="brand__mark">${icons.laser}</span>
          <h1 style="font-size:26px">LaserLog</h1>
          <p class="muted small center" style="margin:0">
            ${isSetup ? 'Create the account that owns this library.' : 'Sign in to your library.'}
          </p>
        </div>
        <form class="card stack" id="auth">
          ${field({ label: 'Username', name: 'username', value: '' })}
          ${field({ label: 'Password', name: 'password', value: '', type: 'password',
            hint: isSetup ? 'At least 6 characters' : '' })}
          <button class="btn btn--primary btn--block" type="submit">
            ${isSetup ? 'Create account' : 'Sign in'}
          </button>
          <div class="small" id="err" style="color:var(--bad);display:none"></div>
        </form>
      </div>
    </div>`;

  $('#auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(e.currentTarget);
    const err = $('#err');
    try {
      await api.post(isSetup ? '/api/auth/setup' : '/api/auth/login', data);
      location.reload();
    } catch (ex) {
      err.style.display = 'block';
      err.textContent = ex.body?.error === 'bad_credentials'
        ? 'Wrong username or password.'
        : ex.body?.message || ex.body?.error || ex.message;
    }
  });
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  document.documentElement.dataset.theme = localStorage.getItem('laserlog.theme') || 'dark';

  let auth;
  try {
    auth = await api.get('/api/auth/state', { cache: false });
  } catch {
    // Server unreachable — go straight to the cached library, clearly marked.
    api.state.online = false;
    shell(); render();
    return;
  }

  if (auth.auth_enabled && auth.setup_required) return authScreen('setup');
  if (auth.auth_enabled && !auth.user) return authScreen('login');

  shell();
  await render();

  // Warm the offline mirror and drain anything queued from last time.
  api.flushQueue().then((r) => { if (r.pushed) render(); });
  api.primeCache().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

window.addEventListener('laserlog:auth', () => {
  if (!document.querySelector('.auth-wrap')) location.reload();
});

boot();
