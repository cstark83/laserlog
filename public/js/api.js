/*
 * LaserLog — API client with an offline queue.
 *
 * Online:  straight through to the server.
 * Offline: reads come from the IndexedDB mirror, writes go into a queue and
 *          are replayed against POST /api/sync the moment the network is back.
 *
 * Conflicts are last-write-wins, compared on updated_at. The server tells us
 * when a queued change lost, and we surface that rather than hiding it.
 */

const DB_NAME = 'laserlog';
const DB_VERSION = 1;
const STORE_CACHE = 'cache';
const STORE_QUEUE = 'queue';

let dbp = null;

function idb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'qid', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

const cacheGet = (key) => tx(STORE_CACHE, 'readonly', (s) => s.get(key));
const cacheSet = (key, value) => tx(STORE_CACHE, 'readwrite', (s) => s.put(value, key));

export const queueAll = () => tx(STORE_QUEUE, 'readonly', (s) => s.getAll());
const queuePush = (op) => tx(STORE_QUEUE, 'readwrite', (s) => s.add(op));
const queueDrop = (qid) => tx(STORE_QUEUE, 'readwrite', (s) => s.delete(qid));

/* ------------------------------------------------------------------ net */

export const state = {
  online: navigator.onLine,
  pending: 0,
  lastSync: localStorage.getItem('laserlog.lastSync') || null,
  listeners: new Set(),
};

export function onStateChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

function emit() {
  for (const fn of state.listeners) fn(state);
}

async function refreshPending() {
  try {
    const q = await queueAll();
    state.pending = q.length;
  } catch { state.pending = 0; }
  emit();
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Set by request(): true when the service worker answered from its cache
// rather than the network. A cached 200 must not be read as "we're online".
let lastFromCache = false;

async function request(method, path, body, { raw = false } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof FormData) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(path, opts);
  lastFromCache = res.headers.get('X-LaserLog-Cache') === '1';
  if (res.status === 503 && lastFromCache) {
    throw new TypeError('offline');   // treated as a network failure, not a server error
  }
  if (res.status === 401 || res.status === 428) {
    window.dispatchEvent(new CustomEvent('laserlog:auth', { detail: res.status }));
    throw new ApiError(res.status, await res.json().catch(() => ({})));
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

/* --------------------------------------------------------------- reads */

/** GET with an IndexedDB fallback, so the library is readable on a dead wifi. */
export async function get(path, { cache = true } = {}) {
  try {
    const data = await request('GET', path);
    // A 200 is not proof we're online: it may be the service worker's copy, or
    // the browser's. If the device says there's no network, believe the device.
    const stale = lastFromCache || !navigator.onLine;
    if (cache && !stale) cacheSet(path, { data, at: Date.now() }).catch(() => {});
    if (stale) {
      if (state.online) { state.online = false; emit(); }
    } else if (!state.online) {
      state.online = true; emit();
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;      // real server error — don't mask it
    // Network failure: mark offline whether or not we have a cached copy,
    // so the UI can say the numbers on screen may be stale.
    if (state.online) { state.online = false; emit(); }
    const hit = cache ? await cacheGet(path).catch(() => null) : null;
    if (hit) return hit.data;
    throw e;
  }
}

/* -------------------------------------------------------------- writes */

const PATHS = {
  entries: '/api/entries', materials: '/api/materials', machines: '/api/machines',
  projects: '/api/projects', tests: '/api/tests',
};

function localId() {
  return 'loc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Create or update a row. Returns the saved object — from the server when we
 * could reach it, otherwise an optimistic local copy that syncs later.
 */
export async function save(table, payload) {
  const base = PATHS[table];
  if (!base) throw new Error(`unknown table ${table}`);
  const isUpdate = Boolean(payload.id);
  const path = isUpdate ? `${base}/${payload.id}` : base;

  try {
    // Don't wait on a request the device already knows can't go anywhere.
    if (!navigator.onLine) throw new TypeError('offline');
    const row = await request(isUpdate ? 'PUT' : 'POST', path, payload);
    return row;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Network is down — queue it and hand back something to render.
    const row = { ...payload, id: payload.id || localId(), updated_at: new Date().toISOString() };
    await queuePush({
      table, action: 'upsert', payload: row, client_updated_at: row.updated_at,
    });
    await refreshPending();
    state.online = false; emit();
    return { ...row, _pending: true };
  }
}

export async function remove(table, id) {
  const base = PATHS[table];
  try {
    await request('DELETE', `${base}/${id}`);
    return true;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    await queuePush({ table, action: 'delete', payload: { id } });
    await refreshPending();
    state.online = false; emit();
    return true;
  }
}

export const post = (path, body) => request('POST', path, body);
export const put = (path, body) => request('PUT', path, body);
export const del = (path) => request('DELETE', path);

export async function uploadPhoto(entityType, entityId, file, caption = '') {
  const resized = await shrinkImage(file);
  const fd = new FormData();
  fd.append('photo', resized, file.name.replace(/\.[^.]+$/, '') + '.jpg');
  fd.append('entity_type', entityType);
  fd.append('entity_id', entityId);
  if (caption) fd.append('caption', caption);
  return request('POST', '/api/photos', fd);
}

/**
 * Shrink on the phone before upload. A 12MP camera shot becomes ~200KB,
 * which keeps the server dependency-free (no image library in the container).
 */
export function shrinkImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/* ---------------------------------------------------------------- sync */

let syncing = false;

/** Replay everything queued. Returns { pushed, conflicts }. */
export async function flushQueue() {
  if (syncing) return { pushed: 0, conflicts: 0 };
  const ops = await queueAll();
  if (ops.length === 0) return { pushed: 0, conflicts: 0 };

  syncing = true;
  try {
    const res = await request('POST', '/api/sync', {
      ops: ops.map(({ qid, ...rest }) => rest),
    });
    let conflicts = 0;
    for (let i = 0; i < ops.length; i++) {
      const r = res.results[i];
      if (r && r.status === 'conflict') conflicts++;
      // Drop the op either way: a conflict means the server holds a newer
      // value, and replaying it forever would never resolve.
      await queueDrop(ops[i].qid);
    }
    state.lastSync = res.server_time;
    localStorage.setItem('laserlog.lastSync', res.server_time);
    state.online = true;
    await refreshPending();
    return { pushed: ops.length, conflicts };
  } catch {
    state.online = false;
    emit();
    return { pushed: 0, conflicts: 0, failed: true };
  } finally {
    syncing = false;
  }
}

/** Warm the offline mirror so the phone has the whole library to read. */
export async function primeCache() {
  // Everything you might want to read standing at the machine with no signal.
  // The file catalogue is deliberately not here — it can be tens of thousands
  // of rows and is the one thing that is useless without the files themselves.
  const paths = ['/api/stats', '/api/entries', '/api/materials', '/api/machines',
                 '/api/projects', '/api/tests', '/api/tags',
                 '/api/finishes', '/api/maintenance', '/api/supplies', '/api/products'];
  await Promise.all(paths.map((p) => get(p).catch(() => null)));
  state.lastSync = new Date().toISOString();
  localStorage.setItem('laserlog.lastSync', state.lastSync);
  emit();
}

window.addEventListener('online', async () => {
  state.online = true; emit();
  const r = await flushQueue();
  if (r.pushed) {
    window.dispatchEvent(new CustomEvent('laserlog:synced', { detail: r }));
  }
});

window.addEventListener('offline', () => { state.online = false; emit(); });

refreshPending();

export default { get, save, remove, post, put, del, uploadPhoto, flushQueue, primeCache, state };
