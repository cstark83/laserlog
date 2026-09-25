/*
 * LaserLog — the file catalogue.
 *
 * Points at a folder you already have (Nextcloud, mounted read-only), lists
 * what's in it, and lets you sort a few hundred files into categories without
 * touching a single one of them on disk.
 */
import * as api from '../api.js';
import {
  $, $$, el, esc, num, bytes, icons, relTime, openSheet, closeSheet, confirmSheet,
  toast, readForm, field, selectField, textareaField, switchField, empty, thickness,
  FILE_KINDS, opLabel,
} from '../ui.js';

const PAGE = 200;

const state = {
  q: '', kind: '', category: '', uncategorized: false, missing: false,
  selecting: false, selected: new Set(),
  loaded: [],          // everything fetched so far for the current filter
  total: 0,
};

/* ------------------------------------------------------------- render */

export async function renderFiles(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Files</h1><p>Your design files, catalogued where they already live.</p></div>
      <div class="row" style="gap:8px">
        <button class="btn btn--sm" id="scan">${icons.scan}<span>Scan</span></button>
        <button class="btn btn--sm btn--ghost" id="sources">${icons.cloud}<span>Sources</span></button>
      </div>
    </div>
    <div id="body"><div class="skeleton"></div></div>`;

  const body = $('#body', root);
  const redraw = () => renderFiles(root, ctx);

  $('#sources', root).addEventListener('click', () => openSources(ctx, redraw));
  $('#scan', root).addEventListener('click', () => runScan(redraw));

  // The detail sheet offers material / machine / project pickers, so make sure
  // those lists are loaded even if Files is the first screen opened.
  const [sources] = await Promise.all([
    api.get('/api/sources').catch(() => []),
    ctx.materials?.length ? null : api.get('/api/materials').then((r) => { ctx.materials = r; }).catch(() => {}),
    ctx.machines?.length ? null : api.get('/api/machines').then((r) => { ctx.machines = r; }).catch(() => {}),
    ctx.projects?.length ? null : api.get('/api/projects').then((r) => { ctx.projects = r; }).catch(() => {}),
  ]);
  ctx.sources = sources;

  if (!sources.length) {
    body.innerHTML = empty(
      icons.cloud,
      'No folder connected yet',
      "Point LaserLog at the folder your laser files already live in. It only ever reads — nothing on disk gets moved, renamed or changed.",
      `<button class="btn btn--primary" id="setup">${icons.plus}<span>Connect a folder</span></button>`
    );
    $('#setup', body).addEventListener('click', () => openSourceEditor(null, ctx, redraw));
    return;
  }

  const [facets, data] = await Promise.all([
    api.get('/api/files/facets').catch(() => ({ kinds: [], categories: [], uncategorized: 0, missing: 0 })),
    loadFiles(),
  ]);

  body.innerHTML = `
    <div class="stack" style="margin-bottom:14px">
      <div class="searchbar">
        ${icons.search}
        <input type="search" id="q" placeholder="Search file name, folder, notes…"
               value="${esc(state.q)}" autocomplete="off">
      </div>
      <div class="chips" id="kind-chips"></div>
      <div class="chips" id="cat-chips"></div>
      <div class="row row--wrap" style="gap:8px">
        <button class="btn btn--sm ${state.selecting ? 'btn--primary' : ''}" id="select-toggle">
          ${state.selecting ? icons.close : icons.checkbox}
          <span>${state.selecting ? 'Cancel' : 'Select'}</span>
        </button>
        <span id="bulk-actions" class="row" style="gap:8px"></span>
        <span class="spacer"></span>
        <span class="small muted nowrap" id="count"></span>
      </div>
    </div>
    <div id="grid"></div>`;

  drawKindChips($('#kind-chips', body), facets, redraw);
  drawCatChips($('#cat-chips', body), facets, redraw);

  const q = $('#q', body);
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      state.q = q.value.trim();
      const d = await loadFiles();
      drawGrid($('#grid', body), d, ctx, redraw);
      $('#count', body).textContent = countLabel(d);
    }, 220);
  });

  $('#select-toggle', body).addEventListener('click', () => {
    state.selecting = !state.selecting;
    state.selected.clear();
    redraw();
  });

  $('#count', body).textContent = countLabel(data);
  drawGrid($('#grid', body), data, ctx, redraw);
  drawBulkBar(body, ctx, redraw);
}

async function loadFiles({ append = false } = {}) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.kind) p.set('kind', state.kind);
  if (state.category) p.set('category', state.category);
  if (state.uncategorized) p.set('uncategorized', '1');
  if (state.missing) p.set('missing', '1');
  p.set('limit', String(PAGE));
  p.set('offset', String(append ? state.loaded.length : 0));

  let d;
  try { d = await api.get('/api/files?' + p.toString()); }
  catch { d = { total: append ? state.total : 0, files: [] }; }

  state.loaded = append ? state.loaded.concat(d.files) : d.files;
  state.total = d.total;
  return { total: state.total, files: state.loaded };
}

const countLabel = (d) => `${d.total} file${d.total === 1 ? '' : 's'}`;

function drawKindChips(host, facets, redraw) {
  const chip = (label, on, attr) =>
    `<button class="chip ${on ? 'is-on' : ''}" ${attr}>${esc(label)}</button>`;
  host.innerHTML = [
    chip('All', !state.kind && !state.uncategorized && !state.missing, 'data-kind=""'),
    ...facets.kinds.map((k) =>
      chip(`${FILE_KINDS[k.kind]?.label || k.kind} ${k.n}`, state.kind === k.kind, `data-kind="${k.kind}"`)),
    facets.uncategorized
      ? chip(`Uncategorised ${facets.uncategorized}`, state.uncategorized, 'data-uncat="1"') : '',
    facets.missing ? chip(`Missing ${facets.missing}`, state.missing, 'data-missing="1"') : '',
  ].join('');

  host.onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.uncat) { state.uncategorized = !state.uncategorized; state.missing = false; state.kind = ''; }
    else if (b.dataset.missing) { state.missing = !state.missing; state.uncategorized = false; state.kind = ''; }
    else { state.kind = b.dataset.kind; state.uncategorized = false; state.missing = false; }
    redraw();
  };
}

function drawCatChips(host, facets, redraw) {
  if (!facets.categories.length) { host.style.display = 'none'; return; }
  host.innerHTML = facets.categories.map((c) =>
    `<button class="chip ${state.category === c.category ? 'is-on' : ''}"
             data-cat="${esc(c.category)}">${esc(c.category)} ${c.n}</button>`).join('');
  host.onclick = (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.category = state.category === b.dataset.cat ? '' : b.dataset.cat;
    redraw();
  };
}

/* ---------------------------------------------------------- the grid */

function fileCard(f) {
  const kind = FILE_KINDS[f.kind] || FILE_KINDS.other;
  const hasThumb = f.thumb || f.kind === 'image' || f.ext === '.svg';
  const settings = f.meta?.cut_settings?.length || 0;
  const selected = state.selected.has(f.id);

  return `
    <article class="filecard ${selected ? 'is-selected' : ''} ${f.missing ? 'is-missing' : ''}"
             data-file="${esc(f.id)}">
      <div class="filecard__thumb ${f.ext === '.svg' ? 'filecard__thumb--art' : ''}">
        ${hasThumb
          ? `<img src="/api/files/${esc(f.id)}/thumb" loading="lazy" alt=""
                  onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'filecard__icon',innerHTML:this.dataset.fb}))"
                  data-fb="${esc(icons[kind.icon])}">`
          : `<div class="filecard__icon">${icons[kind.icon]}</div>`}
        ${state.selecting
          ? `<span class="filecard__check">${selected ? icons.checkboxOn : icons.checkbox}</span>` : ''}
        ${settings ? `<span class="filecard__badge">${settings} layer${settings === 1 ? '' : 's'}</span>` : ''}
      </div>
      <div class="filecard__meta">
        <div class="filecard__name" title="${esc(f.rel_path)}">${esc(f.name)}</div>
        <div class="filecard__sub">
          ${f.category ? `<span class="badge">${esc(f.category)}</span>` : '<span class="muted">—</span>'}
          <span class="muted">${bytes(f.size)}</span>
        </div>
      </div>
      ${f.is_favorite ? `<span class="filecard__fav">${icons.star}</span>` : ''}
    </article>`;
}

function drawGrid(host, data, ctx, redraw) {
  if (!data.files.length) {
    host.innerHTML = empty(icons.files, 'Nothing here',
      state.q || state.kind || state.category
        ? 'Try clearing a filter.'
        : 'Hit Scan to read the folder.');
    return;
  }

  const shown = data.files.length;
  const more = data.total > shown;
  host.innerHTML = `
    <div class="filegrid">${data.files.map(fileCard).join('')}</div>
    ${more ? `
      <div class="loadmore">
        <button class="btn" id="more">Load ${Math.min(PAGE, data.total - shown)} more</button>
        <span class="small muted">Showing ${shown} of ${data.total}</span>
      </div>` : ''}`;

  const moreBtn = $('#more', host);
  if (moreBtn) {
    moreBtn.addEventListener('click', async () => {
      moreBtn.disabled = true;
      moreBtn.innerHTML = 'Loading…';
      const d = await loadFiles({ append: true });
      drawGrid(host, d, ctx, redraw);
    });
  }

  host.onclick = (e) => {
    const card = e.target.closest('[data-file]');
    if (!card) return;
    const f = data.files.find((x) => x.id === card.dataset.file);
    if (!f) return;

    if (state.selecting) {
      if (state.selected.has(f.id)) state.selected.delete(f.id);
      else state.selected.add(f.id);
      card.classList.toggle('is-selected', state.selected.has(f.id));
      const check = card.querySelector('.filecard__check');
      if (check) check.innerHTML = state.selected.has(f.id) ? icons.checkboxOn : icons.checkbox;
      drawBulkBar(host.closest('#body'), ctx, redraw);
      return;
    }
    openFileDetail(f, ctx, redraw);
  };
}

function drawBulkBar(body, ctx, redraw) {
  const host = $('#bulk-actions', body);
  if (!host) return;
  const n = state.selected.size;
  if (!state.selecting || n === 0) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <button class="btn btn--sm btn--primary" id="bulk-cat">${icons.folder}<span>Categorise ${n}</span></button>
    <button class="btn btn--sm" id="bulk-all">Select all</button>`;
  $('#bulk-cat', host).addEventListener('click', () => openBulkSheet(ctx, redraw));
  $('#bulk-all', host).addEventListener('click', () => {
    for (const c of $$('[data-file]', body)) state.selected.add(c.dataset.file);
    redraw();
  });
}

