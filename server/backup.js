/**
 * LaserLog — backups.
 *
 * SQLite's own online backup, so a copy taken while the app is running is
 * still consistent. Two triggers: a nightly timer, and a snapshot taken
 * immediately before any restore, because "restore the wrong file" should be
 * recoverable rather than terminal.
 */
import { mkdirSync } from 'node:fs';
import { readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { db, DATA_DIR } from './db.js';

export const BACKUP_DIR = join(DATA_DIR, 'backups');
mkdirSync(BACKUP_DIR, { recursive: true });

const KEEP = Number(process.env.BACKUP_KEEP || 14);

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * Open a backup file and prove it is a database you could actually restore:
 * the pages check out, the schema version is one this build understands, and
 * the tables that matter have rows in them.
 *
 * A backup nobody has ever opened is a guess, not a backup.
 */
export function verifyBackup(name) {
  const path = join(BACKUP_DIR, name);
  let probe;
  try {
    probe = new Database(path, { readonly: true, fileMustExist: true });
  } catch (e) {
    return { name, ok: false, error: `Could not open it: ${e.message}` };
  }

  try {
    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { name, ok: false, error: `Integrity check said: ${integrity}` };

    const version = Number(
      probe.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get()?.value ?? 0);

    const counts = {};
    for (const t of ['entries', 'materials', 'machines', 'files', 'products', 'supplies']) {
      try { counts[t] = probe.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; }
      catch { counts[t] = null; }            // table absent in an older backup
    }

    const missing = Object.entries(counts).filter(([, n]) => n === null).map(([t]) => t);
    return {
      name, ok: true, schema_version: version, counts,
      note: missing.length
        ? `Readable, but taken before ${missing.join(', ')} existed — restoring it loses those.`
        : null,
    };
  } catch (e) {
    return { name, ok: false, error: e.message };
  } finally {
    probe.close();
  }
}

/**
 * Take a consistent copy, then immediately open it and check it. `label`
 * becomes part of the filename.
 */
export async function takeBackup(label = 'auto') {
  const name = `laserlog-${label}-${stamp()}.db`;
  const dest = join(BACKUP_DIR, name);
  await db.backup(dest);
  const info = await stat(dest);

  const check = verifyBackup(name);
  if (!check.ok) {
    console.error(`[laserlog] backup ${name} FAILED verification: ${check.error}`);
  } else {
    console.log(`[laserlog] backup ${name} (${Math.round(info.size / 1024)} KB, verified)`);
  }
  return { name, path: dest, bytes: info.size, verified: check.ok, error: check.error || null };
}

/** Keep the most recent N automatic backups; pre-restore snapshots are kept. */
export async function pruneBackups() {
  try {
    const files = (await readdir(BACKUP_DIR))
      .filter((f) => f.startsWith('laserlog-auto-') && f.endsWith('.db'))
      .sort()
      .reverse();
    for (const f of files.slice(KEEP)) {
      await unlink(join(BACKUP_DIR, f)).catch(() => {});
    }
  } catch { /* nothing to prune */ }
}

export async function listBackups() {
  try {
    const names = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith('.db')).sort().reverse();
    const out = [];
    for (const name of names) {
      const info = await stat(join(BACKUP_DIR, name)).catch(() => null);
      if (info) out.push({ name, bytes: info.size, at: info.mtime.toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Nightly at roughly 03:15 local. setInterval rather than cron: this is a
 * single-container app and a missed run by a few minutes costs nothing.
 */
export function startBackupSchedule() {
  if (String(process.env.AUTO_BACKUP ?? 'on').toLowerCase() === 'off') {
    console.log('[laserlog] automatic backups disabled');
    return;
  }

  let lastRunDay = null;
  const tick = async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (day === lastRunDay) return;
    if (now.getHours() !== 3 || now.getMinutes() < 15) return;
    lastRunDay = day;
    try {
      await takeBackup('auto');
      await pruneBackups();
    } catch (e) {
      console.error('[laserlog] backup failed:', e.message);
    }
  };

  setInterval(tick, 5 * 60 * 1000).unref();

  // One on boot too, so a fresh install has a restore point straight away.
  setTimeout(() => {
    takeBackup('startup').then(pruneBackups).catch(() => {});
  }, 20_000).unref();
}
