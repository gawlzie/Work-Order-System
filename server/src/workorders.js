import { randomUUID } from 'node:crypto';
import { hasPermission } from './auth.js';
import { db, roleHas, tx } from './db.js';

export const STATUS = { OPEN: 'OPEN', ON_PROGRESS: 'ON_PROGRESS', WAITING: 'WAITING', FINISH: 'FINISH' };
export const APPROVAL = { WAITING: 'WAITING', APPROVE: 'APPROVE', REJECT: 'REJECT' };
export const CHANNEL = { WEB: 'WEB', MOBILE: 'MOBILE', WHATSAPP: 'WHATSAPP' };

/**
 * Default repair flow, loaded into the step master when it is empty.
 * `addSub`: mechanics may add their own sub-steps in the app.
 */
export const DEFAULT_STEPS = [
  { name: 'Unit Breakdown', subs: [] },
  { name: 'Service Request', subs: [] },
  { name: 'Inspection Activity', subs: [] },
  { name: 'Inspection Report Readiness', subs: [] },
  { name: 'Spareparts Request', subs: [] },
  { name: 'Supply Spareparts', subs: [] },
  { name: 'Repair Process', addSub: true, subs: [] },
  { name: 'Ground Test', subs: [] },
  { name: 'RFU (Ready For Use)', subs: [] },
];

/** The 6-step flow earlier versions installed; an untouched copy of it is upgraded to DEFAULT_STEPS. */
const LEGACY_DEFAULT_STEPS = [
  { name: 'Unit Check-In', subs: ['Visual inspection', 'Record HM / KM'] },
  { name: 'Troubleshooting', subs: ['Identify fault', 'Determine repair category'] },
  { name: 'Waiting Part', waiting: true, subs: [] },
  { name: 'Repair Execution', subs: ['Remove faulty component', 'Install / repair component'] },
  { name: 'Test & Commissioning', subs: ['Test run', 'Final quality check'] },
  { name: 'Unit Release', subs: [] },
];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
// Work may start before the admin approves; only a rejected work order stops it.
const assertWorkable = (wo) => {
  if (wo.approval_status === APPROVAL.REJECT) throw new HttpError(409, 'This work order was rejected; work cannot continue');
};

