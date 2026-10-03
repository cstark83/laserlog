/* LaserLog — icons, DOM helpers, toasts, modals. No dependencies. */

/* ------------------------------------------------------------------ icons */

const svg = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;

export const icons = {
  laser: svg('<path d="M12 2v6"/><path d="M12 8l-4 6h8l-4-6z" fill="currentColor" stroke="none"/><path d="M12 14v8"/><path d="M5 18h14"/>'),
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  library: svg('<path d="M4 5v14"/><path d="M8 5v14"/><rect x="11" y="5" width="9" height="14" rx="1.5"/>'),
  material: svg('<path d="M3 8l9-5 9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/>'),
  machine: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><circle cx="12" cy="10" r="2.5"/>'),
  project: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  chevron: svg('<path d="m9 18 6-6-6-6"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  star: svg('<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  camera: svg('<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  sliders: svg('<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>'),
  upload: svg('<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 3h16"/>'),
  offline: svg('<path d="M1 1l22 22"/><path d="M16.7 16.7A9 9 0 0 1 12 18"/><path d="M5 12.5a9 9 0 0 1 3-2.2"/><path d="M2 8.8a15 15 0 0 1 4-2.6"/><path d="M18 6.2a15 15 0 0 1 4 2.6"/><circle cx="12" cy="20" r=".6" fill="currentColor"/>'),
  sync: svg('<path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 4v4h-4"/><path d="M3 20v-4h4"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  warn: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8"/><path d="m17 6 3 3"/><path d="m14 9 3 3"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>'),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'),
  filter: svg('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>'),
  flame: svg('<path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.3-3.8C9 8.5 10 10 10 10s-.5-5 2-8z"/>'),
  files: svg('<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  cloud: svg('<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 10.5 3.75 3.75 0 0 0 6.5 19z"/>'),
  scan: svg('<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M3 12h18"/>'),
  checkbox: svg('<rect x="3" y="3" width="18" height="18" rx="4"/>'),
  checkboxOn: svg('<rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor"/><path d="m8 12 3 3 5-6" stroke="#0b0d12" stroke-width="2.5"/>'),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'),
  box: svg('<path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5"/><path d="M12 13v7"/>'),
  tag: svg('<path d="M3 11V5a2 2 0 0 1 2-2h6l9 9-8 8-9-9z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L21 7H6"/>'),
  wand: svg('<path d="m4 20 10-10"/><path d="M15 5.5 18.5 9"/><path d="M13 7 17 3"/><path d="M20 12h.01"/><path d="M7 4h.01"/><path d="M11 2h.01"/>'),
};

/** Human-readable byte size. */
export function bytes(n) {
  if (n === null || n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export const FILE_KINDS = {
  lightburn: { label: 'LightBurn', icon: 'laser' },
  vector:    { label: 'Vector',    icon: 'sliders' },
  image:     { label: 'Images',    icon: 'camera' },
  gcode:     { label: 'G-code',    icon: 'machine' },
  model:     { label: '3D',        icon: 'material' },
  doc:       { label: 'Docs',      icon: 'files' },
  archive:   { label: 'Archives',  icon: 'folder' },
  other:     { label: 'Other',     icon: 'files' },
};

export const starSVG = (on) =>
  `<svg viewBox="0 0 24 24" class="${on ? 'star-on' : 'star-off'}" stroke="none">
     <path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>
   </svg>`;

export const stars = (n, cls = '') =>
  `<span class="stars ${cls}">${[1, 2, 3, 4, 5].map((i) => starSVG(i <= (n || 0))).join('')}</span>`;

/* ----------------------------------------------------------------- DOM */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Escape anything that came from the database before it meets innerHTML. */
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Format a number without trailing zero noise. */
export function num(v, digits = 2) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return String(Number(n.toFixed(digits)));
}

export function money(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toFixed(2);
}

export function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const thickness = (mm) => (mm ? `${num(mm)}mm` : '');

/* --------------------------------------------------------------- toast */

export function toast(message, kind = 'ok') {
  let host = $('.toasts');
  if (!host) {
    host = el('<div class="toasts"></div>');
    document.body.appendChild(host);
  }
  const icon = kind === 'bad' ? icons.warn : icons.check;
  const node = el(`<div class="toast toast--${kind}">${icon}<span>${esc(message)}</span></div>`);
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 220);
  }, 2600);
}

/* --------------------------------------------------------------- modal */

let openModal = null;

// Escape closes the sheet. Registered once, at the document, so it works no
// matter where focus happens to be inside the form.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openModal) return;
  // Let a native picker or a datalist take the first Escape for itself.
  if (e.target?.tagName === 'SELECT' && e.target.matches(':focus')) return;
  e.preventDefault();
  closeSheet();
});

