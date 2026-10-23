/**
 * Example work orders with more than one repair category on Step 7, in different states (finished, waiting after
 * Step 7, Step 7 still running). Each category's job codes are done by a mechanic of the unit's site (of another site
 * when it has none), mechanics taking turns per category, with their spare parts. Everything goes through the normal work order functions
 * with times in the past (as the offline sync does), so the same rules apply. Old example events send no
 * notifications. Refuses to run when these examples exist already, or when a unit has an open work order.
 *
 * Usage: node src/multicat-examples.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, loadUser } from './db.js';
import {
  addWoCategory, addWoJobCode, addWoJobPart, APPROVAL, CHANNEL, createWorkOrder, progressStep, setApproval, timeWoJobCode,
} from './workorders.js';

/**
 * unit number, hours ago, type (+ notes), problem, steps finished (9 = all), the running step, Step 7 categories
 * { cat, jobs: [job code, parts [[part number, qty]], running?] }, closing remarks, HM / KM added to the last reading.
 */
const WOS = [
  { unit: 'DT 110', hoursAgo: 96, type: 'REPAIR', problem: 'Mesin tersendat saat menanjak dan rem kurang pakem saat turunan dengan muatan penuh.', done: 9,
    cats: [
      { cat: 'Engine', jobs: [['DTFDJ-52', [['VG1560080012', 1], ['612600081335', 1]]], ['DTFDJ-90', [['VG61000070005', 1], ['OIL-15W40', 18]]]] },
      { cat: 'Brake', jobs: [['DTZD-09', [['WG9000360100', 2]]], ['DTZD-12', [['WG9200340068', 1]]]] },
    ],
    remarks: 'Filter bahan bakar & oli diganti, rem disetel ulang. Test jalan OK.', hm: 186.4, km: 2410 },
  { unit: 'DT 111', hoursAgo: 150, type: 'PREVENTIVE', notes: 'PM 500 jam + pemeriksaan kaki-kaki', problem: 'Servis berkala PM 500 jam; ban depan kanan aus tidak rata dan setir terasa bergetar.', done: 9,
    cats: [
      { cat: 'Engine', jobs: [['DTFDJ-90', [['VG61000070005', 1], ['OIL-15W40', 20]]], ['DTFDJ-64', [['WG9725190102', 1]]]] },
      { cat: 'Tyre', jobs: [['DTTY-03', [['TYRE-1200R20', 2], ['TUBE-1200R20', 2]]]] },
      { cat: 'Steering', jobs: [['DTZX-26', [['AZ9719430100', 1]]]] },
    ],
    remarks: 'PM 500 jam selesai, 2 ban depan diganti, ball joint tie rod diganti. Setir normal.', hm: 241.8, km: 3175 },
  { unit: 'DT 122', hoursAgo: 30, type: 'REPAIR', problem: 'Bak dump turun sendiri saat diangkat, ada rembesan oli di selang hydraulic.', done: 7,
    cats: [
      { cat: 'Hose Hydraulic', jobs: [['DTYYG-02', [['HOSE-34-4SH', 2.5], ['OIL-HYD46', 20]]]] },
      { cat: 'Sistem Pengangkatan', jobs: [['DTJS-10', [['HYVA-SK-191', 1]]]] },
    ],
    hm: 96.3, km: 1240 },
  { unit: 'DT 128', hoursAgo: 7, type: 'REPAIR', problem: 'Lampu utama kiri mati dan AC kabin kurang dingin.', done: 6, running: 7,
    cats: [
      { cat: 'Electric', jobs: [['DTDQ-118', [['BULB-H4-24V', 2]]]] },
      { cat: 'AC', jobs: [['DTKT-13', [['FREON-R134A', 1.5]], true]] },
    ],
    hm: 58.6, km: 845 },
];

// Minutes per step (1..9) and the wait before the next one.
const STEP_MIN = [15, 20, 45, 30, 25, 90, 0, 30, 15];
const GAP_MIN = 10;
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const pick = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

/** Active employees with the role at the site (ids). */
const atSite = (role, site) =>
  all(`SELECT e.id FROM employees e JOIN roles r ON r.id = e.role_id WHERE r.code = ? AND e.is_active = 1 AND e.site = ? COLLATE NOCASE ORDER BY e.id`, role, site).map((r) => r.id);
/** Active employees with the role at any site (ids). */
const anyOf = (role) =>
  all('SELECT e.id FROM employees e JOIN roles r ON r.id = e.role_id WHERE r.code = ? AND e.is_active = 1 ORDER BY e.id', role).map((r) => r.id);

