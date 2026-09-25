/**
 * LaserLog — authentication
 *
 * Two modes, chosen with the AUTH env var:
 *   AUTH=on   (default) — first run creates an admin account, JWT cookie after that
 *   AUTH=off            — wide open, for a LAN-only / reverse-proxy-protected install
 *
 * The signing secret is generated once and kept in the meta table, so tokens
 * survive container restarts without anyone having to manage a secret by hand.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { db, getMeta, setMeta, newId, nowISO } from './db.js';

export const AUTH_ENABLED = String(process.env.AUTH ?? 'on').toLowerCase() !== 'off';
const COOKIE = 'laserlog_token';
const MAX_AGE_DAYS = 365;

function secret() {
  let s = getMeta('jwt_secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
    setMeta('jwt_secret', s);
  }
  return s;
}

export function userCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
}

export function needsSetup() {
  return AUTH_ENABLED && userCount() === 0;
}

export function createUser(username, password, role = 'admin') {
  const uname = String(username || '').trim();
  if (uname.length < 2) throw new Error('Username must be at least 2 characters.');
  if (String(password || '').length < 6) throw new Error('Password must be at least 6 characters.');
  const ts = nowISO();
  const hash = bcrypt.hashSync(password, 10);
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?,?,?,?,?,?)`
  ).run(id, uname, hash, role, ts, ts);
  return { id, username: uname, role };
}

export function verifyLogin(username, password) {
  const u = db
    .prepare(`SELECT * FROM users WHERE username=? COLLATE NOCASE`)
    .get(String(username || '').trim());
  if (!u) return null;
  if (!bcrypt.compareSync(String(password || ''), u.password_hash)) return null;
  return { id: u.id, username: u.username, role: u.role };
}

export function issueToken(user) {
  return jwt.sign({ sub: user.id, u: user.username, r: user.role }, secret(), {
    expiresIn: `${MAX_AGE_DAYS}d`,
  });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    // Not forcing `secure` — plenty of Unraid installs are plain http on the LAN.
    // Behind a TLS reverse proxy the cookie still works.
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

function readToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return req.cookies?.[COOKIE] || null;
}

/** Attaches req.user when a valid token is present. Never rejects. */
export function attachUser(req, _res, next) {
  if (!AUTH_ENABLED) {
    req.user = { id: 'local', username: 'local', role: 'admin' };
    return next();
  }
  const token = readToken(req);
  if (token) {
    try {
      const p = jwt.verify(token, secret());
      req.user = { id: p.sub, username: p.u, role: p.r };
    } catch {
      /* expired or tampered — treated as anonymous */
    }
  }
  next();
}

/** Guards the API. */
export function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (req.user) return next();
  if (needsSetup()) {
    return res.status(428).json({ error: 'setup_required' });
  }
  return res.status(401).json({ error: 'unauthorized' });
}