/**
 * openSheet({ title, body, actions }) — returns the modal element.
 * `actions` is an array of { label, kind, onClick } (return true to keep it open).
 */
export function openSheet({ title, body, actions = [], onClose, wide = false }) {
  closeSheet();

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" ${wide ? 'style="max-width:860px"' : ''}>
        <div class="modal__head">
          <h2>${esc(title)}</h2>
          <button class="btn btn--icon btn--ghost" data-close aria-label="Close">${icons.close}</button>
        </div>
        <div class="modal__body"></div>
      </div>
    </div>`);

  const bodyEl = $('.modal__body', backdrop);
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  if (actions.length) {
    const foot = el('<div class="modal__foot"></div>');
    for (const a of actions) {
      const b = el(
        `<button class="btn ${a.kind ? 'btn--' + a.kind : ''}">${a.icon || ''}<span>${esc(a.label)}</span></button>`
      );
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const keep = await a.onClick?.(backdrop);
          if (!keep) closeSheet();
        } finally {
          b.disabled = false;
        }
      });
      foot.appendChild(b);
    }
    $('.modal', backdrop).appendChild(foot);
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) closeSheet();
  });

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  openModal = { backdrop, onClose };

  // Focus the first real input so a phone keyboard comes straight up.
  requestAnimationFrame(() => {
    const first = backdrop.querySelector('input:not([type=hidden]), textarea, select');
    if (first && window.matchMedia('(min-width: 720px)').matches) first.focus();
  });

  return backdrop;
}

export function closeSheet() {
  if (!openModal) return;
  const { backdrop, onClose } = openModal;
  openModal = null;
  document.body.style.overflow = '';
  backdrop.remove();
  onClose?.();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/** Yes/no confirmation. Resolves to a boolean. */
export function confirmSheet(title, message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    let settled = false;
    openSheet({
      title,
      body: `<p class="muted">${esc(message)}</p>`,
      actions: [
        { label: 'Cancel', onClick: () => { settled = true; resolve(false); } },
        { label: confirmLabel, kind: 'danger', onClick: () => { settled = true; resolve(true); } },
      ],
      onClose: () => { if (!settled) resolve(false); },
    });
  });
}

/* --------------------------------------------------------------- forms */

/** Read a form into a plain object; empty strings become null, numbers become numbers. */
export function readForm(root) {
  const out = {};
  for (const input of $$('[name]', root)) {
    const key = input.name;
    if (input.type === 'checkbox') { out[key] = input.checked ? 1 : 0; continue; }
    let v = input.value;
    if (v === '') { out[key] = null; continue; }
    if (input.dataset.type === 'number' || input.type === 'number') {
      const n = Number(v);
      out[key] = Number.isFinite(n) ? n : null;
    } else {
      out[key] = v;
    }
  }
  return out;
}

export const field = ({ label, name, value, type = 'text', hint, placeholder, step, min, max }) => `
  <div class="field">
    <label class="field__label" for="f_${name}">${esc(label)}</label>
    <input id="f_${name}" name="${name}" type="${type}"
           ${type === 'number' ? 'inputmode="decimal"' : ''}
           ${step ? `step="${step}"` : ''} ${min !== undefined ? `min="${min}"` : ''}
           ${max !== undefined ? `max="${max}"` : ''}
           value="${esc(value ?? '')}" placeholder="${esc(placeholder ?? '')}">
    ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
  </div>`;

export const selectField = ({ label, name, value, options, hint, blank = '—' }) => `
  <div class="field">
    <label class="field__label" for="f_${name}">${esc(label)}</label>
    <select id="f_${name}" name="${name}">
      ${blank !== null ? `<option value="">${esc(blank)}</option>` : ''}
      ${options.map((o) => {
        const val = o.value ?? o;
        const lab = o.label ?? o;
        return `<option value="${esc(val)}" ${String(val) === String(value ?? '') ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}
    </select>
    ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
  </div>`;

export const textareaField = ({ label, name, value, placeholder, rows = 3 }) => `
  <div class="field">
    <label class="field__label" for="f_${name}">${esc(label)}</label>
    <textarea id="f_${name}" name="${name}" rows="${rows}"
              placeholder="${esc(placeholder ?? '')}">${esc(value ?? '')}</textarea>
  </div>`;

export const switchField = ({ label, name, checked }) => `
  <label class="switch">
    <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
    <span class="switch__track"></span>
    <span class="field__label" style="margin:0">${esc(label)}</span>
  </label>`;

/** Interactive 1–5 star picker backed by a hidden input. */
export function ratingField(name, value = 0) {
  const id = 'rate_' + Math.random().toString(36).slice(2, 7);
  return `
    <div class="field">
      <span class="field__label">Result rating</span>
      <div class="stars stars--lg stars--input" id="${id}" data-rating="${value}">
        ${[1, 2, 3, 4, 5].map((i) => `<span data-v="${i}">${starSVG(i <= value)}</span>`).join('')}
      </div>
      <input type="hidden" name="${name}" value="${value}" data-type="number">
    </div>`;
}

export function bindRating(root) {
  for (const holder of $$('.stars--input', root)) {
    const hidden = holder.parentElement.querySelector('input[type=hidden]');
    holder.addEventListener('click', (e) => {
      const t = e.target.closest('[data-v]');
      if (!t) return;
      let v = Number(t.dataset.v);
      if (Number(hidden.value) === v) v = 0; // tap the same star to clear
      hidden.value = v;
      holder.dataset.rating = v;
      [...holder.children].forEach((c, i) => { c.innerHTML = starSVG(i + 1 <= v); });
    });
  }
}

export const OPERATIONS = [
  { value: 'cut', label: 'Cut' },
  { value: 'engrave', label: 'Line Engrave' },
  { value: 'fill', label: 'Fill / Raster Engrave' },
  { value: 'score', label: 'Score' },
  { value: 'photo', label: 'Photo Engrave' },
  { value: 'color_mark', label: 'Color Mark' },
  { value: 'deep_engrave', label: 'Deep Engrave' },
  { value: 'depth_map', label: '3D / Depth Map' },
];

export const OUTCOMES = [
  { value: 'success', label: 'Worked' },
  { value: 'partial', label: 'Almost' },
  { value: 'fail', label: 'Failed' },
];

export const outcomeBadge = (o) => {
  if (!o) return '';
  const map = { success: ['ok', 'Worked'], partial: ['partial', 'Almost'], fail: ['fail', 'Failed'] };
  const [cls, label] = map[o] || ['', o];
  return `<span class="badge badge--${cls}">${esc(label)}</span>`;
};

export const opLabel = (op) =>
  OPERATIONS.find((o) => o.value === op)?.label || op || '—';

/* ------------------------------------------------------------- hazards */

export const HAZARDS = [
  { value: 'caution', label: 'Caution — needs care' },
  { value: 'never',   label: 'Never laser this' },
];

/* Small inline flag for list rows and headers. */
export const hazardBadge = (h) => {
  if (h === 'never')   return `<span class="badge badge--fail">${icons.warn} Do not laser</span>`;
  if (h === 'caution') return `<span class="badge badge--partial">${icons.warn} Caution</span>`;
  return '';
};

/* Full-width warning block. Shown wherever a hazardous material is chosen. */
export const hazardBanner = (m) => {
  if (!m || !m.hazard) return '';
  const never = m.hazard === 'never';
  return `
    <div class="hazard ${never ? 'hazard--never' : 'hazard--caution'}">
      <div class="hazard__head">${icons.warn}
        ${never ? 'Do not put this in a laser' : 'Handle with care'}</div>
      <div class="hazard__body">${esc(m.hazard_note
        || (never ? 'Flagged as unsafe to laser.' : 'Flagged as needing extra care.'))}</div>
    </div>`;
};

export const empty = (icon, title, text, actionHTML = '') => `
  <div class="empty">
    ${icon}
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
    ${actionHTML}
  </div>`;
