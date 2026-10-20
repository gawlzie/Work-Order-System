/**
 * Example spare parts on the Step 7 job code entries: one or two parts of the work order's repair category per entry,
 * with a quantity that fits the unit (e.g. 1-4 PCS, 5-20 LTR). Entries in a category without spare parts are skipped.
 * Same input, same result; refuses when any spare part line exists already, so lines added by hand are never touched.
 *
 * Usage: node src/jobpart-examples.js [--dry-run]   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

// Quantity per unit, picked by the entry number so it is the same every run.
const QTY = { LTR: [5, 8, 12.5, 20], KG: [1, 2, 3.5], MTR: [2, 3.5, 5], SET: [1], PCS: [1, 2, 4], UNIT: [1] };

export function ensureJobPartExamples() {
  if (db.prepare('SELECT 1 FROM wo_job_parts LIMIT 1').get()) return 0;
  const entries = db.prepare(`SELECT x.id, x.added_by, x.added_at, x.finished_at, w.category_id FROM wo_job_codes x
                              JOIN work_orders w ON w.wo_uuid = x.wo_uuid ORDER BY x.id`).all();
  const partsOf = db.prepare('SELECT id, uom FROM spareparts WHERE category_id = ? AND is_active = 1 ORDER BY part_number');
  const ins = db.prepare('INSERT INTO wo_job_parts (wo_job_code_id, sparepart_id, qty, uom, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)');
  let added = 0;
  for (const e of entries) {
    const parts = e.category_id ? partsOf.all(e.category_id) : [];
    if (!parts.length) continue;
    const picks = [parts[e.id % parts.length], parts.length > 1 && e.id % 2 === 0 ? parts[(e.id + 1) % parts.length] : null].filter(Boolean);
    for (const [i, p] of picks.entries()) {
      const options = QTY[p.uom] ?? [1];
      ins.run(e.id, p.id, options[(e.id + i) % options.length], p.uom, e.added_by, e.finished_at ?? e.added_at);
      added++;
    }
  }
  return added;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-jobpart-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  if (db.prepare('SELECT 1 FROM wo_job_parts LIMIT 1').get()) {
    console.log('Spare part lines exist already; nothing added.');
    process.exit(1);
  }
  if (!dryRun) console.log(`Backup: ${backupDatabase()}`);
  let added = 0;
  try {
    tx(() => {
      added = ensureJobPartExamples();
      if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }
  console.log(`${dryRun ? '[dry run, nothing saved] ' : ''}Added ${added} example spare part line(s).`);
}
