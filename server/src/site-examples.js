/**
 * Example sites besides the ones taken over from employees. Only missing site names are inserted (with the next free
 * SITE-nn code); existing sites are never changed or deleted, so running it twice changes nothing.
 *
 * Usage: node src/site-examples.js [--dry-run]   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

// [site name, location]; the company is the one of the existing sites.
const SITES = [
  ['Site Kalimantan - Pit B', 'Kutai Kartanegara, Kalimantan Timur'],
  ['Site Sumatera - Muara Enim', 'Muara Enim, Sumatera Selatan'],
  ['Workshop Balikpapan', 'Balikpapan, Kalimantan Timur'],
];

export function ensureSiteExamples() {
  const company = db.prepare('SELECT company FROM sites ORDER BY id LIMIT 1').get()?.company ?? 'Inline Technology International';
  // An example renamed by hand (same location) counts as present, so it is not added a second time.
  const exists = db.prepare('SELECT 1 FROM sites WHERE site_name = ? COLLATE NOCASE OR location = ? COLLATE NOCASE');
  const codes = new Set(db.prepare('SELECT site_code FROM sites').all().map((r) => r.site_code));
  const ins = db.prepare('INSERT INTO sites (site_code, site_name, company, location, is_active) VALUES (?, ?, ?, ?, 1)');
  let added = 0;
  for (const [name, location] of SITES) {
    if (exists.get(name, location)) continue;
    let n = 1;
    while (codes.has(`SITE-${String(n).padStart(2, '0')}`)) n++;
    const code = `SITE-${String(n).padStart(2, '0')}`;
    codes.add(code);
    ins.run(code, name, company, location);
    added++;
  }
  return added;
}

/**
 * Spreads the example data over the mine sites (the first three sites by id, workshops left out): units sorted by
 * code go about 40 / 30 / 30 % to them, every work order takes its unit's site, and each driver and mechanic moves
 * to the site where most of their work orders are (others, e.g. the admin, stay). Same input, same result.
 */
export function spreadExampleSites() {
  const mines = db.prepare('SELECT site_name FROM sites WHERE is_active = 1 ORDER BY id').all().map((r) => r.site_name).filter((n) => !/workshop/i.test(n)).slice(0, 3);
  if (mines.length < 2) return { units: 0, wos: 0, employees: 0 };
  const units = db.prepare('SELECT id FROM units ORDER BY unit_code').all();
  const cut = [Math.round(units.length * 0.4), Math.round(units.length * 0.7)];
  const setUnit = db.prepare('UPDATE units SET site = ? WHERE id = ?');
  units.forEach((u, i) => setUnit.run(mines[Math.min(mines.length - 1, i < cut[0] ? 0 : i < cut[1] ? 1 : 2)], u.id));
  const wos = db.prepare('UPDATE work_orders SET site = (SELECT u.site FROM units u WHERE u.id = work_orders.unit_id)').run().changes;
  // Drivers and mechanics follow the site where they have most work orders.
  const people = db.prepare(`SELECT p.id, w.site, COUNT(*) AS n FROM employees p
                             JOIN work_orders w ON w.driver_id = p.id OR w.mechanic_id = p.id
                             GROUP BY p.id, w.site ORDER BY p.id, n DESC, w.site`).all();
  const setEmp = db.prepare('UPDATE employees SET site = ? WHERE id = ?');
  const done = new Set();
  for (const r of people) if (!done.has(r.id)) { done.add(r.id); setEmp.run(r.site, r.id); }
  return { units: units.length, wos, employees: done.size };
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-site-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

// --spread also spreads units, work orders and people over the sites; it refuses when units are already on more
// than one site, so assignments made by hand are never overwritten.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const spread = process.argv.includes('--spread');
  if (spread && db.prepare('SELECT COUNT(DISTINCT site) AS n FROM units').get().n > 1) {
    console.log('Units are already on more than one site; nothing spread.');
    process.exit(1);
  }
  if (!dryRun) console.log(`Backup: ${backupDatabase()}`);
  let added = 0;
  let moved = null;
  try {
    tx(() => {
      added = ensureSiteExamples();
      if (spread) moved = spreadExampleSites();
      if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }
  console.log(`${dryRun ? '[dry run, nothing saved] ' : ''}Added ${added} example site(s) of ${SITES.length}.`);
  if (moved) console.log(`Spread over the sites: ${moved.units} unit(s), ${moved.wos} work order(s), ${moved.employees} driver(s) / mechanic(s).`);
}
