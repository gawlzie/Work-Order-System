/**
 * Gives the example sites their aliases (only where still empty) and renumbers work orders that still have the old
 * number (WO-YYYYMM-NNNN) to the alias number of their site (WO-BIB-TABUM-YYYY-MM-NNN), keeping month and sequence.
 * The copies of the number in notifications and in the example proof file names follow. Runs once per work order:
 * numbers already in the new form are left alone.
 *
 * Usage: node src/wo-number-aliases.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';
import { woNumber } from './workorders.js';

/** site_code: [site alias, location alias] */
const SITE_ALIASES = {
  'SITE-01': ['BIB', 'TABUM'], // Site Kalimantan - BIB, Tanah Bumbu
  'SITE-02': ['BKAE', 'TABUM'], // Site Kalimantan - BKAE, Tanah Bumbu
  'SITE-03': ['MEE', 'MENIM'], // Site Sumatera - MEE, Muara Enim
  'SITE-04': ['WS', 'BPN'], // Workshop Balikpapan
};
const OLD_NUMBER = /^WO-(\d{6})-(\d+)$/;

export function applyWoNumberAliases() {
  const sites = [];
  const renamed = [];
  tx(() => {
    const setAlias = db.prepare(`UPDATE sites SET site_alias = COALESCE(site_alias, ?), location_alias = COALESCE(location_alias, ?)
      WHERE site_code = ? AND (site_alias IS NULL OR location_alias IS NULL)`);
    for (const [code, [site, location]] of Object.entries(SITE_ALIASES))
      if (setAlias.run(site, location, code).changes) sites.push(`${code}: ${site} / ${location}`);

    const setNumber = db.prepare('UPDATE work_orders SET wo_number = ? WHERE wo_uuid = ?');
    const notes = db.prepare('SELECT id, data FROM notifications WHERE wo_uuid = ?');
    const setNote = db.prepare('UPDATE notifications SET data = ? WHERE id = ?');
    const proofs = db.prepare('SELECT id, file_name FROM wo_proofs WHERE wo_uuid = ?');
    const setProof = db.prepare('UPDATE wo_proofs SET file_name = ? WHERE id = ?');
    for (const wo of db.prepare('SELECT wo_uuid, wo_number, site FROM work_orders ORDER BY wo_number').all()) {
      const m = OLD_NUMBER.exec(wo.wo_number);
      if (!m) continue;
      const number = woNumber(wo.site, `${m[1].slice(0, 4)}-${m[1].slice(4)}`, Number(m[2]));
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
  return { sites, renamed };
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-wo-number-aliases-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  const { sites, renamed } = applyWoNumberAliases();
  console.log(`Site aliases set: ${sites.length}${sites.length ? `\n  ${sites.join('\n  ')}` : ''}`);
  console.log(`Work orders renumbered: ${renamed.length}${renamed.length ? `\n  ${renamed.join('\n  ')}` : ''}`);
}
