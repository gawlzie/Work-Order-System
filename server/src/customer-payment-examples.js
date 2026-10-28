/**
 * Fills customer type and payment on the example work orders raised before they were asked (only where still empty;
 * nothing else is changed). Per unit, so a unit's work orders agree: Motorsights / Shacman units are the company's own
 * (Internal), the customer fleets (Hino, Mercedes-Benz, Scania, Volvo) are Internal or External unit by unit.
 * Payment follows: PDI free, warranty claimed from the maker, internal work free, external work paid by the customer,
 * and some repairs paid another way (insurance, service contract, deposit) as "Others".
 *
 * Usage: node src/customer-payment-examples.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

const OWN_BRANDS = ['motorsights', 'shacman'];
const REPAIR_OTHERS = [
  'Klaim asuransi unit (polis armada customer)',
  'Termasuk kontrak servis tahunan customer',
  'Dipotong dari deposit servis customer',
];

export function fillCustomerPayment() {
  const rows = db.prepare(`SELECT w.wo_uuid, w.wo_number, w.maintenance_type, u.id AS unit_id, u.brand
    FROM work_orders w JOIN units u ON u.id = w.unit_id WHERE w.customer_type IS NULL ORDER BY w.wo_number`).all();
  const update = db.prepare('UPDATE work_orders SET customer_type = ?, payment_type = ?, payment_other = ? WHERE wo_uuid = ? AND customer_type IS NULL');
  const tally = {};
  let repairNo = 0;
  tx(() => {
    for (const r of rows) {
      const own = OWN_BRANDS.includes(String(r.brand).toLowerCase());
      const customer = own || r.unit_id % 2 === 0 ? 'INTERNAL' : 'EXTERNAL';
      let payment = customer === 'INTERNAL' ? 'FREE' : 'CUSTOMER_PAID';
      let other = null;
      if (r.maintenance_type === 'PDI') payment = 'FREE';
      else if (r.maintenance_type === 'WARRANTY') [payment, other] = ['OTHERS', `Klaim garansi ke pabrikan (${r.brand})`];
      else if (r.maintenance_type === 'OTHERS') [payment, other] = ['OTHERS', 'Biaya modifikasi dibebankan ke anggaran proyek'];
      else if (r.maintenance_type === 'REPAIR' && customer === 'EXTERNAL' && ++repairNo % 5 === 0)
        [payment, other] = ['OTHERS', REPAIR_OTHERS[(repairNo / 5 - 1) % REPAIR_OTHERS.length]];
      update.run(customer, payment, other, r.wo_uuid);
      const key = `${customer} / ${payment}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
  });
  return { filled: rows.length, tally };
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-customer-payment-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  const { filled, tally } = fillCustomerPayment();
  console.log(`Work orders filled: ${filled}`);
  for (const [k, n] of Object.entries(tally)) console.log(`  ${k}: ${n}`);
}