export function nextWoNumber(date = new Date()) {
  const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `WO-${ym}-`;
  const row = db
    .prepare('SELECT wo_number FROM work_orders WHERE wo_number LIKE ? ORDER BY wo_number DESC LIMIT 1')
    .get(`${prefix}%`);
  const seq = row ? Number(row.wo_number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/** Comparable form of a step list: names, flags and sub-steps in order. */
const signature = (steps) => JSON.stringify(steps.map((s) => [s.name, !!s.waiting, !!s.addSub, s.subs]));

/**
 * Fills an empty step master with DEFAULT_STEPS (first start, or seed reset). A master that still holds the
 * untouched legacy defaults is replaced too; a master someone has edited is never overwritten.
 * Work orders keep their own copy of the steps, so this never changes existing work orders.
 */
export function ensureStepTemplates() {
  const rows = db.prepare('SELECT * FROM step_templates ORDER BY sort_order, id').all();
  if (rows.length) {
    const top = rows.filter((r) => r.parent_id === null);
    const current = top.map((r) => ({ name: r.name, waiting: r.is_waiting, addSub: r.allow_add_sub, subs: rows.filter((c) => c.parent_id === r.id).map((c) => c.name) }));
    const untouched = top.every((r) => r.is_active && !r.description) && signature(current) === signature(LEGACY_DEFAULT_STEPS);
    if (!untouched) return;
  }
  const insert = db.prepare('INSERT INTO step_templates (parent_id, sort_order, name, is_waiting, allow_add_sub) VALUES (?, ?, ?, ?, ?)');
  tx(() => {
    db.exec('DELETE FROM step_templates');
    DEFAULT_STEPS.forEach((step, i) => {
      const { lastInsertRowid } = insert.run(null, i + 1, step.name, step.waiting ? 1 : 0, step.addSub ? 1 : 0);
      step.subs.forEach((sub, j) => insert.run(lastInsertRowid, j + 1, sub, 0, 0));
    });
  });
}

/** Active steps of the step master in the { name, waiting, addSub, subs } shape insertSteps takes. */
export function activeStepTemplate() {
  const rows = db.prepare('SELECT * FROM step_templates ORDER BY sort_order, id').all();
  return rows
    .filter((r) => r.parent_id === null && r.is_active)
    .map((r) => ({ name: r.name, waiting: !!r.is_waiting, addSub: !!r.allow_add_sub, subs: rows.filter((c) => c.parent_id === r.id).map((c) => c.name) }));
}

export function insertSteps(woUuid, template = activeStepTemplate()) {
  const insert = db.prepare(
    'INSERT INTO wo_steps (wo_uuid, parent_id, step_no, step_name, is_waiting, allow_add_sub) VALUES (?, ?, ?, ?, ?, ?)',
  );
  template.forEach((step, i) => {
    const { lastInsertRowid } = insert.run(woUuid, null, i + 1, step.name, step.waiting ? 1 : 0, step.addSub ? 1 : 0);
    step.subs.forEach((sub, j) => insert.run(woUuid, lastInsertRowid, j + 1, sub, 0, 0));
  });
}

/**
 * Work order status from its top-level steps:
 * OPEN        no step started yet (just created)
 * ON_PROGRESS a mechanic has taken a step and it is running
 * WAITING     some steps are done but nobody has taken the next one yet (between steps)
 * FINISH      every step is finished
 */
export function deriveStatus(steps) {
  if (steps.length && steps.every((s) => s.finished_at)) return STATUS.FINISH;
  if (steps.some((s) => s.started_at && !s.finished_at)) return STATUS.ON_PROGRESS;
  if (steps.some((s) => s.started_at)) return STATUS.WAITING;
  return STATUS.OPEN;
}

const topSteps = (woUuid) =>
  db.prepare('SELECT * FROM wo_steps WHERE wo_uuid = ? AND parent_id IS NULL ORDER BY step_no').all(woUuid);

/** Derive status, started_at and finished_at of a work order from its top-level steps. */
export function recomputeStatus(woUuid) {
  const steps = topSteps(woUuid);
  const status = deriveStatus(steps);
  const startedAt = steps.map((s) => s.started_at).filter(Boolean).sort()[0] ?? null;
  const finishedAt = status === STATUS.FINISH ? steps.map((s) => s.finished_at).sort().at(-1) : null;
  db.prepare('UPDATE work_orders SET status = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE wo_uuid = ?').run(
    status,
    startedAt,
    finishedAt,
    now(),
    woUuid,
  );
}

/**
 * Re-applies the status rules to every stored work order, e.g. after the rules changed.
 * Only the status column is touched (no timestamps), so it is safe to run on every start.
 */
export function syncStatuses() {
  const update = db.prepare('UPDATE work_orders SET status = ? WHERE wo_uuid = ?');
  let changed = 0;
  tx(() => {
    for (const { wo_uuid, status } of db.prepare('SELECT wo_uuid, status FROM work_orders').all()) {
      const next = deriveStatus(topSteps(wo_uuid));
      if (next !== status) {
        update.run(next, wo_uuid);
        changed++;
      }
    }
  });
  return changed;
}

const LIST_SELECT = `
  SELECT wo.*, u.unit_number, u.unit_code, u.unit_type,
         d.full_name AS driver_name, m.full_name AS mechanic_name,
         c.name AS category, cb.full_name AS created_by_name,
         (SELECT GROUP_CONCAT(jc.job_code, ', ') FROM wo_job_codes x JOIN job_codes jc ON jc.id = x.job_code_id WHERE x.wo_uuid = wo.wo_uuid) AS job_code_list,
         (SELECT SUM(jc.standard_duration) FROM wo_job_codes x JOIN job_codes jc ON jc.id = x.job_code_id WHERE x.wo_uuid = wo.wo_uuid) AS job_standard_duration,
         (SELECT 'Step ' || s.step_no || ' · ' || s.step_name FROM wo_steps s
            WHERE s.wo_uuid = wo.wo_uuid AND s.parent_id IS NULL AND s.started_at IS NOT NULL AND s.finished_at IS NULL
            ORDER BY s.step_no LIMIT 1) AS current_step,
         (SELECT 'Step ' || s.step_no || ' · ' || s.step_name FROM wo_steps s
            WHERE s.wo_uuid = wo.wo_uuid AND s.parent_id IS NULL AND s.started_at IS NULL
            ORDER BY s.step_no LIMIT 1) AS next_step,
         (SELECT COUNT(*) FROM wo_proofs p WHERE p.wo_uuid = wo.wo_uuid) AS proof_count,
         -- Repair time: the repair step(s) (where mechanics add their own sub-steps, i.e. Repair Process), still counting if running.
         (SELECT SUM(julianday(COALESCE(s.finished_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(s.started_at)) * 86400
            FROM wo_steps s WHERE s.wo_uuid = wo.wo_uuid AND s.parent_id IS NULL AND s.allow_add_sub = 1 AND s.started_at IS NOT NULL) AS repair_seconds
  FROM work_orders wo
  JOIN units u ON u.id = wo.unit_id
  JOIN employees d ON d.id = wo.driver_id
  LEFT JOIN employees m ON m.id = wo.mechanic_id
  LEFT JOIN repair_categories c ON c.id = wo.category_id
  LEFT JOIN employees cb ON cb.id = wo.created_by`;

function decorate(row) {
  const end = row.finished_at ? new Date(row.finished_at) : new Date();
  const totalSec = row.started_at ? Math.max(0, Math.round((end - new Date(row.started_at)) / 1000)) : 0;
  let stepInfo = row.current_step;
  if (!stepInfo) {
    if (row.status === STATUS.FINISH) stepInfo = 'Completed';
    else if (row.status === STATUS.WAITING) stepInfo = `Next: ${row.next_step ?? '-'}`;
    else stepInfo = 'Not started';
  }
  const { current_step, next_step, repair_seconds, ...rest } = row;
  const repairTime = repair_seconds == null ? null : Math.max(0, Math.round(repair_seconds));
  return { ...rest, step_information: stepInfo, total_time: totalSec, repair_time: repairTime };
}

const SORTABLE = ['wo_number', 'created_at', 'unit_number', 'driver_name', 'mechanic_name', 'status', 'approval_status', 'category', 'job_code_list', 'total_time'];

function buildFilters(q) {
  const where = [];
  const params = [];
  if (q.search) {
    where.push(`(wo.wo_number LIKE ? OR u.unit_number LIKE ? OR d.full_name LIKE ? OR wo.problem LIKE ?
      OR EXISTS (SELECT 1 FROM wo_job_codes x JOIN job_codes jc ON jc.id = x.job_code_id WHERE x.wo_uuid = wo.wo_uuid AND (jc.job_code LIKE ? OR jc.job_name LIKE ?)))`);
    const s = `%${q.search}%`;
    params.push(s, s, s, s, s, s);
  }
  for (const [key, col] of [
    ['status', 'wo.status'],
    ['approval_status', 'wo.approval_status'],
    ['channel_source', 'wo.channel_source'],
    ['unit_id', 'wo.unit_id'],
    ['driver_id', 'wo.driver_id'],
    ['mechanic_id', 'wo.mechanic_id'],
    ['category_id', 'wo.category_id'],
    ['created_by', 'wo.created_by'],
  ]) {
    if (q[key]) {
      const values = String(q[key]).split(',');
      // `none` matches work orders with no value yet, e.g. mechanic_id=none for unassigned jobs.
      const ids = values.filter((v) => v !== 'none');
      const parts = ids.length ? [`${col} IN (${ids.map(() => '?').join(',')})`] : [];
      if (ids.length < values.length) parts.push(`${col} IS NULL`);
      where.push(`(${parts.join(' OR ')})`);
      params.push(...ids);
    }
  }
  if (q.job_code_id) {
    const ids = String(q.job_code_id).split(',');
    where.push(`EXISTS (SELECT 1 FROM wo_job_codes x WHERE x.wo_uuid = wo.wo_uuid AND x.job_code_id IN (${ids.map(() => '?').join(',')}))`);
    params.push(...ids);
  }
  if (q.created_start) {
    where.push('wo.created_at >= ?');
    params.push(new Date(`${q.created_start}T00:00:00`).toISOString());
  }
  if (q.created_end) {
    where.push('wo.created_at <= ?');
    params.push(new Date(`${q.created_end}T23:59:59.999`).toISOString());
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

export function listWorkOrders(q = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 10));
  const sortBy = SORTABLE.includes(q.sort_by) ? q.sort_by : 'created_at';
  const sortOrder = String(q.sort_order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const { sql, params } = buildFilters(q);

  const rows = db.prepare(`${LIST_SELECT}${sql}`).all(...params).map(decorate);
  rows.sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return sortOrder === 'ASC' ? cmp : -cmp;
  });

  const total = rows.length;
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    meta: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

const PROOF_SELECT = `SELECT p.id, p.file_name, p.mime_type, p.size, p.uploaded_at, e.full_name AS uploaded_by_name
  FROM wo_proofs p LEFT JOIN employees e ON e.id = p.uploaded_by`;

/** Proof-of-completion files of a work order, oldest first. */
export const listProofs = (woUuid) => db.prepare(`${PROOF_SELECT} WHERE p.wo_uuid = ? ORDER BY p.uploaded_at, p.id`).all(woUuid);

/** Job codes done on a work order, in the order they were added. */
export const listWoJobCodes = (woUuid) =>
  db.prepare(`SELECT x.id, x.job_code_id, j.job_code, j.job_name, c.name AS category_name, j.standard_duration,
                     x.mechanic_id, m.full_name AS mechanic_name, a.full_name AS added_by_name, x.added_at, x.started_at, x.finished_at
              FROM wo_job_codes x JOIN job_codes j ON j.id = x.job_code_id JOIN repair_categories c ON c.id = j.category_id
              JOIN employees m ON m.id = x.mechanic_id LEFT JOIN employees a ON a.id = x.added_by
              WHERE x.wo_uuid = ? ORDER BY x.added_at, x.id`).all(woUuid);

export function getWorkOrder(woUuid) {
  const row = db.prepare(`${LIST_SELECT} WHERE wo.wo_uuid = ?`).get(woUuid);
  if (!row) throw new HttpError(404, 'Work order not found');
  const steps = db
    .prepare(
      `SELECT s.*, p.full_name AS pic_name FROM wo_steps s
       LEFT JOIN employees p ON p.id = s.pic_id
       WHERE s.wo_uuid = ? ORDER BY s.parent_id IS NOT NULL, s.step_no`,
    )
    .all(woUuid);
  const top = steps.filter((s) => s.parent_id === null);
  const withSubs = top.map((s) => ({ ...s, sub_steps: steps.filter((c) => c.parent_id === s.id) }));
  return {
    ...decorate(row),
    steps: withSubs.filter((s) => !s.is_additional),
    additional_work: withSubs.filter((s) => s.is_additional),
    proofs: listProofs(woUuid),
    job_codes: listWoJobCodes(woUuid),
  };
}

const assignable = (employeeId, permission) =>
  db.prepare(`SELECT 1 FROM employees e JOIN roles r ON r.id = e.role_id WHERE e.id = ? AND e.is_active = 1 AND ${roleHas()}`)
    .get(employeeId, permission);

/** Validates references. Values unchanged from `current` (the WO being edited) may point at since-deactivated records. */
function assertRefs({ unit_id, driver_id, mechanic_id }, current = {}) {
  if (!db.prepare('SELECT 1 FROM units WHERE id = ? AND (is_active = 1 OR id = ?)').get(unit_id, current.unit_id ?? null))
    throw new HttpError(422, 'Unit not found or inactive');
  if (driver_id !== current.driver_id && !assignable(driver_id, 'wo.as_driver')) throw new HttpError(422, 'Driver not found');
  if (mechanic_id && mechanic_id !== current.mechanic_id && !assignable(mechanic_id, 'wo.as_mechanic'))
    throw new HttpError(422, 'Mechanic not found');
}

/** `metersRequired`: HM / KM must be given (new WOs); on edit an empty value keeps the stored reading. */
function validatePayload(body, { metersRequired = true } = {}) {
  const unit_id = Number(body.unit_id);
  const driver_id = Number(body.driver_id);
  const problem = String(body.problem ?? '').trim();
  const errors = {};
  if (!unit_id) errors.unit_id = 'Unit is required';
  if (!driver_id) errors.driver_id = 'Driver is required';
  if (problem.length < 5) errors.problem = 'Problem description must be at least 5 characters';
  if (problem.length > 1000) errors.problem = 'Problem description is too long (max 1000)';
  // HM (hour meter, one decimal) and KM (odometer, whole number) are required readings of the unit.
  const hmRaw = String(body.hm ?? '').trim().replace(',', '.');
  const kmRaw = String(body.km ?? '').trim().replace(',', '.');
  const hm = Number(hmRaw);
  const km = Number(kmRaw);
  if (!hmRaw) { if (metersRequired) errors.hm = 'HM is required'; }
  else if (!Number.isFinite(hm) || hm < 0 || hm > 999999.9) errors.hm = 'HM must be a number from 0 to 999,999.9';
  if (!kmRaw) { if (metersRequired) errors.km = 'KM is required'; }
  else if (!Number.isInteger(km) || km < 0 || km > 9999999) errors.km = 'KM must be a whole number from 0 to 9,999,999';
  if (Object.keys(errors).length) {
    const err = new HttpError(422, 'Validation failed');
    err.errors = errors;
    throw err;
  }
  return {
    unit_id,
    driver_id,
    problem,
    hm: hmRaw ? Math.round(hm * 10) / 10 : null,
    km: kmRaw ? km : null,
    mechanic_id: body.mechanic_id ? Number(body.mechanic_id) : null,
  };
}

export function createWorkOrder(body, user, channel = CHANNEL.WEB) {
  const data = validatePayload(body);
  assertRefs(data);
  const open = db
    .prepare("SELECT wo_number FROM work_orders WHERE unit_id = ? AND status != 'FINISH' AND approval_status != 'REJECT'")
    .get(data.unit_id);
  if (open) throw new HttpError(409, `Unit already has an active work order (${open.wo_number})`);

  const wo_uuid = randomUUID();
  const ts = now();
  // Every work order, whoever raises it, waits until an approver approves or rejects it.
  const approval = APPROVAL.WAITING;
  tx(() => {
    db.prepare(
      `INSERT INTO work_orders (wo_uuid, wo_number, unit_id, driver_id, mechanic_id, category_id, problem, hm, km,
        status, approval_status, channel_source, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
    ).run(wo_uuid, nextWoNumber(), data.unit_id, data.driver_id, data.mechanic_id, null, data.problem, data.hm, data.km,
      approval, channel, user.id, ts, ts);
    insertSteps(wo_uuid);
  });
  return getWorkOrder(wo_uuid);
}

export function updateWorkOrder(woUuid, body) {
  const wo = getWorkOrder(woUuid);
  if (wo.status === STATUS.FINISH) throw new HttpError(409, 'A finished work order cannot be edited');
  const data = validatePayload(body, { metersRequired: false });
  assertRefs(data, wo);
  db.prepare(
    `UPDATE work_orders SET unit_id = ?, driver_id = ?, mechanic_id = ?, problem = ?, hm = COALESCE(?, hm), km = COALESCE(?, km), updated_at = ?
     WHERE wo_uuid = ?`,
  ).run(data.unit_id, data.driver_id, data.mechanic_id, data.problem, data.hm, data.km, now(), woUuid);
  return getWorkOrder(woUuid);
}

export function deleteWorkOrder(woUuid) {
  const wo = getWorkOrder(woUuid);
  if (wo.status !== STATUS.OPEN) throw new HttpError(409, 'Only work orders that have not started can be deleted');
  db.prepare('DELETE FROM work_orders WHERE wo_uuid = ?').run(woUuid);
}

/** Reject needs a reason; approve takes optional remarks (e.g. instructions for the mechanic). */
export function setApproval(woUuid, action, { reason, remarks } = {}) {
  const wo = getWorkOrder(woUuid);
  if (wo.approval_status !== APPROVAL.WAITING) throw new HttpError(409, 'This work order is not waiting for approval');
  if (action === APPROVAL.REJECT) {
    const text = String(reason ?? '').trim();
    if (text.length < 3) throw new HttpError(422, 'A reject reason is required');
    if (text.length > 500) throw new HttpError(422, 'Reject reason is too long (max 500)');
    db.prepare('UPDATE work_orders SET approval_status = ?, reject_reason = ?, approval_remarks = NULL, updated_at = ? WHERE wo_uuid = ?').run(
      APPROVAL.REJECT, text, now(), woUuid);
  } else if (action === APPROVAL.APPROVE) {
    const note = String(remarks ?? '').trim() || null;
    if (note && note.length > 500) throw new HttpError(422, 'Approval remarks are too long (max 500)');
    db.prepare('UPDATE work_orders SET approval_status = ?, reject_reason = NULL, approval_remarks = ?, updated_at = ? WHERE wo_uuid = ?').run(
      APPROVAL.APPROVE, note, now(), woUuid);
  } else {
    throw new HttpError(422, 'Unknown approval action');
  }
  return getWorkOrder(woUuid);
}

function getStep(woUuid, stepId) {
  const step = db.prepare('SELECT * FROM wo_steps WHERE id = ? AND wo_uuid = ?').get(stepId, woUuid);
  if (!step) throw new HttpError(404, 'Step not found');
  return step;
}

/** Mechanic progress: start or finish a step (top-level steps run strictly in order). */
export function progressStep(woUuid, stepId, action, user, remarks) {
  const wo = getWorkOrder(woUuid);
  assertWorkable(wo);
  const step = getStep(woUuid, stepId);
  const ts = now();
  const isMechanic = hasPermission(user, 'wo.as_mechanic');
  const picId = isMechanic ? user.id : wo.mechanic_id;

  tx(() => {
    if (action === 'start') {
      if (step.started_at) throw new HttpError(409, 'Step already started');
      if (step.parent_id === null) {
        const blocking = db
          .prepare('SELECT 1 FROM wo_steps WHERE wo_uuid = ? AND parent_id IS NULL AND step_no < ? AND finished_at IS NULL')
          .get(woUuid, step.step_no);
        if (blocking) throw new HttpError(409, 'Finish the previous step first');
      } else {
        const parent = getStep(woUuid, step.parent_id);
        if (!parent.started_at || parent.finished_at) throw new HttpError(409, 'Parent step is not in progress');
      }
      db.prepare('UPDATE wo_steps SET started_at = ?, pic_id = ? WHERE id = ?').run(ts, picId, step.id);
      if (!wo.mechanic_id && picId) db.prepare('UPDATE work_orders SET mechanic_id = ? WHERE wo_uuid = ?').run(picId, woUuid);
      if (!wo.mobile_sync_time && isMechanic)
        db.prepare('UPDATE work_orders SET mobile_sync_time = ? WHERE wo_uuid = ?').run(ts, woUuid);
    } else if (action === 'finish') {
      if (!step.started_at) throw new HttpError(409, 'Step has not started');
      if (step.finished_at) throw new HttpError(409, 'Step already finished');
      if (step.parent_id === null && step.allow_add_sub) {
        const { total, open } = db.prepare('SELECT COUNT(*) AS total, SUM(finished_at IS NULL) AS open FROM wo_job_codes WHERE wo_uuid = ?').get(woUuid);
        if (!total) throw new HttpError(409, `Add at least one job code before finishing Step ${step.step_no} · ${step.step_name}`);
        if (open) throw new HttpError(409, `Finish all job codes first (${open} still open)`);
      }
      const note = remarks ? String(remarks).trim() : null;
      db.prepare('UPDATE wo_steps SET finished_at = ?, remarks = COALESCE(?, remarks) WHERE id = ?').run(ts, note, step.id);
      // Closing a step closes any of its sub-steps that were left open.
      db.prepare(
        'UPDATE wo_steps SET started_at = COALESCE(started_at, ?), finished_at = ?, pic_id = COALESCE(pic_id, ?) WHERE parent_id = ? AND finished_at IS NULL',
      ).run(step.started_at, ts, picId, step.id);
    } else {
      throw new HttpError(422, 'Unknown step action');
    }
    recomputeStatus(woUuid);
  });
  return getWorkOrder(woUuid);
}

/** Mechanic adds a sub-step to this work order only, on steps flagged allow_add_sub (e.g. Repair Process). */
export function addSubStep(woUuid, stepId, name) {
  const wo = getWorkOrder(woUuid);
  assertWorkable(wo);
  const step = getStep(woUuid, stepId);
  if (step.parent_id !== null || !step.allow_add_sub) throw new HttpError(409, 'Sub-steps cannot be added to this step');
  if (step.finished_at) throw new HttpError(409, 'Step is already finished');
  const title = String(name ?? '').trim();
  if (title.length < 2 || title.length > 60) throw new HttpError(422, 'Sub-step name must be 2-60 characters');
  if (db.prepare('SELECT 1 FROM wo_steps WHERE parent_id = ? AND step_name = ? COLLATE NOCASE').get(step.id, title))
    throw new HttpError(422, 'This sub-step already exists');
  const { max } = db.prepare('SELECT MAX(step_no) AS max FROM wo_steps WHERE parent_id = ?').get(step.id);
  db.prepare('INSERT INTO wo_steps (wo_uuid, parent_id, step_no, step_name, is_additional) VALUES (?, ?, ?, ?, 1)').run(
    woUuid, step.id, (max ?? 0) + 1, title);
  return getWorkOrder(woUuid);
}

/**
 * Repair category and job codes are filled in during the repair step (Step 7, the step where mechanics add their own
 * sub-steps), never when the WO is created: by a mechanic while that step runs, by an approver (admin) any time after
 * it started, also to correct a finished WO. The category comes first; job codes must belong to it.
 * Each job code entry names the mechanic who did the job.
 */
function jobCodeGate(wo, user) {
  assertWorkable(wo);
  const repair = wo.steps.find((s) => s.allow_add_sub);
  if (!repair) throw new HttpError(409, 'This work order has no repair step for category and job codes');
  const admin = hasPermission(user, 'wo.approve');
  if (!repair.started_at) throw new HttpError(409, `Repair category and job codes are filled in from Step ${repair.step_no} · ${repair.step_name}`);
  if (!admin && repair.finished_at) throw new HttpError(409, `Step ${repair.step_no} · ${repair.step_name} is finished; ask the admin to change the category or job codes`);
  return admin;
}

export function setWoCategory(woUuid, body, user) {
  const wo = getWorkOrder(woUuid);
  jobCodeGate(wo, user);
  const categoryId = Number(body?.category_id);
  if (!categoryId || !db.prepare('SELECT 1 FROM repair_categories WHERE id = ? AND (is_active = 1 OR id = ?)').get(categoryId, wo.category_id ?? 0))
    throw Object.assign(new HttpError(422, 'Choose an active repair category'), { errors: { category_id: 'Choose an active repair category' } });
  const other = db.prepare(`SELECT COUNT(*) AS n FROM wo_job_codes x JOIN job_codes j ON j.id = x.job_code_id
                             WHERE x.wo_uuid = ? AND j.category_id != ?`).get(woUuid, categoryId).n;
  if (other) throw new HttpError(409, `Remove the ${other} job code(s) of the current category first`);
  db.prepare('UPDATE work_orders SET category_id = ?, updated_at = ? WHERE wo_uuid = ?').run(categoryId, now(), woUuid);
  return getWorkOrder(woUuid);
}

export function addWoJobCode(woUuid, body, user) {
  const wo = getWorkOrder(woUuid);
  jobCodeGate(wo, user);
  if (!wo.category_id) throw Object.assign(new HttpError(422, 'Choose the repair category first'), { errors: { category_id: 'Choose the repair category first' } });
  const jobId = Number(body?.job_code_id);
  const mechanicId = Number(body?.mechanic_id);
  const errors = {};
  const job = jobId ? db.prepare('SELECT category_id FROM job_codes WHERE id = ? AND is_active = 1').get(jobId) : null;
  if (!job) errors.job_code_id = 'Choose an active job code';
  else if (job.category_id !== wo.category_id) errors.job_code_id = 'This job code is not in the repair category of the work order';
  if (!mechanicId || !assignable(mechanicId, 'wo.as_mechanic')) errors.mechanic_id = 'Choose the mechanic who does this job';
  else if (jobId && db.prepare('SELECT 1 FROM wo_job_codes WHERE wo_uuid = ? AND job_code_id = ? AND mechanic_id = ?').get(woUuid, jobId, mechanicId))
    errors.job_code_id = 'This job code is already added for this mechanic';
  if (Object.keys(errors).length) {
    const err = new HttpError(422, Object.values(errors)[0]);
    err.errors = errors;
    throw err;
  }
  db.prepare('INSERT INTO wo_job_codes (wo_uuid, job_code_id, mechanic_id, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
    .run(woUuid, jobId, mechanicId, user.id, now());
  return getWorkOrder(woUuid);
}

/** Start or finish the timer of one job code entry; only while the job code step (Step 7) is running. */
export function timeWoJobCode(woUuid, entryId, action, user) {
  const wo = getWorkOrder(woUuid);
  assertWorkable(wo);
  const repair = wo.steps.find((s) => s.allow_add_sub);
  if (!repair?.started_at || repair.finished_at) throw new HttpError(409, `Job code timers run while Step ${repair?.step_no ?? 7} · ${repair?.step_name ?? 'Repair Process'} is in progress`);
  const entry = db.prepare('SELECT * FROM wo_job_codes WHERE id = ? AND wo_uuid = ?').get(entryId, woUuid);
  if (!entry) throw new HttpError(404, 'Job code entry not found');
  const ts = now();
  if (action === 'start') {
    if (entry.started_at) throw new HttpError(409, 'This job code has already started');
    db.prepare('UPDATE wo_job_codes SET started_at = ? WHERE id = ?').run(ts, entryId);
  } else if (action === 'finish') {
    if (!entry.started_at) throw new HttpError(409, 'Start this job code first');
    if (entry.finished_at) throw new HttpError(409, 'This job code is already finished');
    db.prepare('UPDATE wo_job_codes SET finished_at = ? WHERE id = ?').run(ts, entryId);
  } else {
    throw new HttpError(422, 'Unknown action');
  }
  db.prepare('UPDATE work_orders SET updated_at = ? WHERE wo_uuid = ?').run(ts, woUuid);
  return getWorkOrder(woUuid);
}

export function removeWoJobCode(woUuid, entryId, user) {
  const wo = getWorkOrder(woUuid);
  jobCodeGate(wo, user);
  if (!db.prepare('SELECT 1 FROM wo_job_codes WHERE id = ? AND wo_uuid = ?').get(entryId, woUuid)) throw new HttpError(404, 'Job code entry not found');
  db.prepare('DELETE FROM wo_job_codes WHERE id = ?').run(entryId);
  return getWorkOrder(woUuid);
}

export function addAdditionalWork(woUuid, name) {
  const wo = getWorkOrder(woUuid);
  assertWorkable(wo);
  const title = String(name ?? '').trim();
  if (title.length < 3) throw new HttpError(422, 'Additional work name is required');
  const { max } = db.prepare('SELECT MAX(step_no) AS max FROM wo_steps WHERE wo_uuid = ? AND parent_id IS NULL').get(woUuid);
  tx(() => {
    db.prepare('INSERT INTO wo_steps (wo_uuid, parent_id, step_no, step_name, is_additional) VALUES (?, NULL, ?, ?, 1)').run(
      woUuid, (max ?? 0) + 1, title);
    recomputeStatus(woUuid);
  });
  return getWorkOrder(woUuid);
}

export function dashboard(q = {}) {
  const { sql, params } = buildFilters({ created_start: q.start_date, created_end: q.end_date });
  const rows = db.prepare(`${LIST_SELECT}${sql}`).all(...params).map(decorate);
  const counts = { open: 0, on_progress: 0, waiting: 0, finish: 0 };
  for (const r of rows) {
    if (r.status === STATUS.OPEN) counts.open++;
    else if (r.status === STATUS.ON_PROGRESS) counts.on_progress++;
    else if (r.status === STATUS.WAITING) counts.waiting++;
    else if (r.status === STATUS.FINISH) counts.finish++;
  }
  const finished = rows.filter((r) => r.status === STATUS.FINISH);
  const totalTime = finished.reduce((sum, r) => sum + r.total_time, 0);
  const byCategory = {};
  for (const r of rows) byCategory[r.category || 'Uncategorized'] = (byCategory[r.category || 'Uncategorized'] || 0) + 1;
  return {
    total: rows.length,
    ...counts,
    total_time: totalTime,
    average_time: finished.length ? Math.round(totalTime / finished.length) : 0,
    pending_approval: rows.filter((r) => r.approval_status === APPROVAL.WAITING).length,
    by_category: Object.entries(byCategory).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}
