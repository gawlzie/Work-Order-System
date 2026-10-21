/**
 * Example Shacman (X3000, F3000) and Motorsights (MS600, MS700) dump trucks with work orders in every state.
 * Everything goes through the normal work order functions with times in the past (as the offline sync does), so the
 * same rules apply: steps in order, job codes on Step 7 with their timers and spare parts, HM / KM never going down.
 * Old example events send no notifications. Refuses to run when units of these brands exist already.
 *
 * Usage: node src/unit-examples.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, loadUser } from './db.js';
import { createUnit } from './master.js';
import {
  addWoJobCode, addWoJobPart, APPROVAL, CHANNEL, createWorkOrder, progressStep, setApproval, setWoCategory, timeWoJobCode,
} from './workorders.js';

// [unit code, unit number, brand, model, serial, year, site index (sites by id), start HM, start KM]
const UNITS = [
  ['DT-021', 'DT 121', 'Shacman', 'X3000', 'SHX230121', 2023, 0, 4210.5, 61240],
  ['DT-022', 'DT 122', 'Shacman', 'X3000', 'SHX240122', 2024, 1, 2380.2, 33915],
  ['DT-023', 'DT 123', 'Shacman', 'F3000', 'SHF220123', 2022, 2, 6125.8, 98410],
  ['DT-024', 'DT 124', 'Shacman', 'F3000', 'SHF230124', 2023, 0, 3870.4, 55620],
  ['DT-025', 'DT 125', 'Motorsights', 'MS600', 'MS6250125', 2025, 3, 12.5, 85],
  ['DT-026', 'DT 126', 'Motorsights', 'MS600', 'MS6250126', 2025, 1, 418.7, 6320],
  ['DT-027', 'DT 127', 'Motorsights', 'MS700', 'MS7250127', 2025, 2, 8.2, 60],
  ['DT-028', 'DT 128', 'Motorsights', 'MS700', 'MS7240128', 2024, 0, 1520.3, 22140],
];

/**
 * Work orders: unit index, hours ago, type (+ Others text), problem, steps finished (9 = all), the running step, Step 7
 * (category, job codes [code, parts [[part number, qty]], running?]), approval ('wait' = not yet), extra HM / KM.
 */
const WOS = [
  { unit: 0, hoursAgo: 216, type: 'PREVENTIVE', problem: 'Servis berkala PM 250 jam.', done: 9, cat: 'Lain-Lain',
    jobs: [['DTMT-04', [['GREASE-EP2', 2], ['OIL-15W40', 18], ['VG61000070005', 1], ['VG1560080012', 1]]]], remarks: 'Unit siap operasi setelah PM.' },
  { unit: 0, hoursAgo: 6, type: 'REPAIR', problem: 'Mesin susah hidup di pagi hari, keluar asap putih.', done: 6, running: 7, cat: 'Engine',
    jobs: [['DTFDJ-52', [['VG1560080012', 1], ['612600081335', 1]], true]], hm: 252, km: 3110 },
  { unit: 1, hoursAgo: 120, type: 'REPAIR', problem: 'Rem belakang berbunyi dan kurang pakem saat muatan penuh.', done: 9, cat: 'Brake',
    jobs: [['DTZD-09', [['WG9000360100', 2]]], ['DTZD-08', [['WG9200340068', 1]]]], remarks: 'Rem sudah dites, pakem.' },
  { unit: 2, hoursAgo: 36, type: 'REPAIR', problem: 'Lampu utama kanan mati, kabel konektor terbakar.', done: 4 },
  { unit: 3, hoursAgo: 2, type: 'REPAIR', problem: 'Kebocoran oli hidrolik pada cylinder hoist.', done: 0 },
  { unit: 4, hoursAgo: 288, type: 'PDI', problem: 'Pre-delivery inspection unit baru Motorsights MS600 sebelum dikirim ke site.', done: 9, cat: 'Lain-Lain',
    jobs: [['DTMT-04', [['GREASE-EP2', 1]]]], remarks: 'PDI lengkap, unit siap dikirim.' },
  { unit: 5, hoursAgo: 48, type: 'WARRANTY', problem: 'Klaim garansi: alternator tidak mengisi, lampu indikator aki menyala.', done: 2, running: 3 },
  { unit: 6, hoursAgo: 480, type: 'PDI', problem: 'Pre-delivery inspection unit baru Motorsights MS700.', done: 9, cat: 'Lain-Lain',
    jobs: [['DTMT-04', [['GREASE-EP2', 1], ['OIL-15W40', 4]]]], remarks: 'PDI selesai tanpa temuan.' },
  { unit: 6, hoursAgo: 1, type: 'REPAIR', problem: 'AC kabin tidak dingin, hanya keluar angin.', done: 0, approval: 'wait', hm: 160, km: 2210 },
  { unit: 7, hoursAgo: 168, type: 'OTHERS', other: 'Modifikasi bak dump', problem: 'Penambahan plat penguat pada lantai bak dump.', done: 9, cat: 'Welding',
    jobs: [[null, []]], remarks: 'Plat penguat terpasang dan dicat ulang.' },
];

// Minutes per step (1..9) and the wait before the next one.
const STEP_MIN = [15, 20, 45, 30, 25, 90, 0, 30, 15];
const GAP_MIN = 10;

const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;

