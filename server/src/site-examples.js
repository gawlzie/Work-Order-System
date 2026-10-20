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
  const exists = db.prepare('SELECT 1 FROM sites WHERE site_name = ? COLLATE NOCASE');
  const codes = new Set(db.prepare('SELECT site_code FROM sites').all().map((r) => r.site_code));
  const ins = db.prepare('INSERT INTO sites (site_code, site_name, company, location, is_active) VALUES (?, ?, ?, ?, 1)');
  let added = 0;
  for (const [name, location] of SITES) {
    if (exists.get(name)) continue;
    let n = 1;
    while (codes.has(`SITE-${String(n).padStart(2, '0')}`)) n++;
    const code = `SITE-${String(n).padStart(2, '0')}`;
    codes.add(code);
    ins.run(code, name, company, location);
    added++;
  }
  return added;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-site-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) console.log(`Backup: ${backupDatabase()}`);
  let added = 0;
  try {
    tx(() => {
      added = ensureSiteExamples();
      if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }
  console.log(`${dryRun ? '[dry run, nothing saved] ' : ''}Added ${added} example site(s) of ${SITES.length}.`);
}
