/**
 * In-app notifications, one row per recipient. Three events:
 * Approvers are those of the work order's site (Admin Site there) plus Admin Company.
 * - WO_CREATED: approvers and the mechanics at the work order's site (a new job there);
 * - WO_FINISHED: approvers and whoever raised the work order;
 * - WO_OVERDUE: a work order still open (not finished, not rejected) more than 1 day after it was raised, once per
 *   work order: approvers and its PIC mechanic.
 * Only active employees with a user account receive them, never the person who caused the event. The text is built
 * by the client from `type` and `data`, so it shows in the reader's language.
 */
import { db, roleHas } from './db.js';
import { ALL_SITES, woCondition } from './scope.js';

export const NOTIFICATION = { CREATED: 'WO_CREATED', FINISHED: 'WO_FINISHED', OVERDUE: 'WO_OVERDUE' };
export const OVERDUE_HOURS = 24;

const now = () => new Date().toISOString();

/** Active employees with an account whose role has `permission`, optionally limited by an extra condition. */
const withPermission = (permission, extra = '', ...params) =>
  db.prepare(`SELECT e.id FROM employees e JOIN roles r ON r.id = e.role_id
              WHERE e.is_active = 1 AND e.username IS NOT NULL AND ${roleHas('r')} ${extra}`).all(permission, ...params).map((r) => r.id);

function recipients(type, wo) {
  // Approvers of the work order's site: Admin Company (every site) and the Admin Site placed there.
  const ids = new Set(withPermission('wo.approve', `AND (${roleHas('r')} OR e.site = ? COLLATE NOCASE)`, ALL_SITES, wo.site ?? ''));
  if (type === NOTIFICATION.CREATED && wo.site) for (const id of withPermission('wo.as_mechanic', 'AND e.site = ? COLLATE NOCASE', wo.site)) ids.add(id);
  if (type === NOTIFICATION.FINISHED && wo.created_by) ids.add(wo.created_by);
  if (type === NOTIFICATION.OVERDUE && wo.mechanic_id) ids.add(wo.mechanic_id);
  // Only people who can log in.
  return [...ids].filter((id) => db.prepare('SELECT 1 FROM employees WHERE id = ? AND is_active = 1 AND username IS NOT NULL').get(id));
}

/** Sends `type` for a work order to its recipients; `actorId` (who caused it) is left out. Returns the number sent. */
export function notify(type, woUuid, { actorId = null } = {}) {
  const wo = db.prepare(`SELECT w.wo_uuid, w.wo_number, w.site, w.problem, w.created_by, w.mechanic_id, w.created_at, u.unit_number
                         FROM work_orders w JOIN units u ON u.id = w.unit_id WHERE w.wo_uuid = ?`).get(woUuid);
  if (!wo) return 0;
  const data = JSON.stringify({
    wo_number: wo.wo_number,
    unit_number: wo.unit_number,
    site: wo.site,
    problem: wo.problem.length > 90 ? `${wo.problem.slice(0, 87)}...` : wo.problem,
    hours: Math.floor((Date.now() - Date.parse(wo.created_at)) / 3600000),
  });
  const ins = db.prepare('INSERT INTO notifications (user_id, type, wo_uuid, actor_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const ts = now();
  let sent = 0;
  for (const userId of recipients(type, wo)) {
    if (userId === actorId) continue;
    ins.run(userId, type, woUuid, actorId, data, ts);
    sent++;
  }
  return sent;
}

/** Work orders open for more than a day that were not reported yet; sends WO_OVERDUE for each. Returns their count. */
export function scanOverdue() {
  const cutoff = new Date(Date.now() - OVERDUE_HOURS * 3600000).toISOString();
  const due = db.prepare(`SELECT w.wo_uuid FROM work_orders w
                          WHERE w.status != 'FINISH' AND w.approval_status != 'REJECT' AND w.created_at <= ?
                            AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.wo_uuid = w.wo_uuid AND n.type = ?)
                          ORDER BY w.created_at`).all(cutoff, NOTIFICATION.OVERDUE);
  for (const { wo_uuid } of due) notify(NOTIFICATION.OVERDUE, wo_uuid);
  return due.length;
}

/** The user's latest notifications plus how many are unread; only for work orders still within their site scope. */
export function listNotifications(user, q = {}) {
  const userId = user.id;
  const scope = woCondition(user);
  const visible = `EXISTS (SELECT 1 FROM work_orders wo WHERE wo.wo_uuid = n.wo_uuid AND ${scope.sql})`;
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 30));
  const rows = db.prepare(`SELECT n.id, n.type, n.wo_uuid, n.data, n.created_at, n.read_at, a.full_name AS actor_name
                           FROM notifications n LEFT JOIN employees a ON a.id = n.actor_id
                           WHERE n.user_id = ? AND ${visible} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`).all(userId, ...scope.params, limit);
  const unread = db.prepare(`SELECT COUNT(*) AS n FROM notifications n WHERE n.user_id = ? AND n.read_at IS NULL AND ${visible}`).get(userId, ...scope.params).n;
  return { data: rows.map((r) => ({ ...r, data: JSON.parse(r.data) })), unread };
}

export function markRead(user, id) {
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(now(), id, user.id);
  return listNotifications(user);
}

export function markAllRead(user) {
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), user.id);
  return listNotifications(user);
}