/* --------------------------------------------------------- bulk sheet */

function openBulkSheet(ctx, redraw) {
  const ids = [...state.selected];
  const cats = (ctx.fileCategories || []);
  const body = el('<form class="stack"></form>');
  body.innerHTML = `
    <div class="small muted">Applies to ${ids.length} selected file${ids.length === 1 ? '' : 's'}.
      Leave a box empty to leave that field alone.</div>
    ${field({ label: 'Category', name: 'category', value: '',
      placeholder: 'Coasters, Signs, Customer jobs…' })}
    ${field({ label: 'Add tags', name: 'add_tags', value: '',
      placeholder: 'ply, production', hint: 'Comma separated' })}
    ${selectField({ label: 'Material', name: 'material_id', value: '',
      options: (ctx.materials || []).map((m) => ({
        value: m.id, label: m.name + (m.thickness_mm ? ` — ${thickness(m.thickness_mm)}` : ''),
      })), blank: 'Leave alone' })}
    ${selectField({ label: 'Machine', name: 'machine_id', value: '',
      options: (ctx.machines || []).map((m) => ({ value: m.id, label: m.name })),
      blank: 'Leave alone' })}
    ${switchField({ label: 'Mark as favourite', name: 'is_favorite', checked: false })}`;

  openSheet({
    title: `Categorise ${ids.length} files`,
    body,
    actions: [
      { label: 'Cancel', onClick: () => {} },
      { label: 'Apply', kind: 'primary', icon: icons.check, onClick: async () => {
          const d = readForm(body);
          const set = {};
          if (d.category) set.category = d.category;
          if (d.material_id) set.material_id = d.material_id;
          if (d.machine_id) set.machine_id = d.machine_id;
          if (d.is_favorite) set.is_favorite = 1;
          const add_tags = String(d.add_tags || '').split(',').map((s) => s.trim()).filter(Boolean);
          if (!Object.keys(set).length && !add_tags.length) {
            toast('Nothing to apply', 'bad'); return true;
          }
          const res = await api.post('/api/files/bulk', { ids, set, add_tags });
          toast(`Updated ${res.changed} file${res.changed === 1 ? '' : 's'}`);
          state.selected.clear();
          state.selecting = false;
          redraw();
        } },
    ],
  });
}

