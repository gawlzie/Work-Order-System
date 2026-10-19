import { randomUUID } from 'node:crypto';
import { hasPermission } from './auth.js';
import { db, roleHas, tx } from './db.js';

export const STATUS = { OPEN: 'OPEN', ON_PROGRESS: 'ON_PROGRESS', WAITING: 'WAITING', FINISH: 'FINISH' };
export const APPROVAL = { WAITING: 'WAITING', APPROVE: 'APPROVE', APPROVE_BY_SYSTEM: 'APPROVE_BY_SYSTEM', REJECT: 'REJECT' };
export const CHANNEL = { WEB: 'WEB', MOBILE: 'MOBILE', WHATSAPP: 'WHATSAPP' };

/** Standard repair flow every new work order starts with. */
export const STEP_TEMPLATE = [
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
const isApproved = (wo) => wo.approval_status === APPROVAL.APPROVE || wo.approval_status === APPROVAL.APPROVE_BY_SYSTEM;

export function nextWoNumber(date = new Date()) {
  const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `WO-${ym}-`;
  const row = db
    .prepare('SELECT wo_number FROM work_orders WHERE wo_number LIKE ? ORDER BY wo_number DESC LIMIT 1')
    .get(`${prefix}%`);
  const seq = row ? Number(row.wo_number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function insertSteps(woUuid, template = STEP_TEMPLATE) {
  const insert = db.prepare(
    'INSERT INTO wo_steps (wo_uuid, parent_id, step_no, step_name, is_waiting) VALUES (?, ?, ?, ?, ?)',
  );
  template.forEach((step, i) => {
    const { lastInsertRowid } = insert.run(woUuid, null, i + 1, step.name, step.waiting ? 1 : 0);
    step.subs.forEach((sub, j) => insert.run(woUuid, lastInsertRowid, j + 1, sub, 0));
  });
}

/** Derive status, started_at and finished_at of a work order from its top-level steps. */
export function recomputeStatus(woUuid) {
  const steps = db
    .prepare('SELECT * FROM wo_steps WHERE wo_uuid = ? AND parent_id IS NULL ORDER BY step_no')
    .all(woUuid);
  const started = steps.filter((s) => s.started_at);
  let status = STATUS.OPEN;
  let startedAt = null;
  let finishedAt = null;
  if (started.length) {
    startedAt = started.map((s) => s.started_at).sort()[0];
    const current = steps.find((s) => s.started_at && !s.finished_at);
    if (steps.every((s) => s.finished_at)) {
      status = STATUS.FINISH;
      finishedAt = steps.map((s) => s.finished_at).sort().at(-1);
    } else {
      status = current?.is_waiting ? STATUS.WAITING : STATUS.ON_PROGRESS;
    }
  }
  db.prepare('UPDATE work_orders SET status = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE wo_uuid = ?').run(
    status,
    startedAt,
    finishedAt,
    now(),
    woUuid,
  );
}

const LIST_SELECT = `
  SELECT wo.*, u.unit_number, u.unit_code, u.unit_type,
         d.full_name AS driver_name, m.full_name AS mechanic_name,
         c.name AS category, cb.full_name AS created_by_name,
         (SELECT s.step_name FROM wo_steps s
            WHERE s.wo_uuid = wo.wo_uuid AND s.parent_id IS NULL AND s.started_at IS NOT NULL AND s.finished_at IS NULL
            ORDER BY s.step_no LIMIT 1) AS current_step
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
  if (!stepInfo) stepInfo = row.status === STATUS.FINISH ? 'Completed' : 'Not started';
  const { current_step, ...rest } = row;
  return { ...rest, step_information: stepInfo, total_time: totalSec };
}

const SORTABLE = ['wo_number', 'created_at', 'unit_number', 'driver_name', 'mechanic_name', 'status', 'approval_status', 'category', 'total_time'];

function buildFilters(q) {
  const where = [];
  const params = [];
  if (q.search) {
    where.push('(wo.wo_number LIKE ? OR u.unit_number LIKE ? OR d.full_name LIKE ? OR wo.problem LIKE ?)');
    const s = `%${q.search}%`;
    params.push(s, s, s, s);
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
  };
}

const assignable = (employeeId, permission) =>
  db.prepare(`SELECT 1 FROM employees e JOIN roles r ON r.id = e.role_id WHERE e.id = ? AND e.is_active = 1 AND ${roleHas()}`)
    .get(employeeId, permission);

/** Validates references. Values unchanged from `current` (the WO being edited) may point at since-deactivated records. */
function assertRefs({ unit_id, driver_id, mechanic_id, category_id }, current = {}) {
  if (!db.prepare('SELECT 1 FROM units WHERE id = ? AND (is_active = 1 OR id = ?)').get(unit_id, current.unit_id ?? null))
    throw new HttpError(422, 'Unit not found or inactive');
  if (driver_id !== current.driver_id && !assignable(driver_id, 'wo.as_driver')) throw new HttpError(422, 'Driver not found');
  if (mechanic_id && mechanic_id !== current.mechanic_id && !assignable(mechanic_id, 'wo.as_mechanic'))
    throw new HttpError(422, 'Mechanic not found');
  if (category_id && !db.prepare('SELECT 1 FROM repair_categories WHERE id = ?').get(category_id))
    throw new HttpError(422, 'Repair category not found');
}

function validatePayload(body) {
  const unit_id = Number(body.unit_id);
  const driver_id = Number(body.driver_id);
  const problem = String(body.problem ?? '').trim();
  const errors = {};
  if (!unit_id) errors.unit_id = 'Unit is required';
  if (!driver_id) errors.driver_id = 'Driver is required';
  if (problem.length < 5) errors.problem = 'Problem description must be at least 5 characters';
  if (problem.length > 1000) errors.problem = 'Problem description is too long (max 1000)';
  if (Object.keys(errors).length) {
    const err = new HttpError(422, 'Validation failed');
    err.errors = errors;
    throw err;
  }
  return {
    unit_id,
    driver_id,
    problem,
    mechanic_id: body.mechanic_id ? Number(body.mechanic_id) : null,
    category_id: body.category_id ? Number(body.category_id) : null,
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
  // Work orders raised by the plant admin on the web are trusted; field channels need approval.
  const approval = channel === CHANNEL.WEB ? APPROVAL.APPROVE_BY_SYSTEM : APPROVAL.WAITING;
  tx(() => {
    db.prepare(
      `INSERT INTO work_orders (wo_uuid, wo_number, unit_id, driver_id, mechanic_id, category_id, problem,
        status, approval_status, channel_source, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
    ).run(wo_uuid, nextWoNumber(), data.unit_id, data.driver_id, data.mechanic_id, data.category_id, data.problem,
      approval, channel, user.id, ts, ts);
    insertSteps(wo_uuid);
  });
  return getWorkOrder(wo_uuid);
}

