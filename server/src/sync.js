/**
 * Offline sync for the mechanic app. The app keeps every action in an outbox on the phone and sends them here one by
 * one, in the order they were done, once it has signal. Each operation:
 *   { op_id, type, wo_uuid, at, ...fields }
 * - op_id: unique per action (uuid); an op that was applied before is not applied again (safe to resend).
 * - at: when the mechanic did it on the phone; step and job code times use it instead of the time of the sync.
 * - Things created offline have no server id yet, so later ops point at them by the phone's reference: a step by
 *   step_no or step_ref, a job code entry by entry_ref and a spare part line by line_ref (stored as client_ref).
 * The same rules as the normal endpoints apply; an op that breaks them (e.g. someone else already took the step) is
 * refused with the reason, and the app shows it to the mechanic.
 */
import { hasPermission } from './auth.js';
import { db } from './db.js';
import {
  CHANNEL, HttpError, addAdditionalWork, addWoJobCode, addWoJobPart, createWorkOrder, getWorkOrder, progressStep, removeWoJobCode,
  removeWoJobPart, setWoCategory, timeWoJobCode, updateWoJobPart,
} from './workorders.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[0-9a-zA-Z_-]{8,64}$/;
const MAX_AGE_DAYS = 30;

/** The phone's action time: not in the future (a little clock difference is allowed) and at most 30 days old. */
function actionTime(at) {
  if (at == null || at === '') return new Date().toISOString();
  const t = Date.parse(String(at));
  if (Number.isNaN(t)) throw new HttpError(422, 'Invalid action time');
  if (t > Date.now() + 5 * 60 * 1000) return new Date().toISOString();
  if (t < Date.now() - MAX_AGE_DAYS * 86400000) throw new HttpError(422, `Action is older than ${MAX_AGE_DAYS} days and cannot be synchronized`);
  return new Date(t).toISOString();
}

const need = (user, ...permissions) => {
  if (!permissions.some((p) => hasPermission(user, p))) throw new HttpError(403, 'Forbidden for your role');
};

function stepId(woUuid, op) {
  const row = op.step_ref
    ? db.prepare('SELECT id FROM wo_steps WHERE wo_uuid = ? AND client_ref = ? AND parent_id IS NULL').get(woUuid, String(op.step_ref))
    : op.step_no != null
      ? db.prepare('SELECT id FROM wo_steps WHERE wo_uuid = ? AND step_no = ? AND parent_id IS NULL').get(woUuid, Number(op.step_no))
      : db.prepare('SELECT id FROM wo_steps WHERE wo_uuid = ? AND id = ?').get(woUuid, Number(op.step_id));
  if (!row) throw new HttpError(404, 'Step not found on this work order');
  return row.id;
}

function entryId(woUuid, op) {
  const row = op.entry_ref
    ? db.prepare('SELECT id FROM wo_job_codes WHERE wo_uuid = ? AND client_ref = ?').get(woUuid, String(op.entry_ref))
    : db.prepare('SELECT id FROM wo_job_codes WHERE wo_uuid = ? AND id = ?').get(woUuid, Number(op.entry_id));
  if (!row) throw new HttpError(404, 'Job code entry not found (it may have been removed)');
  return row.id;
}

function lineId(entry, op) {
  const row = op.line_ref
    ? db.prepare('SELECT id FROM wo_job_parts WHERE wo_job_code_id = ? AND client_ref = ?').get(entry, String(op.line_ref))
    : db.prepare('SELECT id FROM wo_job_parts WHERE wo_job_code_id = ? AND id = ?').get(entry, Number(op.line_id));
  if (!row) throw new HttpError(404, 'Spare part line not found (it may have been removed)');
  return row.id;
}

const ref = (v) => {
  if (v == null) return null;
  if (!REF.test(String(v))) throw new HttpError(422, 'Invalid reference');
  return String(v);
};

/** Applies one outbox operation for `user`; returns the work order as it is now. */
export function applyOp(op, user) {
  const opId = String(op?.op_id ?? '');
  if (!UUID.test(opId)) throw new HttpError(422, 'op_id must be a uuid');
  const woUuid = String(op.wo_uuid ?? '');
  if (!UUID.test(woUuid)) throw new HttpError(422, 'wo_uuid must be a uuid');
  const done = db.prepare('SELECT 1 FROM sync_ops WHERE op_id = ?').get(opId);
  if (done) return { duplicate: true, work_order: getWorkOrder(woUuid) };

  const at = actionTime(op.at);
  const opts = { at };
  let wo;
  switch (op.type) {
    case 'wo.create':
      need(user, 'wo.create');
      wo = createWorkOrder(op.body ?? {}, user, CHANNEL.MOBILE, { ...opts, wo_uuid: woUuid });
      break;
    case 'step.start':
    case 'step.finish':
      need(user, 'wo.progress');
      wo = progressStep(woUuid, stepId(woUuid, op), op.type === 'step.start' ? 'start' : 'finish', user, op.remarks, opts);
      break;
    case 'work.add':
      need(user, 'wo.progress');
      wo = addAdditionalWork(woUuid, op.name, { client_ref: ref(op.step_ref) });
      break;
    case 'category.set':
      need(user, 'wo.progress', 'wo.approve');
      wo = setWoCategory(woUuid, { category_id: op.category_id }, user);
      break;
    case 'job.add':
      need(user, 'wo.progress', 'wo.approve');
      wo = addWoJobCode(woUuid, { job_code_id: op.job_code_id, mechanic_id: op.mechanic_id }, user, { ...opts, client_ref: ref(op.entry_ref) });
      break;
    case 'job.start':
    case 'job.finish':
      need(user, 'wo.progress');
      wo = timeWoJobCode(woUuid, entryId(woUuid, op), op.type === 'job.start' ? 'start' : 'finish', user, opts);
      break;
    case 'job.remove':
      need(user, 'wo.progress', 'wo.approve');
      wo = removeWoJobCode(woUuid, entryId(woUuid, op), user);
      break;
    case 'part.add': {
      need(user, 'wo.progress', 'wo.approve');
      // Phones on the older app still send a picked master part; it is added under that part's name and unit.
      const picked = op.part_name == null && op.sparepart_id != null
        ? db.prepare('SELECT part_name, uom FROM spareparts WHERE id = ?').get(Number(op.sparepart_id)) : null;
      wo = addWoJobPart(woUuid, entryId(woUuid, op), { part_name: picked?.part_name ?? op.part_name, uom: picked?.uom ?? op.uom, qty: op.qty }, user,
        { ...opts, client_ref: ref(op.line_ref) });
      break;
    }
    case 'part.update': {
      need(user, 'wo.progress', 'wo.approve');
      const entry = entryId(woUuid, op);
      wo = updateWoJobPart(woUuid, entry, lineId(entry, op), { qty: op.qty, part_name: op.part_name, uom: op.uom }, user);
      break;
    }
    case 'part.remove': {
      need(user, 'wo.progress', 'wo.approve');
      const entry = entryId(woUuid, op);
      wo = removeWoJobPart(woUuid, entry, lineId(entry, op), user);
      break;
    }
    default:
      throw new HttpError(422, `Unknown operation ${String(op.type)}`);
  }
  db.prepare('INSERT INTO sync_ops (op_id, user_id, type, wo_uuid, done_at, applied_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(opId, user.id, String(op.type), woUuid, at, new Date().toISOString());
  return { duplicate: false, work_order: wo };
}
