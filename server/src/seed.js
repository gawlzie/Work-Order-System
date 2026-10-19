import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db, ensureSystemRoles, tx } from './db.js';
import { hashPassword } from './auth.js';
import { ensureStepTemplates, insertSteps, recomputeStatus } from './workorders.js';

const COMPANY = 'Inline Technology International';
const SITE = 'Site Kalimantan - Pit A';

const EMPLOYEES = [
  ['ITI-0001', 'Admin Plant', 'admin', 'admin'],
  ['ITI-1001', 'Budi Santoso', 'mechanic', 'budi'],
  ['ITI-1002', 'Agus Prasetyo', 'mechanic', 'agus'],
  ['ITI-1003', 'Rudi Hartono', 'mechanic', 'rudi'],
  ['ITI-1004', 'Dedi Kurniawan', 'mechanic', null],
  ['ITI-2001', 'Joko Susilo', 'driver', 'joko'],
  ['ITI-2002', 'Slamet Riyadi', 'driver', null],
  ['ITI-2003', 'Wahyu Hidayat', 'driver', null],
  ['ITI-2004', 'Andi Saputra', 'driver', null],
  ['ITI-2005', 'Hendra Wijaya', 'driver', null],
  ['ITI-2006', 'Eko Purnomo', 'driver', null],
  ['ITI-2007', 'Fajar Nugroho', 'driver', null],
  ['ITI-2008', 'Yusuf Maulana', 'driver', null],
];

const CATEGORIES = ['Engine', 'Transmission', 'Hydraulic', 'Electrical', 'Brake System', 'Tyre', 'Suspension', 'Cooling System', 'Body & Cabin', 'Preventive Maintenance'];

const PROBLEMS = [
  ['Engine overheating after 2 hours of hauling', 'Cooling System'],
  ['Hydraulic dump body lifts slowly', 'Hydraulic'],
  ['Brake pedal feels soft, long stopping distance', 'Brake System'],
  ['Front left tyre cut and losing pressure', 'Tyre'],
  ['Transmission slips when shifting to 3rd gear', 'Transmission'],
  ['Engine hard to start in the morning', 'Engine'],
  ['Dashboard warning light: charging system', 'Electrical'],
  ['Abnormal noise from rear suspension', 'Suspension'],
  ['Oil leak at hydraulic cylinder seal', 'Hydraulic'],
  ['Cabin AC not cooling', 'Body & Cabin'],
  ['Service 500 hours', 'Preventive Maintenance'],
  ['Black smoke from exhaust under load', 'Engine'],
  ['Headlamp and work lamp not working', 'Electrical'],
  ['Radiator coolant leak', 'Cooling System'],
];

