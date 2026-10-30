/**
 * Splits year and month in existing work order numbers: WO-BIB-TABUM-202610-047 -> WO-BIB-TABUM-2026-10-047 (also
 * WO-202610-0044 -> WO-2026-10-0044), keeping aliases and sequence. The copies of the number in notifications and in
 * proof file names follow. Numbers already in the new form are left alone, so it can run more than once.
 *
 * Usage: node src/wo-number-format.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

const OLD_TAIL = /-(\d{4})(\d{2})-(\d+)$/;

export function splitWoNumberMonths() {
  const renamed = [];
  tx(() => {
    const setNumber = db.prepare('UPDATE work_orders SET wo_number = ? WHERE wo_uuid = ?');
    const notes = db.prepare('SELECT id, data FROM notifications WHERE wo_uuid = ?');
    const setNote = db.prepare('UPDATE notifications SET data = ? WHERE id = ?');
    const proofs = db.prepare('SELECT id, file_name FROM wo_proofs WHERE wo_uuid = ?');
    const setProof = db.prepare('UPDATE wo_proofs SET file_name = ? WHERE id = ?');
    for (const wo of db.prepare('SELECT wo_uuid, wo_number FROM work_orders ORDER BY wo_number').all()) {
      if (!OLD_TAIL.test(wo.wo_number)) continue;
      const number = wo.wo_number.replace(OLD_TAIL, '-$1-$2-$3');
      setNumber.run(number, wo.wo_uuid);
      for (const n of notes.all(wo.wo_uuid)) {
        const data = JSON.parse(n.data);
        if (data.wo_number === wo.wo_number) setNote.run(JSON.stringify({ ...data, wo_number: number }), n.id);
      }
      for (const p of proofs.all(wo.wo_uuid))
        if (p.file_name.startsWith(`${wo.wo_number}_`)) setProof.run(number + p.file_name.slice(wo.wo_number.length), p.id);
      renamed.push(`${wo.wo_number} -> ${number}`);
    }
  });
  return renamed;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-wo-number-format-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  const renamed = splitWoNumberMonths();
  console.log(`Work orders renumbered: ${renamed.length}${renamed.length ? `\n  ${renamed.join('\n  ')}` : ''}`);
}
