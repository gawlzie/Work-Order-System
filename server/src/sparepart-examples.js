/**
 * Example spare parts for a dump truck workshop. Only part numbers that are missing are inserted; existing parts
 * (and their stock) are never changed or deleted, so running it twice changes nothing. The category is the first of
 * the listed names that exists (the demo and a fresh seed name their categories differently), else none.
 *
 * Usage: node src/sparepart-examples.js [--dry-run]   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

// [part number, part name, categories, brand, uom, stock, min stock, location, unit price (Rp; 0 until real prices are known)]
const PARTS = [
  ['VG61000070005', 'Filter Oli Engine (Oil Filter)', ['Engine'], 'Weichai', 'PCS', 99999, 15, 'A-01-01', 0],
  ['VG1560080012', 'Filter Solar (Fuel Filter)', ['Engine'], 'Weichai', 'PCS', 99999, 15, 'A-01-02', 0],
  ['612600081335', 'Water Separator Fuel', ['Engine'], 'Fleetguard', 'PCS', 99999, 15, 'A-01-03', 0],
  ['WG9725190102', 'Filter Udara (Air Filter Element Assy)', ['Engine'], 'Sinotruk', 'PCS', 99999, 15, 'A-01-04', 0],
  ['61500060226', 'V-Belt Fan Engine', ['Engine'], 'Weichai', 'PCS', 99999, 15, 'A-02-01', 0],
  ['VG1500060051', 'Water Pump Assy', ['Engine', 'Cooling System'], 'Weichai', 'PCS', 99999, 15, 'A-02-02', 0],
  ['612600080611', 'Injector Assy', ['Engine'], 'Bosch', 'PCS', 99999, 15, 'A-02-03', 0],
  ['OIL-15W40', 'Oli Mesin SAE 15W-40', ['Engine'], 'Shell Rimula R4', 'LTR', 99999, 15, 'B-01-01', 0],
  ['OIL-85W90', 'Oli Transmisi SAE 85W-90', ['Transmisi', 'Transmission'], 'Shell Spirax', 'LTR', 99999, 15, 'B-01-02', 0],
  ['WG2203250010', 'Synchronizer Assy Gigi 3-4', ['Transmisi', 'Transmission'], 'Sinotruk', 'PCS', 99999, 15, 'C-01-01', 0],
  ['WG9725240202', 'Kabel Persneling (Gear Shift Cable)', ['Transmisi', 'Transmission'], 'Sinotruk', 'PCS', 99999, 15, 'C-01-02', 0],
  ['WG9114160020', 'Kampas Kopling (Clutch Disc 430 mm)', ['Kopling', 'Transmission'], 'Sinotruk', 'PCS', 99999, 15, 'C-02-01', 0],
  ['WG9725160390', 'Clutch Cover Assy (Matahari)', ['Kopling', 'Transmission'], 'Sinotruk', 'PCS', 99999, 15, 'C-02-02', 0],
  ['WG9100230023', 'Release Bearing Kopling', ['Kopling', 'Transmission'], 'Sinotruk', 'PCS', 99999, 15, 'C-02-03', 0],
  ['WG9200340068', 'Kampas Rem Belakang (Brake Lining)', ['Brake', 'Brake System'], 'Sinotruk', 'SET', 99999, 15, 'D-01-01', 0],
  ['WG9100440027', 'Brake Chamber Belakang', ['Brake', 'Brake System'], 'Sinotruk', 'PCS', 99999, 15, 'D-01-02', 0],
  ['WG9000360100', 'Slack Adjuster (Stelan Rem)', ['Brake', 'Brake System'], 'Sinotruk', 'PCS', 99999, 15, 'D-01-03', 0],
  ['AZ9719430100', 'Tie Rod Assy', ['Steering', 'Suspension'], 'Sinotruk', 'PCS', 99999, 15, 'D-02-01', 0],
  ['WG9719470100', 'Power Steering Pump', ['Steering', 'Hydraulic'], 'Sinotruk', 'PCS', 99999, 15, 'D-02-02', 0],
  ['HOSE-12-2W', 'Selang Hydraulic 1/2" 2-Wire', ['Hose Hydraulic', 'Hydraulic'], 'Parker', 'MTR', 99999, 15, 'E-01-01', 0],
  ['HOSE-34-4SH', 'Selang Hydraulic 3/4" 4SH', ['Hose Hydraulic', 'Hydraulic'], 'Parker', 'MTR', 99999, 15, 'E-01-02', 0],
  ['OIL-HYD46', 'Oli Hydraulic ISO VG 46', ['Hose Hydraulic', 'Hydraulic'], 'Shell Tellus S2', 'LTR', 99999, 15, 'B-01-03', 0],
  ['HYVA-SK-191', 'Seal Kit Cylinder Hoist', ['Sistem Pengangkatan', 'Hydraulic'], 'Hyva', 'SET', 99999, 15, 'E-02-01', 0],
  ['WG9719720001', 'Lampu Utama Kiri (Head Lamp LH)', ['Electric', 'Electrical'], 'Sinotruk', 'PCS', 99999, 15, 'F-01-01', 0],
  ['BULB-H4-24V', 'Bohlam H4 24V', ['Electric', 'Electrical'], 'Philips', 'PCS', 99999, 15, 'F-01-02', 0],
  ['WG9719580001', 'Relay 24V', ['Electric', 'Electrical'], 'Sinotruk', 'PCS', 99999, 15, 'F-01-03', 0],
  ['BAT-N200', 'Aki 12V 200Ah (Battery)', ['Electric', 'Electrical'], 'GS Astra', 'PCS', 99999, 15, 'F-02-01', 0],
  ['FREON-R134A', 'Freon AC R134a', ['AC', 'Cooling System'], 'Klea', 'KG', 99999, 15, 'F-03-01', 0],
  ['WG1630820020', 'Filter Dryer AC', ['AC', 'Cooling System'], 'Sinotruk', 'PCS', 99999, 15, 'F-03-02', 0],
  ['TYRE-1200R20', 'Ban 12.00R20', ['Tyre'], 'Bridgestone', 'PCS', 99999, 15, 'G-01-01', 0],
  ['TUBE-1200R20', 'Ban Dalam 12.00R20', ['Tyre'], 'Bridgestone', 'PCS', 99999, 15, 'G-01-02', 0],
  ['OIL-85W140', 'Oli Gardan SAE 85W-140', ['Gardan Tengah-Belakang', 'Transmission'], 'Shell Spirax', 'LTR', 99999, 15, 'B-01-04', 0],
  ['199100520005', 'Bushing Spring Belakang', ['Gardan Tengah-Belakang', 'Suspension'], 'Sinotruk', 'PCS', 99999, 15, 'H-01-01', 0],
  ['AZ9761340006', 'Seal Wheel Hub Belakang', ['Gardan Tengah-Belakang', 'Suspension'], 'Sinotruk', 'PCS', 99999, 15, 'H-01-02', 0],
  ['WG9725520072', 'Shock Absorber Depan', ['Gardan Depan', 'Suspension'], 'Sinotruk', 'PCS', 99999, 15, 'H-02-01', 0],
  ['GREASE-EP2', 'Grease EP2', ['Lain-Lain', 'Preventive Maintenance'], 'Shell Gadus', 'KG', 99999, 15, 'B-02-01', 0],
];

export function ensureSparepartExamples() {
  const catId = Object.fromEntries(db.prepare('SELECT id, name FROM repair_categories').all().map((r) => [r.name, r.id]));
  const ins = db.prepare(`INSERT INTO spareparts (part_number, part_name, category_id, brand, uom, stock, min_stock, location, unit_price, is_active, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(part_number) DO NOTHING`);
  const now = new Date().toISOString();
  let added = 0;
  for (const [no, name, cats, brand, uom, stock, min, loc, price] of PARTS) {
    const category = cats.map((c) => catId[c]).find(Boolean) ?? null;
    added += Number(ins.run(no, name, category, brand, uom, stock, min, loc, price, now, now).changes);
  }
  return added;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-sparepart-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) console.log(`Backup: ${backupDatabase()}`);
  let added = 0;
  try {
    tx(() => {
      added = ensureSparepartExamples();
      if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }
  console.log(`${dryRun ? '[dry run, nothing saved] ' : ''}Added ${added} example spare part(s) of ${PARTS.length}.`);
}
