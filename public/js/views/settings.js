/* LaserLog — settings, backup, and getting it onto a phone. */
import * as api from '../api.js';
import {
  $, el, esc, icons, relTime, openSheet, closeSheet, confirmSheet, toast, empty,
} from '../ui.js';

export async function renderSettings(root, ctx) {
  const theme = localStorage.getItem('laserlog.theme') || 'dark';
  const s = api.state;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Settings</h1><p>Backups, your phone, and how this thing is wired up.</p></div>
    </div>

    <div class="section-title">Sync</div>
    <div class="card stack">
      <div class="kv">
        <span class="kv__k">Connection</span>
        <span class="kv__v">${s.online ? '<span class="badge badge--ok">Online</span>'
                                       : '<span class="badge badge--partial">Offline</span>'}</span>
      </div>
      <div class="kv">
        <span class="kv__k">Waiting to sync</span>
        <span class="kv__v">${s.pending} change${s.pending === 1 ? '' : 's'}</span>
      </div>
      <div class="kv">
        <span class="kv__k">Last synced</span>
        <span class="kv__v">${s.lastSync ? esc(relTime(s.lastSync)) : 'never'}</span>
      </div>
      <button class="btn btn--block" id="sync-now">${icons.sync}<span>Sync now</span></button>
      <span class="field__hint">
        Downloads the whole library onto this device so it stays readable with the wifi off,
        and pushes anything you logged while disconnected.
      </span>
    </div>

    <div class="section-title">Put it on your phone</div>
    <div class="card stack">
      <p class="small muted" style="margin:0">
        This is a progressive web app — it installs from the browser, no app store involved.
        Both phones end up talking to the same database on your server.
      </p>
      <button class="btn btn--block" id="install-help">${icons.phone}<span>Show me how</span></button>
    </div>

    <div class="section-title">Backup</div>
    <div class="card stack">
      <a class="btn btn--block" href="/api/export/json" download>
        ${icons.download}<span>Download full backup (JSON)</span>
      </a>
      <a class="btn btn--block" href="/api/export/csv" download>
        ${icons.download}<span>Export settings as CSV</span>
      </a>
      <button class="btn btn--block" id="import">${icons.upload}<span>Restore from backup</span></button>
      <button class="btn btn--block" id="import-csv">${icons.upload}<span>Import settings from a CSV</span></button>
      <button class="btn btn--block" id="snapshots">${icons.files}<span>Snapshots on the server</span></button>
      <span class="field__hint">
        The JSON backup is everything — settings, materials, machines, projects, test grids.
        Photos live in your appdata folder and are not in the JSON.
        A CSV only brings in settings; machines and materials it names get created if they
        are not already here, and rows that match something you already have are skipped.
      </span>
    </div>

    <div class="section-title">Appearance</div>
    <div class="card">
      <button class="btn btn--block" id="theme">
        ${theme === 'dark' ? icons.sun : icons.moon}
        <span>Switch to ${theme === 'dark' ? 'light' : 'dark'} theme</span>
      </button>
    </div>

    <div class="section-title">Account</div>
    <div class="card stack" id="account"></div>

    <div class="section-title">About</div>
    <div class="card">
      <div class="kv"><span class="kv__k">App</span><span class="kv__v">LaserLog</span></div>
      <div class="kv"><span class="kv__k">Version</span><span class="kv__v">1.2.0</span></div>
      <div class="kv"><span class="kv__k">Schema</span><span class="kv__v" id="schema-v">—</span></div>
      <div class="kv"><span class="kv__k">Data</span><span class="kv__v mono">/data</span></div>
    </div>`;

  /* ----------------------------------------------------------- sync */

  $('#sync-now', root).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin" style="display:inline-flex">${icons.sync}</span><span>Syncing…</span>`;
    const r = await api.flushQueue();
    await api.primeCache();
    toast(r.conflicts
      ? `Synced — ${r.conflicts} change was overwritten by a newer one`
      : 'Synced');
    renderSettings(root, ctx);
  });

  /* -------------------------------------------------------- install */

  $('#install-help', root).addEventListener('click', () => {
    const host = location.host;
    openSheet({
      title: 'Install on your phone',
      body: `
        <div class="stack">
          <div class="card">
            <div class="field__label" style="margin-bottom:8px">Android (Chrome)</div>
            <ol class="small" style="margin:0;padding-left:18px;line-height:1.9">
              <li>Open <span class="mono">http://${esc(host)}</span></li>
              <li>Tap the ⋮ menu</li>
              <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong></li>
            </ol>
          </div>
          <div class="card">
            <div class="field__label" style="margin-bottom:8px">iPhone (Safari — it must be Safari)</div>
            <ol class="small" style="margin:0;padding-left:18px;line-height:1.9">
              <li>Open <span class="mono">http://${esc(host)}</span></li>
              <li>Tap the Share button</li>
              <li>Scroll down, tap <strong>Add to Home Screen</strong></li>
            </ol>
          </div>
          <div class="card" style="border-color:rgba(251,191,36,.3);background:var(--warn-dim)">
            <div class="small" style="color:var(--warn)">
              <strong>Away from home?</strong> Your server isn't on the public internet.
              Use Tailscale or your existing VPN back to the house, or put this behind
              your reverse proxy with a real certificate. Don't port-forward it raw.
            </div>
          </div>
        </div>`,
      actions: [{ label: 'Got it', kind: 'primary', onClick: () => {} }],
    });
  });

  /* --------------------------------------------------------- import */

  $('#import', root).addEventListener('click', () => {
    const input = el('<input type="file" accept="application/json,.json" hidden>');
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      if (!(await confirmSheet('Restore from backup?',
          'Rows with matching IDs are overwritten with what is in the file.', 'Restore'))) return;
      try {
        const text = await file.text();
        const res = await api.post('/api/import/json', JSON.parse(text));
        toast(res.message || 'Restored');
        await api.primeCache();
        renderSettings(root, ctx);
      } catch (err) {
        toast('Restore failed: ' + (err.body?.error || err.message), 'bad');
      }
    });
    input.click();
  });

  /**
   * The snapshots the container takes on its own. Until now nothing showed
   * them, which meant nobody had ever opened one — and a backup nobody has
   * opened is a guess.
   */
  $('#snapshots', root).addEventListener('click', async () => {
    const body = el('<div class="stack"></div>');
    body.innerHTML = '<div class="skeleton"></div>';

    const load = async () => {
      let list = [];
      try { list = await api.get('/api/backups'); }
      catch { body.innerHTML = '<p class="muted">Could not read the backup folder.</p>'; return; }

      body.innerHTML = `
        <button class="btn btn--block btn--primary" id="take">
          ${icons.check}<span>Take one now</span></button>
        ${list.length ? `<div class="list">${list.map((b) => `
          <div class="listitem">
            <div class="listitem__main">
              <div class="listitem__title mono" style="font-size:12.5px;word-break:break-all">${esc(b.name)}</div>
              <div class="listitem__sub">${Math.round(b.bytes / 1024)} KB · ${relTime(b.at)}</div>
              <div class="listitem__sub" data-result="${esc(b.name)}"></div>
            </div>
            <button class="btn btn--sm" data-verify="${esc(b.name)}">Check</button>
          </div>`).join('')}</div>`
          : '<p class="muted">No snapshots yet. One is taken at startup and nightly at 3:15am.</p>'}
        <span class="field__hint">
          These live in your appdata folder under <span class="mono">backups/</span>.
          Checking one opens it and confirms it would restore — that is the only way
          to know a backup is real.
        </span>`;

      $('#take', body).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const b = await api.post('/api/backups', {});
          toast(b.verified === false ? `Taken but failed its check: ${b.error}` : 'Snapshot taken and verified',
                b.verified === false ? 'bad' : 'ok');
        } catch (err) { toast('Backup failed: ' + err.message, 'bad'); }
        load();
      });

      body.onclick = async (e) => {
        const btn = e.target.closest('[data-verify]');
        if (!btn) return;
        const name = btn.dataset.verify;
        const out = body.querySelector(`[data-result="${CSS.escape(name)}"]`);
        btn.disabled = true; btn.textContent = 'Checking…';
        try {
          const r = await api.post(`/api/backups/${encodeURIComponent(name)}/verify`, {});
          const counts = Object.entries(r.counts || {})
            .filter(([, n]) => n != null).map(([t, n]) => `${n} ${t}`).join(' · ');
          out.style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
          out.textContent = r.ok
            ? `Restores fine — ${counts}` + (r.note ? ` (${r.note})` : '')
            : r.error;
        } catch (err) {
          out.style.color = 'var(--bad)';
          out.textContent = err.body?.error || err.message;
        }
        btn.disabled = false; btn.textContent = 'Check';
      };
    };

    openSheet({ title: 'Snapshots', body, actions: [{ label: 'Done', kind: 'primary' }] });
    await load();
  });

  $('#import-csv', root).addEventListener('click', () => {
    const input = el('<input type="file" accept=".csv,text/csv" hidden>');
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      try {
        const res = await api.post('/api/import/csv', { csv: await file.text() });
        toast(res.message || `${res.imported} imported`);
        if (res.errors?.length) {
          await confirmSheet(
            `${res.errors.length} row${res.errors.length === 1 ? '' : 's'} did not import`,
            res.errors.map((e) => `Line ${e.line}: ${e.error}`).join('\n'), 'OK');
        }
        await api.primeCache();
      } catch (err) {
        const b = err.body || {};
        toast(b.error === 'no_recognised_columns'
          ? `None of those column names were recognised. Saw: ${(b.saw || []).join(', ')}`
          : 'Import failed: ' + (b.error || err.message), 'bad');
      }
    });
    input.click();
  });

  api.get('/api/health').then((h) => {
    const el2 = $('#schema-v', root);
    if (el2 && h?.schema_version) el2.textContent = `v${h.schema_version}`;
  }).catch(() => {});

  /* ---------------------------------------------------------- theme */

  $('#theme', root).addEventListener('click', () => {
    const next = (localStorage.getItem('laserlog.theme') || 'dark') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('laserlog.theme', next);
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name=theme-color]')
      ?.setAttribute('content', next === 'dark' ? '#0b0d12' : '#f6f7fb');
    renderSettings(root, ctx);
  });

  /* -------------------------------------------------------- account */

  const acct = $('#account', root);
  let auth = { auth_enabled: false, user: null };
  try { auth = await api.get('/api/auth/state', { cache: false }); } catch {}

  if (!auth.auth_enabled) {
    acct.innerHTML = `
      <div class="small muted">
        Running with <span class="mono">AUTH=off</span> — anyone who can reach this address
        can read and change your library. Fine on a trusted LAN, not fine if it's exposed.
      </div>`;
  } else {
    acct.innerHTML = `
      <div class="kv"><span class="kv__k">Signed in as</span>
        <span class="kv__v">${esc(auth.user?.username || '—')}</span></div>
      <button class="btn btn--block" id="token">${icons.key}<span>Copy API token</span></button>
      <button class="btn btn--block" id="logout">${icons.logout}<span>Sign out</span></button>`;

    $('#token', acct).addEventListener('click', async () => {
      try {
        const { token } = await api.post('/api/auth/token');
        await navigator.clipboard.writeText(token);
        toast('Token copied — treat it like a password');
      } catch {
        toast('Could not copy token', 'bad');
      }
    });

    $('#logout', acct).addEventListener('click', async () => {
      await api.post('/api/auth/logout');
      location.reload();
    });
  }
}
