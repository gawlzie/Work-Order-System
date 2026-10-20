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

// [part number, part name, categories, brand, uom, stock, min stock, location, unit price (Rp)]
const PARTS = [
  ['VG61000070005', 'Filter Oli Engine (Oil Filter)', ['Engine'], 'Weichai', 'PCS', 24, 10, 'A-01-01', 185000],
  ['VG1560080012', 'Filter Solar (Fuel Filter)', ['Engine'], 'Weichai', 'PCS', 18, 10, 'A-01-02', 165000],
  ['612600081335', 'Water Separator Fuel', ['Engine'], 'Fleetguard', 'PCS', 6, 8, 'A-01-03', 420000],
  ['WG9725190102', 'Filter Udara (Air Filter Element Assy)', ['Engine'], 'Sinotruk', 'PCS', 4, 6, 'A-01-04', 650000],
  ['61500060226', 'V-Belt Fan Engine', ['Engine'], 'Weichai', 'PCS', 5, 4, 'A-02-01', 210000],
  ['VG1500060051', 'Water Pump Assy', ['Engine', 'Cooling System'], 'Weichai', 'PCS', 1, 2, 'A-02-02', 2850000],
  ['612600080611', 'Injector Assy', ['Engine'], 'Bosch', 'PCS', 0, 2, 'A-02-03', 4750000],
  ['OIL-15W40', 'Oli Mesin SAE 15W-40', ['Engine'], 'Shell Rimula R4', 'LTR', 418.5, 200, 'B-01-01', 52000],
  ['OIL-85W90', 'Oli Transmisi SAE 85W-90', ['Transmisi', 'Transmission'], 'Shell Spirax', 'LTR', 209, 100, 'B-01-02', 48000],
  ['WG2203250010', 'Synchronizer Assy Gigi 3-4', ['Transmisi', 'Transmission'], 'Sinotruk', 'PCS', 2, 1, 'C-01-01', 3200000],
  ['WG9725240202', 'Kabel Persneling (Gear Shift Cable)', ['Transmisi', 'Transmission'], 'Sinotruk', 'PCS', 3, 2, 'C-01-02', 780000],
  ['WG9114160020', 'Kampas Kopling (Clutch Disc 430 mm)', ['Kopling', 'Transmission'], 'Sinotruk', 'PCS', 3, 2, 'C-02-01', 2650000],
  ['WG9725160390', 'Clutch Cover Assy (Matahari)', ['Kopling', 'Transmission'], 'Sinotruk', 'PCS', 1, 2, 'C-02-02', 3900000],
  ['WG9100230023', 'Release Bearing Kopling', ['Kopling', 'Transmission'], 'Sinotruk', 'PCS', 4, 2, 'C-02-03', 520000],
  ['WG9200340068', 'Kampas Rem Belakang (Brake Lining)', ['Brake', 'Brake System'], 'Sinotruk', 'SET', 12, 8, 'D-01-01', 950000],
  ['WG9100440027', 'Brake Chamber Belakang', ['Brake', 'Brake System'], 'Sinotruk', 'PCS', 2, 4, 'D-01-02', 1350000],
  ['WG9000360100', 'Slack Adjuster (Stelan Rem)', ['Brake', 'Brake System'], 'Sinotruk', 'PCS', 6, 4, 'D-01-03', 680000],
  ['AZ9719430100', 'Tie Rod Assy', ['Steering', 'Suspension'], 'Sinotruk', 'PCS', 2, 1, 'D-02-01', 1850000],
  ['WG9719470100', 'Power Steering Pump', ['Steering', 'Hydraulic'], 'Sinotruk', 'PCS', 1, 1, 'D-02-02', 3600000],
  ['HOSE-12-2W', 'Selang Hydraulic 1/2" 2-Wire', ['Hose Hydraulic', 'Hydraulic'], 'Parker', 'MTR', 45.5, 20, 'E-01-01', 95000],
  ['HOSE-34-4SH', 'Selang Hydraulic 3/4" 4SH', ['Hose Hydraulic', 'Hydraulic'], 'Parker', 'MTR', 12, 20, 'E-01-02', 185000],
  ['OIL-HYD46', 'Oli Hydraulic ISO VG 46', ['Hose Hydraulic', 'Hydraulic'], 'Shell Tellus S2', 'LTR', 600, 200, 'B-01-03', 38000],
  ['HYVA-SK-191', 'Seal Kit Cylinder Hoist', ['Sistem Pengangkatan', 'Hydraulic'], 'Hyva', 'SET', 2, 2, 'E-02-01', 2400000],
  ['WG9719720001', 'Lampu Utama Kiri (Head Lamp LH)', ['Electric', 'Electrical'], 'Sinotruk', 'PCS', 2, 2, 'F-01-01', 1250000],
  ['BULB-H4-24V', 'Bohlam H4 24V', ['Electric', 'Electrical'], 'Philips', 'PCS', 30, 10, 'F-01-02', 35000],
  ['WG9719580001', 'Relay 24V', ['Electric', 'Electrical'], 'Sinotruk', 'PCS', 15, 10, 'F-01-03', 45000],
  ['BAT-N200', 'Aki 12V 200Ah (Battery)', ['Electric', 'Electrical'], 'GS Astra', 'PCS', 4, 2, 'F-02-01', 3450000],
  ['FREON-R134A', 'Freon AC R134a', ['AC', 'Cooling System'], 'Klea', 'KG', 13.6, 5, 'F-03-01', 180000],
  ['WG1630820020', 'Filter Dryer AC', ['AC', 'Cooling System'], 'Sinotruk', 'PCS', 0, 2, 'F-03-02', 380000],
  ['TYRE-1200R20', 'Ban 12.00R20', ['Tyre'], 'Bridgestone', 'PCS', 8, 6, 'G-01-01', 6850000],
  ['TUBE-1200R20', 'Ban Dalam 12.00R20', ['Tyre'], 'Bridgestone', 'PCS', 10, 6, 'G-01-02', 450000],
  ['OIL-85W140', 'Oli Gardan SAE 85W-140', ['Gardan Tengah-Belakang', 'Transmission'], 'Shell Spirax', 'LTR', 150, 100, 'B-01-04', 55000],
  ['199100520005', 'Bushing Spring Belakang', ['Gardan Tengah-Belakang', 'Suspension'], 'Sinotruk', 'PCS', 8, 6, 'H-01-01', 275000],
  ['AZ9761340006', 'Seal Wheel Hub Belakang', ['Gardan Tengah-Belakang', 'Suspension'], 'Sinotruk', 'PCS', 6, 4, 'H-01-02', 145000],
  ['WG9725520072', 'Shock Absorber Depan', ['Gardan Depan', 'Suspension'], 'Sinotruk', 'PCS', 2, 2, 'H-02-01', 1150000],
  ['GREASE-EP2', 'Grease EP2', ['Lain-Lain', 'Preventive Maintenance'], 'Shell Gadus', 'KG', 34, 20, 'B-02-01', 68000],
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