/* -------------------------------------------------------- file detail */

export function openFileDetail(file, ctx, onChanged) {
  const body = el('<div class="stack"></div>');
  const kind = FILE_KINDS[file.kind] || FILE_KINDS.other;
  const hasThumb = file.thumb || file.kind === 'image' || file.ext === '.svg';
  const cuts = file.meta?.cut_settings || [];

  body.innerHTML = `
    ${hasThumb ? `<img src="/api/files/${esc(file.id)}/thumb"
        class="${file.ext === '.svg' ? 'thumb-art' : ''}"
        style="width:100%;max-height:240px;object-fit:contain;border-radius:12px;
               background:var(--surface-2);border:1px solid var(--border)"
        onerror="this.remove()">` : ''}

    ${file.missing ? `<div class="card" style="background:var(--warn-dim);border-color:rgba(251,191,36,.3)">
      <div class="small" style="color:var(--warn)">
        This file wasn't there at the last scan. Your notes and tags are kept in case it comes back.
      </div></div>` : ''}

    <div class="card">
      <div class="kv"><span class="kv__k">Type</span><span class="kv__v">${esc(kind.label)}</span></div>
      <div class="kv"><span class="kv__k">Folder</span>
        <span class="kv__v kv__v--mono" style="word-break:break-all">${esc(file.folder || '/')}</span></div>
      <div class="kv"><span class="kv__k">Size</span><span class="kv__v">${bytes(file.size)}</span></div>
      <div class="kv"><span class="kv__k">Modified</span><span class="kv__v">${relTime(file.mtime)}</span></div>
      ${file.meta?.format ? `<div class="kv"><span class="kv__k">Saved by</span>
        <span class="kv__v">${esc(file.meta.format)}</span></div>` : ''}
    </div>

    ${file.meta?.notes ? `<div class="card">
      <div class="field__label" style="margin-bottom:6px">Notes inside the file</div>
      <div style="white-space:pre-wrap">${esc(file.meta.notes)}</div></div>` : ''}

    ${cuts.length ? `
      <div class="section-title">Settings found in this file</div>
      <div class="card stack">
        ${cuts.map((c) => `
          <div class="row row--between" style="gap:12px;align-items:flex-start">
            <div style="min-width:0">
              <div style="font-weight:620">${esc(c.name || `Layer ${c.index}`)}
                <span class="badge badge--op" style="margin-left:6px">${esc(c.type || '')}</span></div>
              <div class="small muted mono" style="margin-top:2px">
                ${[c.speed != null ? `${num(c.speed, 0)} ${c.speed_unit}` : null,
                   c.power_max != null ? `${c.power_min != null ? `${num(c.power_min)}–` : ''}${num(c.power_max)}%` : null,
                   c.passes != null ? `${c.passes} pass${c.passes === 1 ? '' : 'es'}` : null,
                   c.interval != null ? `${num(c.interval, 3)}mm` : null,
                   c.dpi ? `${c.dpi} DPI` : null,
                   c.air_assist ? 'air' : null].filter(Boolean).map(esc).join(' · ')}
              </div>
            </div>
          </div>`).join('')}
        <div class="field__hint">
          LightBurn stores speed in mm/sec — these import with those units.
        </div>
        <button class="btn btn--primary btn--block" id="import-settings">
          ${icons.wand}<span>Add ${cuts.length} to my settings library</span>
        </button>
      </div>` : ''}

    <div class="section-title">Your notes on it</div>
    <form class="stack" id="fileform">
      ${field({ label: 'Category', name: 'category', value: file.category,
        placeholder: 'Coasters, Signs, Customer jobs…' })}
      ${field({ label: 'Tags', name: '_tags', value: (file.tags || []).join(', '),
        placeholder: 'ply, production', hint: 'Comma separated' })}
      <div class="field-row">
        ${selectField({ label: 'Material', name: 'material_id', value: file.material_id,
          options: (ctx.materials || []).map((m) => ({
            value: m.id, label: m.name + (m.thickness_mm ? ` — ${thickness(m.thickness_mm)}` : ''),
          })), blank: 'None' })}
        ${selectField({ label: 'Machine', name: 'machine_id', value: file.machine_id,
          options: (ctx.machines || []).map((m) => ({ value: m.id, label: m.name })), blank: 'None' })}
      </div>
      ${selectField({ label: 'Project', name: 'project_id', value: file.project_id,
        options: (ctx.projects || []).map((p) => ({ value: p.id, label: p.name })), blank: 'None' })}
      ${textareaField({ label: 'Notes', name: 'notes', value: file.notes, rows: 2 })}
      ${switchField({ label: 'Favourite', name: 'is_favorite', checked: file.is_favorite })}
    </form>

    <div class="row" style="gap:8px">
      <a class="btn btn--sm" href="/api/files/${esc(file.id)}/raw" download>
        ${icons.download}<span>Download</span>
      </a>
      <button class="btn btn--sm btn--ghost" id="forget">${icons.trash}<span>Remove from catalogue</span></button>
    </div>`;

  const form = $('#fileform', body);

  $('#import-settings', body)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const d = readForm(form);
      const res = await api.post(`/api/files/${file.id}/import-settings`, {
        material_id: d.material_id || null,
        machine_id: d.machine_id || null,
      });
      toast(`Added ${res.created} setting${res.created === 1 ? '' : 's'} to your library`);
      onChanged?.();
    } catch (err) {
      toast(err.message || 'Could not import', 'bad');
      btn.disabled = false;
    }
  });

  $('#forget', body).addEventListener('click', async () => {
    closeSheet();
    if (await confirmSheet('Remove from catalogue?',
        'This only forgets it here. The file on your server is left exactly where it is.', 'Remove')) {
      await api.del(`/api/files/${file.id}`);
      toast('Removed from catalogue');
      onChanged?.();
    }
  });

  openSheet({
    title: file.name,
    body,
    actions: [
      { label: 'Close', onClick: () => {} },
      { label: 'Save', kind: 'primary', icon: icons.check, onClick: async () => {
          const d = readForm(form);
          const tags = String(d._tags || '').split(',').map((s) => s.trim()).filter(Boolean);
          delete d._tags;
          await api.put(`/api/files/${file.id}`, { ...d, tags });
          toast('Saved');
          onChanged?.();
        } },
    ],
  });
}