export function updateWorkOrder(woUuid, body) {
  const wo = getWorkOrder(woUuid);
  if (wo.status === STATUS.FINISH) throw new HttpError(409, 'A finished work order cannot be edited');
  const data = validatePayload(body);
  assertRefs(data, wo);
  db.prepare(
    `UPDATE work_orders SET unit_id = ?, driver_id = ?, mechanic_id = ?, category_id = ?, problem = ?, updated_at = ?
     WHERE wo_uuid = ?`,
  ).run(data.unit_id, data.driver_id, data.mechanic_id, data.category_id, data.problem, now(), woUuid);
  return getWorkOrder(woUuid);
}

export function deleteWorkOrder(woUuid) {
  const wo = getWorkOrder(woUuid);
  if (wo.status !== STATUS.OPEN) throw new HttpError(409, 'Only work orders that have not started can be deleted');
  db.prepare('DELETE FROM work_orders WHERE wo_uuid = ?').run(woUuid);
}

export function setApproval(woUuid, action, reason) {
  const wo = getWorkOrder(woUuid);
  if (wo.approval_status !== APPROVAL.WAITING) throw new HttpError(409, 'This work order is not waiting for approval');
  if (action === APPROVAL.REJECT) {
    const text = String(reason ?? '').trim();
    if (text.length < 3) throw new HttpError(422, 'A reject reason is required');
    db.prepare('UPDATE work_orders SET approval_status = ?, reject_reason = ?, updated_at = ? WHERE wo_uuid = ?').run(
      APPROVAL.REJECT, text, now(), woUuid);
  } else if (action === APPROVAL.APPROVE) {
    db.prepare('UPDATE work_orders SET approval_status = ?, reject_reason = NULL, updated_at = ? WHERE wo_uuid = ?').run(
      APPROVAL.APPROVE, now(), woUuid);
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
  if (!isApproved(wo)) throw new HttpError(409, 'Work order must be approved before work can start');
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

export function addAdditionalWork(woUuid, name) {
  const wo = getWorkOrder(woUuid);
  if (!isApproved(wo)) throw new HttpError(409, 'Work order must be approved first');
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
