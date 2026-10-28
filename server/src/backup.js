/**
 * Backs up the WOS data while the server runs: a consistent copy of the database (VACUUM INTO), secret.key and the
 * uploaded proofs, into <dest>/<YYYY-MM-DD_HHmm>/. Sets older than --keep days are removed; --mirror copies the new
 * set to a second place (another drive, a synced folder or a NAS). Never writes to the live database.
 *
 * Usage: node src/backup.js --dest <dir> [--mirror <dir>] [--keep 14]
 * The database is WOS_DB, or data/wos.db next to this folder.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WOS_DB || join(here, '..', 'data', 'wos.db');
const SET = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** Writes one backup set into dest and returns its folder. */
export function backup(dest) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const dir = join(resolve(dest), name);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });

  const live = new DatabaseSync(DB_PATH, { readOnly: true });
  live.exec('PRAGMA busy_timeout = 10000');
  live.exec(`VACUUM INTO '${join(dir, 'wos.db').replace(/'/g, "''")}'`);
  live.close();
  const copy = new DatabaseSync(join(dir, 'wos.db'), { readOnly: true });
  const ok = copy.prepare('PRAGMA integrity_check').get().integrity_check;
  const wos = copy.prepare('SELECT COUNT(*) n FROM work_orders').get().n;
  copy.close();
  if (ok !== 'ok') throw new Error(`integrity check of the copy failed: ${ok}`);

  const data = dirname(DB_PATH);
  if (existsSync(join(data, 'secret.key'))) cpSync(join(data, 'secret.key'), join(dir, 'secret.key'));
  if (existsSync(join(data, 'uploads'))) cpSync(join(data, 'uploads'), join(dir, 'uploads'), { recursive: true });
  return { dir, wos };
}

/** Removes backup sets older than keepDays (only folders named like a set). */
export function prune(dest, keepDays) {
  const limit = Date.now() - keepDays * 86_400_000;
  const removed = [];
  for (const name of existsSync(dest) ? readdirSync(dest) : []) {
    if (!SET.test(name)) continue;
    const [d, t] = name.split('_');
    const at = new Date(`${d}T${t.slice(0, 2)}:${t.slice(2)}:00`).getTime();
    if (at < limit) {
      rmSync(join(dest, name), { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${resolve(process.argv[1]).replace(/\\/g, '/')}`).href) {
  const dest = arg('dest');
  const mirror = arg('mirror');
  const keep = Number(arg('keep', 14));
  if (!dest) {
    console.error('Usage: node src/backup.js --dest <dir> [--mirror <dir>] [--keep 14]');
    process.exit(2);
  }
  try {
    const { dir, wos } = backup(dest);
    const removed = prune(dest, keep);
    let line = `${new Date().toISOString()} OK ${dir} (${wos} work orders)${removed.length ? `; removed ${removed.join(', ')}` : ''}`;
    if (mirror) {
      const target = join(resolve(mirror), dir.split(/[\\/]/).pop());
      mkdirSync(resolve(mirror), { recursive: true });
      cpSync(dir, target, { recursive: true });
      const removedMirror = prune(resolve(mirror), keep);
      line += `; mirror ${target}${removedMirror.length ? ` (removed ${removedMirror.join(', ')})` : ''}`;
    }
    console.log(line);
  } catch (err) {
    console.error(`${new Date().toISOString()} FAILED ${err.message}`);
    process.exit(1);
  }
}