/* ------------------------------------------------------------ sources */

async function runScan(redraw) {
  let sources = [];
  try { sources = await api.get('/api/sources'); } catch {}
  if (!sources.length) { toast('Connect a folder first', 'bad'); return; }

  toast('Scanning…');
  for (const s of sources.filter((x) => x.enabled)) {
    try {
      const res = await api.post(`/api/sources/${s.id}/scan`);
      toast(res.message);
    } catch (e) {
      toast(`${s.name}: ${e.body?.error || e.message}`, 'bad');
    }
  }
  redraw();
}

export function openSources(ctx, onChanged) {
  const body = el('<div class="stack"></div>');

  const draw = async () => {
    let sources = [];
    try { sources = await api.get('/api/sources'); } catch {}
    body.innerHTML = `
      ${sources.length ? `<div class="list">${sources.map((s) => `
        <div class="listitem" data-src="${esc(s.id)}">
          <span style="color:var(--accent)">${s.kind === 'webdav' ? icons.cloud : icons.folder}</span>
          <div class="listitem__main">
            <div class="listitem__title">${esc(s.name)}</div>
            <div class="listitem__sub mono" style="word-break:break-all">
              ${esc(s.kind === 'webdav' ? s.url : s.root_path)}${s.subpath ? ` / ${esc(s.subpath)}` : ''}
            </div>
            <div class="listitem__sub">
              ${s.last_scan_at ? `${esc(relTime(s.last_scan_at))} — ` : ''}${
                s.last_scan_msg ? esc(s.last_scan_msg) : 'never scanned'}
            </div>
            ${s.exclude ? `<div class="listitem__sub muted">Skipping: ${
              esc(String(s.exclude).split(/[\n,]/).map((x) => x.trim()).filter(Boolean).join(', '))}</div>` : ''}
            ${s.enabled ? '' : '<div class="listitem__sub" style="color:var(--warn)">Not included in scans</div>'}
          </div>
          <span class="listitem__chev">${icons.chevron}</span>
        </div>`).join('')}</div>` : `<p class="muted small">No folders connected yet.</p>`}
      <button class="btn btn--primary btn--block" id="add-src">${icons.plus}<span>Connect a folder</span></button>`;

    $('#add-src', body).addEventListener('click', () => openSourceEditor(null, ctx, () => { draw(); onChanged?.(); }));
    body.onclick = (e) => {
      const item = e.target.closest('[data-src]');
      if (!item) return;
      const s = sources.find((x) => x.id === item.dataset.src);
      if (s) openSourceEditor(s, ctx, () => { draw(); onChanged?.(); });
    };
  };

  draw();
  openSheet({ title: 'File sources', body, actions: [{ label: 'Done', kind: 'primary', onClick: () => onChanged?.() }] });
}