function pick(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function addUnitExamples() {
  if (pick("SELECT 1 FROM units WHERE brand IN ('Shacman', 'Motorsights') COLLATE NOCASE")) throw new Error('Shacman / Motorsights units exist already; nothing added');
  const admin = loadUser("e.username = 'admin'");
  const sites = db.prepare('SELECT site_name FROM sites WHERE is_active = 1 ORDER BY id').all().map((r) => r.site_name);
  const site = (i) => sites[Math.min(i, sites.length - 1)];
  const byRole = (role, siteName) =>
    pick(`SELECT e.id FROM employees e JOIN roles r ON r.id = e.role_id WHERE r.code = ? AND e.is_active = 1 AND e.site = ? ORDER BY e.id`, role, siteName)?.id
    ?? pick(`SELECT e.id FROM employees e JOIN roles r ON r.id = e.role_id WHERE r.code = ? AND e.is_active = 1 ORDER BY e.id`, role).id;

  const units = UNITS.map(([code, number, brand, model, serial, year, s]) =>
    createUnit({ unit_code: code, unit_number: number, unit_type: 'Dump Truck', brand, model, serial_number: serial, year, site: site(s) }, admin));

  const meters = UNITS.map(([, , , , , , , hm, km]) => ({ hm, km }));
  const summary = [];
  for (const spec of WOS) {
    const unit = units[spec.unit];
    const reading = meters[spec.unit];
    reading.hm = Math.round((reading.hm + (spec.hm ?? 0)) * 10) / 10;
    reading.km += spec.km ?? 0;
    const mechanic = loadUser('e.id = ?', byRole('mechanic', unit.site));
    const created = Date.now() - spec.hoursAgo * 3600_000;
    const wo = createWorkOrder(
      {
        unit_id: unit.id, driver_id: byRole('driver', unit.site), mechanic_id: mechanic.id, problem: spec.problem,
        maintenance_type: spec.type, maintenance_other: spec.other, hm: reading.hm, km: reading.km,
      },
      spec.type === 'WARRANTY' || spec.unit % 2 ? mechanic : admin,
      spec.type === 'WARRANTY' || spec.unit % 2 ? CHANNEL.MOBILE : CHANNEL.WEB,
      { at: iso(created), silent: true },
    );
    if (spec.approval !== 'wait') setApproval(wo.wo_uuid, APPROVAL.APPROVE, { remarks: spec.type === 'WARRANTY' ? 'Klaim garansi diteruskan ke principal.' : undefined });

    let t = created + 20 * MIN;
    const opts = (ms) => ({ at: iso(ms), silent: true });
    const step = (no) => pick('SELECT id FROM wo_steps WHERE wo_uuid = ? AND step_no = ? AND parent_id IS NULL', wo.wo_uuid, no).id;
    const last = spec.running ?? spec.done;
    for (let no = 1; no <= last; no++) {
      progressStep(wo.wo_uuid, step(no), 'start', mechanic, null, opts(t));
      if (no === 7 && spec.cat) {
        const category = pick('SELECT id FROM repair_categories WHERE name = ?', spec.cat);
        setWoCategory(wo.wo_uuid, { category_id: category.id }, mechanic);
        let jt = t + 5 * MIN;
        for (const [code, parts, running] of spec.jobs) {
          const job = code
            ? pick('SELECT id, standard_duration FROM job_codes WHERE job_code = ?', code)
            : pick('SELECT id, standard_duration FROM job_codes WHERE category_id = ? AND is_active = 1 ORDER BY job_code', category.id);
          addWoJobCode(wo.wo_uuid, { job_code_id: job.id, mechanic_id: mechanic.id }, mechanic, opts(jt));
          const entry = pick('SELECT id FROM wo_job_codes WHERE wo_uuid = ? AND job_code_id = ? ORDER BY id DESC', wo.wo_uuid, job.id).id;
          timeWoJobCode(wo.wo_uuid, entry, 'start', mechanic, opts(jt));
          for (const [pn, qty] of parts) {
            const part = pick('SELECT id FROM spareparts WHERE part_number = ?', pn);
            if (part) addWoJobPart(wo.wo_uuid, entry, { sparepart_id: part.id, qty }, mechanic, opts(jt + 3 * MIN));
          }
          // A little under the standard time (60 min when it has none).
          const minutes = Math.round((job.standard_duration ?? 60) * 0.85);
          if (!running) timeWoJobCode(wo.wo_uuid, entry, 'finish', mechanic, opts(jt + minutes * MIN));
          jt += (minutes + 5) * MIN;
        }
        t = jt;
      } else {
        t += STEP_MIN[no - 1] * MIN;
      }
      if (no <= spec.done) {
        progressStep(wo.wo_uuid, step(no), 'finish', mechanic, no === 9 ? spec.remarks : null, opts(t));
        t += GAP_MIN * MIN;
      }
      if (t > Date.now()) throw new Error(`${wo.wo_number}: timeline runs past now`);
    }
    const now = pick('SELECT wo_number, status, approval_status FROM work_orders WHERE wo_uuid = ?', wo.wo_uuid);
    summary.push(`${now.wo_number} ${unit.unit_number} (${unit.brand} ${unit.model}) ${spec.type} ${now.status}/${now.approval_status}`);
  }
  return { units: units.map((u) => `${u.unit_code} ${u.brand} ${u.model} @ ${u.site}`), work_orders: summary };
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-unit-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  const r = addUnitExamples();
  console.log(`Units:\n  ${r.units.join('\n  ')}`);
  console.log(`Work orders:\n  ${r.work_orders.join('\n  ')}`);
}
