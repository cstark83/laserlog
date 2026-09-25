/**
 * LaserLog — self-hosted laser settings library.
 * Express + SQLite, serving a PWA that installs on Android and iOS.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, UPLOAD_DIR, DATA_DIR, getMeta, setMeta, upsert, newId, nowISO } from './db.js';
import {
  AUTH_ENABLED, attachUser, requireAuth, needsSetup, createUser,
  verifyLogin, issueToken, setAuthCookie, clearAuthCookie, userCount,
} from './auth.js';
import { api } from './routes/index.js';
import { MACHINE_FIELDS, MATERIAL_FIELDS } from './routes/crud.js';
import { startBackupSchedule } from './backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8080);
const APP_VERSION = '1.2.0';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

/* ----------------------------- health ----------------------------- */

const health = (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({
      ok: true,
      time: nowISO(),
      version: APP_VERSION,
      schema_version: Number(getMeta('schema_version') ?? 0),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

// /healthz for Docker's HEALTHCHECK, /api/health for the About panel.
app.get('/healthz', health);
app.get('/api/health', health);

/* ------------------------------ auth ------------------------------ */

/**
 * Throttle password guessing. Nothing fancy and nothing persisted — this is a
 * box on your own LAN — but if it ever ends up behind a port forward, an
 * unlimited login endpoint is the thing that gets found first.
 *
 * Ten tries per IP in fifteen minutes, then a lockout that clears itself.
 * A correct password clears the count immediately.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;
const attempts = new Map();                 // ip -> { n, first }

function loginAllowed(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) return { ok: true };
  if (rec.n < LOGIN_MAX) return { ok: true };
  return { ok: false, retryAfter: Math.ceil((rec.first + LOGIN_WINDOW_MS - now) / 1000) };
}

function loginFailed(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) attempts.set(ip, { n: 1, first: now });
  else rec.n++;

  // Keep the map from growing without bound on a long-running container.
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now - v.first > LOGIN_WINDOW_MS) attempts.delete(k);
  }
}

app.get('/api/auth/state', (req, res) => {
  res.json({
    auth_enabled: AUTH_ENABLED,
    setup_required: needsSetup(),
    user: req.user ? { username: req.user.username, role: req.user.role } : null,
  });
});

app.post('/api/auth/setup', (req, res) => {
  if (!AUTH_ENABLED) return res.status(400).json({ error: 'auth_disabled' });
  if (userCount() > 0) return res.status(409).json({ error: 'already_setup' });
  try {
    const user = createUser(req.body?.username, req.body?.password);
    setAuthCookie(res, issueToken(user));
    res.status(201).json({ ok: true, user: { username: user.username, role: user.role } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });

  const ip = req.ip || 'unknown';
  const gate = loginAllowed(ip);
  if (!gate.ok) {
    res.set('Retry-After', String(gate.retryAfter));
    return res.status(429).json({
      error: 'too_many_attempts',
      retry_after_s: gate.retryAfter,
      message: `Too many failed logins. Try again in ${Math.ceil(gate.retryAfter / 60)} minutes.`,
    });
  }

  const user = verifyLogin(req.body?.username, req.body?.password);
  if (!user) {
    loginFailed(ip);
    return res.status(401).json({ error: 'bad_credentials' });
  }
  attempts.delete(ip);
  setAuthCookie(res, issueToken(user));
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/** Long-lived bearer token, for pinning a phone that lives off the LAN. */
app.post('/api/auth/token', requireAuth, (req, res) => {
  res.json({ token: issueToken(req.user) });
});

/* ------------------------- starter library ------------------------ */

const STARTER_MACHINES = [
  { name: 'AtomStack X40 Max', kind: 'diode', source_type: 'diode', role: 'mixed',
    power_w: 40, wavelength_nm: 450, bed_w_mm: 800, bed_h_mm: 400,
    max_speed: 36000, controller: 'GRBL (32-bit)', speed_unit: 'mm/min',
    spot_size_mm: '0.1 × 0.1', has_gas_assist: 0, color: '#7c5cff',
    eyewear_od: 'OD5+ @ 450nm',
    eyewear_note: 'Blue-diode glasses only. Your 1064nm fiber eyewear does NOT protect against this machine.',
    notes: '40W optical from 8 × 6W diode couplings, 210W input class. F30 Plus air assist, '
         + 'tool-free focus. Single pass: ~18mm basswood, 9mm MDF, 0.1mm stainless.' },
  { name: 'DeBin DBF-100 MOPA', kind: 'fiber', source_type: 'mopa', role: 'marking',
    power_w: 100, wavelength_nm: 1064, speed_unit: 'mm/s', max_speed: 7000,
    source_brand: 'JPT / Raycus', freq_min_khz: 1, freq_max_khz: 4000,
    lens_mm: '75, 150, 300',
    spot_size_mm: 'M² ≤ 1.5, min line 0.01', has_gas_assist: 0, color: '#f59e0b',
    eyewear_od: 'OD5+ @ 1064nm',
    eyewear_note: '1064nm IR glasses only. The beam is INVISIBLE — there is no blink reflex. '
                + 'Blue-diode eyewear does nothing here.',
    notes: 'Marking / annealing / deep engraving galvo. MOPA pulse-width control is what makes '
         + 'colour marking on stainless possible. Confirm your source\'s available pulse widths '
         + 'in its manual — they are a fixed list, not a free range.' },
];

// `hazard: 'never'` materials are ones that should not go in a laser at all.
const STARTER_MATERIALS = [
  { name: 'Baltic birch plywood', category: 'Plywood', thickness_mm: 3, color: 'Natural' },
  { name: 'Baltic birch plywood', category: 'Plywood', thickness_mm: 6, color: 'Natural' },
  { name: 'Basswood', category: 'Hardwood', thickness_mm: 3, color: 'Natural' },
  { name: 'Cast acrylic', category: 'Acrylic', thickness_mm: 3, color: 'Clear' },
  { name: 'Anodized aluminium', category: 'Metal', thickness_mm: 1, color: 'Black',
    notes: 'Diode marks the coating white. Fiber anneals or ablates it.' },
  { name: 'Stainless 304', category: 'Metal', grade: '304', thickness_mm: 1, color: 'Brushed',
    notes: 'The MOPA colour-marking material. Surface prep and focus change the colour.' },
  { name: 'Veg-tan leather', category: 'Leather', thickness_mm: 2, color: 'Natural' },
  { name: 'Slate coaster', category: 'Stone', thickness_mm: 6, color: 'Black' },
  { name: 'Cardboard', category: 'Paper', thickness_mm: 3, color: 'Brown' },

  { name: 'PVC / vinyl', category: 'Plastic', hazard: 'never',
    hazard_note: 'Releases chlorine gas when lasered. Corrodes the machine and is harmful to '
               + 'breathe. This includes most faux leather and "vinyl" sign stock.' },
  { name: 'Polycarbonate (Lexan)', category: 'Plastic', hazard: 'never',
    hazard_note: 'Absorbs badly, catches fire and yellows instead of cutting. Not the same as acrylic.' },
  { name: 'ABS', category: 'Plastic', hazard: 'never',
    hazard_note: 'Melts rather than cuts and gives off cyanide compounds.' },
  { name: 'Fiberglass / carbon fibre', category: 'Composite', hazard: 'never',
    hazard_note: 'Epoxy binder gives off toxic fumes; glass dust is an inhalation hazard.' },
  { name: 'Copper / brass (bare)', category: 'Metal', hazard: 'caution', reflective: 1,
    hazard_note: 'Highly reflective at 1064nm. Back-reflection can damage a fiber source — '
               + 'check your machine tolerates it before marking bare copper.' },
];

app.post('/api/seed', requireAuth, (_req, res) => {
  if (getMeta('seeded') === '1') return res.status(409).json({ error: 'already_seeded' });
  const run = db.transaction(() => {
    for (const m of STARTER_MACHINES) upsert('machines', MACHINE_FIELDS, m);
    for (const m of STARTER_MATERIALS) upsert('materials', MATERIAL_FIELDS, m);
    setMeta('seeded', '1');
  });
  run();
  res.json({ ok: true, machines: STARTER_MACHINES.length, materials: STARTER_MATERIALS.length });
});

/* ------------------------------ api ------------------------------- */

// API responses must never sit in the browser's HTTP cache: when the device
// goes offline we need fetch() to actually fail so the service worker serves
// its own copy and flags it as stale. A silently-cached 200 would make the
// app believe it is online and show old numbers as current.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  next();
});

app.use('/api', requireAuth, api);

/* ---------------------------- uploads ----------------------------- */

app.use(
  '/uploads',
  requireAuth,
  express.static(UPLOAD_DIR, { maxAge: '30d', fallthrough: false })
);

/* ----------------------------- static ----------------------------- */

// The service worker must never be cached, or phones get stuck on an old build.
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(PUBLIC_DIR, 'sw.js'));
});