export function addMultiCategoryExamples() {
  if (pick('SELECT 1 FROM work_orders WHERE problem = ?', WOS[0].problem)) throw new Error('These examples exist already; nothing added');
  const summary = [];
  for (const spec of WOS) {
    const unit = pick('SELECT * FROM units WHERE unit_number = ? AND is_active = 1', spec.unit);
    if (!unit) throw new Error(`Unit ${spec.unit} not found`);
    if (pick("SELECT 1 FROM work_orders WHERE unit_id = ? AND status != 'FINISH' AND approval_status != 'REJECT'", unit.id))
      throw new Error(`${spec.unit} has an open work order`);
    const last = pick('SELECT MAX(hm) AS hm, MAX(km) AS km FROM work_orders WHERE unit_id = ?', unit.id);
    // The site's own drivers and mechanics; a site without them is helped by people from another site.
    const local = atSite('mechanic', unit.site);
    const mechanics = local.length ? local : anyOf('mechanic');
    const drivers = atSite('driver', unit.site).length ? atSite('driver', unit.site) : anyOf('driver');
    const crew = mechanics.map((id) => loadUser('e.id = ?', id));
    const pic = crew[0];
    // Raised on the web by the site's Admin Site; Admin Company when the crew comes from another site (an Admin Site
    // can only assign people of its own site).
    const siteAdmin = local.length && atSite('driver', unit.site).length ? atSite('admin', unit.site)[0] : null;
    const creator = loadUser('e.id = ?', siteAdmin ?? pick("SELECT id FROM employees WHERE username = 'admincompany'").id);
    const created = Date.now() - spec.hoursAgo * 3600_000;
    const wo = createWorkOrder(
      {
        unit_id: unit.id, driver_id: drivers[0], mechanic_id: pic.id, problem: spec.problem, maintenance_type: spec.type, maintenance_other: spec.notes ?? null,
        hm: Math.round(((last.hm ?? 0) + spec.hm) * 10) / 10, km: (last.km ?? 0) + spec.km,
      },
      creator,
      CHANNEL.WEB,
      { at: iso(created), silent: true },
    );
    setApproval(wo.wo_uuid, APPROVAL.APPROVE, { remarks: 'Disetujui, lanjutkan perbaikan.' });

    let t = created + 20 * MIN;
    const opts = (ms) => ({ at: iso(ms), silent: true });
    const step = (no) => pick('SELECT id FROM wo_steps WHERE wo_uuid = ? AND step_no = ? AND parent_id IS NULL', wo.wo_uuid, no).id;
    const lastStep = spec.running ?? spec.done;
    for (let no = 1; no <= lastStep; no++) {
      progressStep(wo.wo_uuid, step(no), 'start', pic, null, opts(t));
      if (no === 7) {
        let jt = t + 5 * MIN;
        spec.cats.forEach(({ cat, jobs }, i) => {
          // Categories are chosen one after the other; each one's jobs go to the next mechanic of the site.
          const mechanic = crew[i % crew.length];
          const category = pick('SELECT id FROM repair_categories WHERE name = ?', cat);
          if (!category) throw new Error(`Category ${cat} not found`);
          addWoCategory(wo.wo_uuid, { category_id: category.id }, pic, opts(jt));
          jt += 2 * MIN;
          for (const [code, parts, running] of jobs) {
            const job = pick('SELECT id, standard_duration, category_id FROM job_codes WHERE job_code = ?', code);
            if (!job || job.category_id !== category.id) throw new Error(`${code} is not a job code of ${cat}`);
            addWoJobCode(wo.wo_uuid, { job_code_id: job.id, mechanic_id: mechanic.id }, pic, opts(jt));
            const entry = pick('SELECT id FROM wo_job_codes WHERE wo_uuid = ? AND job_code_id = ? ORDER BY id DESC', wo.wo_uuid, job.id).id;
            timeWoJobCode(wo.wo_uuid, entry, 'start', mechanic, opts(jt));
            for (const [pn, qty] of parts) {
              const part = pick('SELECT part_number, part_name, uom FROM spareparts WHERE part_number = ?', pn);
              if (!part) throw new Error(`Spare part ${pn} not found`);
              addWoJobPart(wo.wo_uuid, entry, { part_name: part.part_name, uom: part.uom, qty }, mechanic, opts(jt + 3 * MIN));
            }
            // A little under the standard time (60 min when it has none).
            const minutes = Math.round((job.standard_duration ?? 60) * 0.85);
            if (!running) timeWoJobCode(wo.wo_uuid, entry, 'finish', mechanic, opts(jt + minutes * MIN));
            jt += (minutes + 5) * MIN;
          }
        });
        t = jt;
      } else {
        t += STEP_MIN[no - 1] * MIN;
      }
      if (no <= spec.done) {
        progressStep(wo.wo_uuid, step(no), 'finish', pic, no === 9 ? spec.remarks : null, opts(t));
        t += GAP_MIN * MIN;
      }
      if (t > Date.now()) throw new Error(`${wo.wo_number}: timeline runs past now`);
    }
    const now = pick('SELECT wo_number, status, approval_status FROM work_orders WHERE wo_uuid = ?', wo.wo_uuid);
    const cats = all('SELECT c.name FROM wo_categories wc JOIN repair_categories c ON c.id = wc.category_id WHERE wc.wo_uuid = ? ORDER BY wc.added_at', wo.wo_uuid).map((c) => c.name);
    summary.push(`${now.wo_number} ${unit.unit_number} @ ${unit.site}: ${now.status}/${now.approval_status} · ${cats.join(' + ')}`);
  }
  return summary;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-multicat-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  console.log(`Work orders:\n  ${addMultiCategoryExamples().join('\n  ')}`);
}
