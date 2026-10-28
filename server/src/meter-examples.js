/**
 * Example HM (hour meter) and KM (odometer) readings for work orders that have none. Per unit the readings rise
 * with time between its work orders (a dump truck runs roughly 8-14 hours and 120-260 km a day), so they follow
 * the "never lower than the last reading" rule. Readings already entered are kept and used as the baseline for
 * the next one. Nothing is deleted; running it twice changes nothing.
 *
 * Usage: node src/meter-examples.js [--dry-run]   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

const DAY = 86400000;

// Same seed gives the same readings, so a fresh demo always looks alike.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function fillMeterReadings() {
  const wos = db.prepare('SELECT wo_uuid, unit_id, hm, km, created_at FROM work_orders ORDER BY unit_id, created_at').all();
  const update = db.prepare('UPDATE work_orders SET hm = COALESCE(hm, ?), km = COALESCE(km, ?) WHERE wo_uuid = ?');
  let filled = 0;
  let unit = null;
  let rand;
  let hm;
  let km;
  let at;
  for (const wo of wos) {
    if (wo.unit_id !== unit) {
      unit = wo.unit_id;
      rand = rng(unit * 7919);
      // Starting point: a unit that has been in service for a few years.
      hm = Math.round((3000 + rand() * 12000) * 10) / 10;
      km = Math.round(hm * (18 + rand() * 6));
      at = null;
    } else {
      const days = Math.max(0.5, (Date.parse(wo.created_at) - at) / DAY);
      hm = Math.round((hm + days * (8 + rand() * 6)) * 10) / 10;
      km = Math.round(km + days * (120 + rand() * 140));
    }
    if (wo.hm != null) hm = Math.max(hm, wo.hm);
    if (wo.km != null) km = Math.max(km, wo.km);
    at = Date.parse(wo.created_at);
    if (wo.hm == null || wo.km == null) {
      update.run(hm, km, wo.wo_uuid);
      filled++;
    }
  }
  return filled;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-meter-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) console.log(`Backup: ${backupDatabase()}`);
  let filled = 0;
  try {
    tx(() => {
      filled = fillMeterReadings();
      if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }
  console.log(`${dryRun ? '[dry run, nothing saved] ' : ''}Added HM/KM readings to ${filled} work order(s).`);
}