app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: 'index.html' }));

// SPA fallback — anything not an API route renders the shell.
app.get(/^\/(?!api|uploads|healthz).*/, (_req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

/* --------------------------- error handler ------------------------ */

app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error('[laserlog]', err);
  res.status(status).json({ error: err.message || 'server_error' });
});

/* ------------------------------ boot ------------------------------ */

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[laserlog] listening on :${PORT}`);
  console.log(`[laserlog] data dir   ${DATA_DIR}`);
  console.log(`[laserlog] auth       ${AUTH_ENABLED ? 'on' : 'OFF (open access)'}`);
  if (needsSetup()) console.log('[laserlog] first run — create your account in the browser');
  startBackupSchedule();
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[laserlog] ${sig} — closing`);
    server.close(() => { try { db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

/*
 * Last line of defence, for anything that escapes the route wrappers — the
 * backup scheduler, a stream error, something in a library.
 *
 * A rejection means one operation failed; log it and carry on. An uncaught
 * exception is different: the process may be in a state we can no longer
 * reason about, so close the database cleanly and let the container's restart
 * policy bring up a fresh one. Soldiering on with a half-broken process is the
 * worse of the two failures.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[laserlog] unhandled rejection —', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[laserlog] uncaught exception — restarting —', err);
  try { db.close(); } catch { /* already gone */ }
  process.exit(1);
});