// Deterministic PRNG so every seed produces the same demo data.
let state = 20261019;
const rand = () => ((state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const minutes = (n) => n * 60_000;

export function seed({ reset = false } = {}) {
  if (reset) {
    db.exec('DELETE FROM wo_steps; DELETE FROM work_orders; DELETE FROM units; DELETE FROM repair_categories; DELETE FROM employees; DELETE FROM roles WHERE is_system = 0; DELETE FROM step_templates;');
    db.exec("DELETE FROM sqlite_sequence WHERE name != 'roles'");
    ensureSystemRoles({ reset: true });
  }
  ensureStepTemplates();
  if (!reset && db.prepare('SELECT COUNT(*) AS n FROM employees').get().n > 0) return false;

  tx(() => {
    const insEmp = db.prepare(
      'INSERT INTO employees (employee_id, full_name, role_id, company, site, username, password_hash) VALUES (?, ?, (SELECT id FROM roles WHERE code = ?), ?, ?, ?, ?)',
    );
    for (const [eid, name, role, username] of EMPLOYEES) {
      insEmp.run(eid, name, role, COMPANY, SITE, username, username ? hashPassword('password123') : null);
    }

    const insUnit = db.prepare('INSERT INTO units (unit_code, unit_number, unit_type, brand, model, serial_number, year) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const models = [['Hino', 'FM 260 JD'], ['Mercedes-Benz', 'Axor 4028'], ['Volvo', 'FMX 440'], ['Scania', 'P410']];
    for (let i = 1; i <= 20; i++) {
      const [brand, model] = models[i % models.length];
      insUnit.run(`DT-${String(i).padStart(3, '0')}`, `DT ${100 + i}`, 'Dump Truck', brand, model,
        `${brand.slice(0, 3).toUpperCase()}${String(240000 + i * 137)}`, 2018 + (i % 7));
    }

    const insCat = db.prepare('INSERT INTO repair_categories (name) VALUES (?)');
    CATEGORIES.forEach((c) => insCat.run(c));
  });

  const emp = (role) =>
    db.prepare('SELECT e.id FROM employees e JOIN roles r ON r.id = e.role_id WHERE r.code = ?').all(role).map((r) => r.id);
  const drivers = emp('driver');
  const mechanics = emp('mechanic');
  const [admin] = emp('admin');
  const catId = Object.fromEntries(db.prepare('SELECT id, name FROM repair_categories').all().map((r) => [r.name, r.id]));
  const units = db.prepare('SELECT id FROM units').all().map((r) => r.id);

  const insWo = db.prepare(
    `INSERT INTO work_orders (wo_uuid, wo_number, unit_id, driver_id, mechanic_id, category_id, problem, status,
      approval_status, reject_reason, channel_source, created_by, created_at, updated_at, mobile_sync_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
  );
  const setStep = db.prepare('UPDATE wo_steps SET started_at = ?, finished_at = ?, pic_id = ?, remarks = ? WHERE id = ?');

  const TOTAL = 45;
  const nowMs = Date.now();
  const seqByMonth = {};
  const busyUnits = new Set();

  tx(() => {
    for (let i = 0; i < TOTAL; i++) {
      // Older work orders are mostly finished; the most recent ones are still in flight.
      const ageDays = Math.floor(((TOTAL - i) / TOTAL) * 60);
      const created = new Date(nowMs - ageDays * 86_400_000 - Math.floor(rand() * 8) * 3_600_000);
      const ym = `${created.getFullYear()}${String(created.getMonth() + 1).padStart(2, '0')}`;
      seqByMonth[ym] = (seqByMonth[ym] || 0) + 1;
      const woNumber = `WO-${ym}-${String(seqByMonth[ym]).padStart(4, '0')}`;

      const recent = i >= TOTAL - 14;
      let unit = pick(units);
      if (recent) {
        while (busyUnits.has(unit)) unit = pick(units);
        busyUnits.add(unit);
      }
      const [problem, category] = pick(PROBLEMS);
      const channel = pick(['WEB', 'WEB', 'MOBILE', 'WHATSAPP']);
      const mechanic = pick(mechanics);

      let approval = channel === 'WEB' ? 'APPROVE_BY_SYSTEM' : 'APPROVE';
      let rejectReason = null;
      let progress = 1; // fraction of the 6 steps done
      if (recent) {
        const r = rand();
        if (channel !== 'WEB' && r < 0.25) approval = 'WAITING';
        else if (channel !== 'WEB' && r < 0.32) {
          approval = 'REJECT';
          rejectReason = 'Duplicate report, unit already handled in another work order';
        }
        progress = approval.startsWith('APPROVE') ? pick([0, 0.2, 0.4, 0.5, 0.7, 0.9]) : 0;
      } else if (channel !== 'WEB' && rand() < 0.05) {
        approval = 'REJECT';
        rejectReason = 'Report invalid: unit is operating normally';
        progress = 0;
      }

      const uuid = randomUUID();
      const assigned = progress > 0 || rand() < 0.5 ? mechanic : null;
      insWo.run(uuid, woNumber, unit, pick(drivers), assigned, catId[category], problem, approval, rejectReason,
        channel, channel === 'WEB' ? admin : assigned ?? admin, created.toISOString(), created.toISOString(),
        progress > 0 ? new Date(created.getTime() + minutes(20)).toISOString() : null);
      insertSteps(uuid);

      if (progress > 0) {
        const steps = db.prepare('SELECT * FROM wo_steps WHERE wo_uuid = ? AND parent_id IS NULL ORDER BY step_no').all(uuid);
        const doneCount = Math.round(progress * steps.length);
        // Some work orders sit between steps: the last step is done and nobody has taken the next one yet (WAITING).
        const betweenSteps = doneCount > 0 && doneCount < steps.length && rand() < 0.4;
        let cursor = created.getTime() + minutes(30 + rand() * 60);
        steps.forEach((step, idx) => {
          if (idx > doneCount || (idx === doneCount && betweenSteps)) return;
          const duration = step.is_waiting ? minutes(60 + rand() * 600) : minutes(20 + rand() * 120);
          const start = cursor;
          const inProgress = idx === doneCount;
          let end = start + duration;
          if (end > nowMs) end = nowMs;
          const startIso = new Date(Math.min(start, nowMs - minutes(5))).toISOString();
          const endIso = inProgress ? null : new Date(end).toISOString();
          const remark = !inProgress && rand() < 0.3 ? pick(['Done as per SOP', 'Part replaced', 'Checked OK', 'Need follow-up next service']) : null;
          setStep.run(startIso, endIso, mechanic, remark, step.id);
          const subs = db.prepare('SELECT * FROM wo_steps WHERE parent_id = ? ORDER BY step_no').all(step.id);
          let subCursor = start;
          subs.forEach((sub, j) => {
            // In the active step only the first sub-step has been started.
            if (inProgress && j > 0) return;
            const subEnd = subCursor + duration / subs.length;
            setStep.run(
              new Date(Math.min(subCursor, nowMs - minutes(5))).toISOString(),
              inProgress ? null : new Date(Math.min(subEnd, nowMs)).toISOString(),
              mechanic, null, sub.id);
            subCursor = subEnd;
          });
          cursor = end + minutes(5 + rand() * 30);
        });
        recomputeStatus(uuid);
      }
    }
  });
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed({ reset: process.argv.includes('--reset') });
  const n = db.prepare('SELECT COUNT(*) AS n FROM work_orders').get().n;
  console.log(`Seeded database with ${n} work orders.`);
}