export function openSourceEditor(source, ctx, onSaved) {
  const s = source || {};
  const isNew = !s.id;
  const body = el('<form class="stack"></form>');

  const render = (kind) => {
    body.innerHTML = `
      ${field({ label: 'Name', name: 'name', value: s.name || 'Nextcloud',
        placeholder: 'Nextcloud' })}
      ${selectField({ label: 'How to reach it', name: 'kind', value: kind,
        options: [
          { value: 'folder', label: 'Mounted folder (same server)' },
          { value: 'webdav', label: 'Over the network (WebDAV)' },
        ], blank: null })}

      ${kind === 'folder' ? `
        ${field({ label: 'Folder inside the container', name: 'root_path',
          value: s.root_path || '/nextcloud', placeholder: '/nextcloud',
          hint: 'Where you mounted it in the container, not the path on Unraid' })}
        ${field({ label: 'Subfolder (optional)', name: 'subpath', value: s.subpath,
          placeholder: 'Laser', hint: 'Limit the scan to one folder inside that' })}
        <div class="card" style="background:var(--accent-dim);border-color:rgba(139,92,246,.3)">
          <div class="small">
            Add this to the container, read-only:<br>
            <span class="mono" style="display:inline-block;margin-top:6px;word-break:break-all">
              -v /mnt/user/nextcloud/chris/files:/nextcloud:ro
            </span><br>
            <span class="muted" style="display:inline-block;margin-top:6px">
              The <strong>:ro</strong> is what guarantees LaserLog can never change your files.
            </span>
          </div>
        </div>`
      : `
        ${field({ label: 'Nextcloud address', name: 'url', value: s.url, type: 'url',
          placeholder: 'https://cloud.example.com' })}
        ${field({ label: 'Username', name: 'username', value: s.username })}
        ${field({ label: 'App password', name: 'password', value: '', type: 'password',
          hint: isNew ? 'Nextcloud → Settings → Security → Create new app password'
                      : 'Leave blank to keep the current one' })}
        ${field({ label: 'Subfolder (optional)', name: 'subpath', value: s.subpath,
          placeholder: 'Laser' })}`}

      ${textareaField({ label: 'Skip these folders', name: 'exclude', value: s.exclude, rows: 3,
        placeholder: 'Downloads\nDocuments\nDesktop\nAdmin/Backups' })}
      <div class="small muted" style="margin-top:-6px">
        One per line. A plain name skips that folder anywhere it turns up;
        a name with a slash skips just that path. Files already catalogued from a
        folder you add here are dropped on the next scan.
      </div>

      ${switchField({ label: 'Include in scans', name: 'enabled', checked: s.enabled ?? 1 })}
      <div id="test-result"></div>`;

    $('[name=kind]', body).addEventListener('change', (e) => render(e.target.value));
  };

  render(s.kind || 'folder');

  const save = async () => {
    const d = readForm(body);
    if (!d.name) { toast('Give it a name', 'bad'); return null; }
    if (d.kind === 'folder' && !d.root_path) { toast('Folder path is required', 'bad'); return null; }
    if (d.kind === 'webdav' && (!d.url || !d.username)) { toast('Address and username are required', 'bad'); return null; }
    if (s.id) d.id = s.id;
    return s.id ? api.put(`/api/sources/${s.id}`, d) : api.post('/api/sources', d);
  };

  openSheet({
    title: isNew ? 'Connect a folder' : s.name,
    body,
    actions: [
      ...(isNew ? [] : [{ label: 'Remove', kind: 'danger', icon: icons.trash, onClick: async () => {
          closeSheet();
          if (await confirmSheet('Disconnect this folder?',
              'The catalogue for it is dropped. Your actual files are not touched.', 'Disconnect')) {
            await api.del(`/api/sources/${s.id}`);
            toast('Disconnected'); onSaved?.();
          }
          return true;
        } }]),
      { label: 'Test', icon: icons.check, onClick: async () => {
          const saved = await save();
          if (!saved) return true;
          const out = $('#test-result', body);
          out.innerHTML = `<div class="small muted">Checking…</div>`;
          try {
            const r = await api.post(`/api/sources/${saved.id}/test`);
            out.innerHTML = `<div class="card" style="background:var(--ok-dim);border-color:rgba(52,211,153,.3)">
              <div class="small" style="color:var(--ok)">${esc(r.message)}</div></div>`;
          } catch (e) {
            out.innerHTML = `<div class="card" style="background:var(--bad-dim);border-color:rgba(248,113,113,.3)">
              <div class="small" style="color:var(--bad)">${esc(e.body?.error || e.message)}</div></div>`;
          }
          return true;
        } },
      { label: 'Save & scan', kind: 'primary', icon: icons.scan, onClick: async () => {
          const saved = await save();
          if (!saved) return true;
          toast('Scanning…');
          try {
            const res = await api.post(`/api/sources/${saved.id}/scan`);
            toast(res.message);
          } catch (e) {
            toast(e.body?.error || e.message, 'bad');
          }
          onSaved?.();
        } },
    ],
  });
}
