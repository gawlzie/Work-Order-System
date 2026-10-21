import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, loadUser } from './db.js';
import { hasPermission, hashPassword, issueToken, publicUser, requireAuth, requirePermission, verifyPassword } from './auth.js';
import {
  assignableEmployees, createEmployee, createRole, createUnit, deleteEmployee, deleteRole, deleteUnit, getEmployee, getRole,
  getUnit, listEmployees, listRoles, listUnits, unitModels, unitTypes, updateEmployee, updateRole, updateUnit,
  createCategory, deleteCategory, getCategory, listCategories, updateCategory,
  createJobCode, deleteJobCode, getJobCode, listJobCodes, updateJobCode,
  createSparepart, deleteSparepart, getSparepart, listSpareparts, updateSparepart, UOMS,
  createSite, deleteSite, getSite, listSites, updateSite,
  createStepTemplate, deleteStepTemplate, getStepTemplate, listStepTemplates, moveStepTemplate, updateStepTemplate,
} from './master.js';
import { PERMISSIONS } from './permissions.js';
import { MAX_PROOF_BYTES, addProof, deleteProof, getProofFile } from './proofs.js';
import { seed } from './seed.js';
import {
  APPROVAL, CHANNEL, HttpError, addAdditionalWork, addSubStep, addWoJobCode, removeWoJobCode, addWoJobPart, updateWoJobPart, removeWoJobPart, setWoJobCodeTimes, setWoCategory, timeWoJobCode, createWorkOrder, dashboard, deleteWorkOrder,
  activeStepTemplate, getWorkOrder, listWorkOrders, progressStep, setApproval, syncStatuses, updateWorkOrder,
} from './workorders.js';
import { listNotifications, markAllRead, markRead, scanOverdue } from './notifications.js';
import { canSeeWo, coversRole, siteCondition } from './scope.js';
import { applyOp } from './sync.js';

seed();
const resynced = syncStatuses();
if (resynced) console.log(`Updated the status of ${resynced} work order(s) to the current status rules`);

const app = express();
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) {
    next(err);
  }
};

/* ---------- Auth ---------- */
app.post('/api/auth/login', wrap((req, res) => {
  const { username, password } = req.body ?? {};
  const user = loadUser('e.username = ? AND e.is_active = 1', String(username ?? '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password ?? ''), user.password_hash)) {
    throw new HttpError(401, 'Invalid username or password');
  }
  return { token: issueToken(user.id), user: publicUser(user) };
}));

app.use('/api', requireAuth);

app.get('/api/auth/profile', wrap((req) => publicUser(req.user)));

app.post('/api/auth/change-password', wrap((req) => {
  const { current_password, new_password } = req.body ?? {};
  if (!verifyPassword(String(current_password ?? ''), req.user.password_hash)) throw new HttpError(422, 'Current password is incorrect');
  if (String(new_password ?? '').length < 8) throw new HttpError(422, 'New password must be at least 8 characters');
  db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  return { message: 'Password updated' };
}));

/* ---------- Master data lookups (dropdowns) ---------- */
app.get('/api/master/units', wrap((req) => {
  const s = `%${req.query.search ?? ''}%`;
  // Inactive units stay visible to filters (?all=1) but cannot be picked for new work orders.
  // Last recorded HM / KM per unit, shown as a hint on the WO form.
  const last = (col) => `(SELECT w.${col} FROM work_orders w WHERE w.unit_id = u.id AND w.${col} IS NOT NULL ORDER BY w.created_at DESC LIMIT 1)`;
  const scope = siteCondition(req.user, 'u.site');
  const lastWo = (col) => `(SELECT w.wo_number FROM work_orders w WHERE w.unit_id = u.id AND w.${col} IS NOT NULL ORDER BY w.created_at DESC LIMIT 1)`;
  return db.prepare(`SELECT u.*, ${last('hm')} AS last_hm, ${lastWo('hm')} AS last_hm_wo, ${last('km')} AS last_km, ${lastWo('km')} AS last_km_wo
                     FROM units u WHERE (u.unit_number LIKE ? OR u.unit_code LIKE ?) ${req.query.all ? '' : 'AND u.is_active = 1'} AND ${scope.sql}
                     ORDER BY u.unit_code`).all(s, s, ...scope.params);
}));

app.get('/api/master/employees', wrap((req) => assignableEmployees(req.query, req.user)));

// Only roles the user may hand out (no more rights than their own).
app.get('/api/master/roles', wrap((req) =>
  db.prepare('SELECT id, code, name, permissions FROM roles ORDER BY name').all()
    .filter((r) => coversRole(req.user, JSON.parse(r.permissions))).map(({ permissions, ...r }) => r)));
// Offline copies for the mechanic app: the steps a new work order gets, and every active spare part (compact).
app.get('/api/master/step-template', wrap(() => activeStepTemplate()));
app.get('/api/master/spareparts/all', wrap(() =>
  db.prepare('SELECT id, part_number, part_name, uom, brand, stock FROM spareparts WHERE is_active = 1 ORDER BY part_number').all()));
app.get('/api/master/spareparts', wrap((req) => {
  const s = `%${String(req.query.search ?? '').trim()}%`;
  return db.prepare(`SELECT id, part_number, part_name, uom, brand, stock FROM spareparts
                     WHERE is_active = 1 AND (part_number LIKE ? OR part_name LIKE ? OR IFNULL(brand, '') LIKE ?)
                     ORDER BY (part_number LIKE ?) DESC, part_number LIMIT 20`).all(s, s, s, `${String(req.query.search ?? '').trim()}%`);
}));
// Sites within the user's scope: Admin Company every site of the company, others their own site.
app.get('/api/master/sites', wrap((req) => {
  const scope = siteCondition(req.user, 'site_name');
  return db.prepare(`SELECT id, site_code, site_name, company, is_active FROM sites WHERE ${req.query.all ? '1' : 'is_active = 1'} AND ${scope.sql} ORDER BY site_name`)
    .all(...scope.params);
}));

// Inactive categories stay visible to filters (?all=1) but cannot be picked for new work orders.
// Job codes for the work order picker; inactive ones only with ?all=1 (filters).
app.get('/api/master/job-codes', wrap((req) =>
  db.prepare(`SELECT j.id, j.job_code, j.job_name, j.category_id, c.name AS category_name, j.standard_duration, j.is_active
              FROM job_codes j JOIN repair_categories c ON c.id = j.category_id
              ${req.query.all ? '' : 'WHERE j.is_active = 1 AND c.is_active = 1'} ORDER BY j.job_code`).all()));

app.get('/api/master/repair-categories', wrap((req) =>
  db.prepare(`SELECT id, name, is_active FROM repair_categories ${req.query.all ? '' : 'WHERE is_active = 1'} ORDER BY name`).all()));

/* ---------- Master data CRUD ---------- */
const crud = (path, permission, { list, get, create, update, remove }) => {
  const guard = requirePermission(permission);
  app.get(`/api/${path}`, guard, wrap((req) => list(req.query, req.user)));
  app.get(`/api/${path}/:id(\\d+)`, guard, wrap((req) => get(Number(req.params.id), req.user)));
  app.post(`/api/${path}`, guard, wrap((req, res) => {
    res.status(201);
    return create(req.body ?? {}, req.user);
  }));
  app.put(`/api/${path}/:id(\\d+)`, guard, wrap((req) => update(Number(req.params.id), req.body ?? {}, req.user)));
  app.delete(`/api/${path}/:id(\\d+)`, guard, wrap((req) => {
    remove(Number(req.params.id), req.user);
    return { message: 'Deleted' };
  }));
};

app.get('/api/roles/permissions', requirePermission('master.role'), wrap(() => PERMISSIONS));
crud('roles', 'master.role', { list: listRoles, get: getRole, create: createRole, update: updateRole, remove: deleteRole });
crud('employees', 'master.employee', { list: listEmployees, get: getEmployee, create: createEmployee, update: updateEmployee, remove: deleteEmployee });
app.get('/api/units/types', requirePermission('master.unit'), wrap(() => unitTypes()));
app.get('/api/units/models', requirePermission('master.unit'), wrap(() => unitModels()));
crud('units', 'master.unit', { list: listUnits, get: getUnit, create: createUnit, update: updateUnit, remove: deleteUnit });
crud('categories', 'master.category', { list: listCategories, get: getCategory, create: createCategory, update: updateCategory, remove: deleteCategory });
crud('job-codes', 'master.job', { list: listJobCodes, get: getJobCode, create: createJobCode, update: updateJobCode, remove: deleteJobCode });
crud('sites', 'master.site', { list: listSites, get: getSite, create: createSite, update: updateSite, remove: deleteSite });
app.get('/api/spareparts/uoms', requirePermission('master.sparepart'), wrap(() => UOMS));
crud('spareparts', 'master.sparepart', { list: listSpareparts, get: getSparepart, create: createSparepart, update: updateSparepart, remove: deleteSparepart });
app.post('/api/steps/:id(\\d+)/move', requirePermission('master.step'), wrap((req) => moveStepTemplate(Number(req.params.id), req.body?.direction)));
crud('steps', 'master.step', { list: listStepTemplates, get: getStepTemplate, create: createStepTemplate, update: updateStepTemplate, remove: deleteStepTemplate });

/* ---------- Work orders ---------- */
app.get('/api/dashboard', wrap((req) => dashboard(req.query, req.user)));

app.get('/api/work-orders', wrap((req) => listWorkOrders(req.query, req.user)));

// A work order outside the user's site scope does not exist for them.
app.use('/api/work-orders/:id', (req, res, next) => {
  const exists = db.prepare('SELECT 1 FROM work_orders WHERE wo_uuid = ?').get(req.params.id);
  next(exists && !canSeeWo(req.user, req.params.id) ? new HttpError(404, 'Work order not found') : undefined);
});

const CSV_COLUMNS = [
  ['wo_number', 'WO Number'], ['created_at', 'Created At'], ['site', 'Site'], ['maintenance_label', 'Type of Maintenance'], ['unit_number', 'Unit'], ['driver_name', 'Driver'],
  ['mechanic_name', 'PIC Mechanic'], ['hm', 'HM'], ['km', 'KM'], ['category', 'Category'], ['job_code_list', 'Job Codes'], ['part_list', 'Spare Parts'], ['job_standard_duration', 'Standard Duration (h:mm:ss, total)'], ['problem', 'Problem'], ['status', 'Status'],
  ['approval_status', 'Approval Status'], ['approval_remarks', 'Approval Remarks'], ['reject_reason', 'Reject Reason'], ['channel_source', 'Channel'], ['step_information', 'Step Information'],
  ['total_time', 'Total Time (h:mm:ss)'], ['proof_count', 'Proof Files'],
];
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
/** Seconds -> "h:mm:ss" for the CSV export. */
const hms = (seconds) => {
  if (seconds == null) return '';
  const t = Math.max(0, Math.round(seconds));
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

app.get('/api/work-orders/export', wrap((req, res) => {
  const { data } = listWorkOrders({ ...req.query, page: 1, limit: 500 }, req.user);
  const lines = [CSV_COLUMNS.map(([, h]) => csvCell(h)).join(',')];
  for (const row of data) {
    const maintenance = { PREVENTIVE: 'Preventive Maintenance', REPAIR: 'Repair', WARRANTY: 'Warranty', PDI: 'PDI', OTHERS: `Others: ${row.maintenance_other ?? ''}` }[row.maintenance_type] ?? '';
    lines.push(CSV_COLUMNS.map(([k]) => csvCell(k === 'maintenance_label' ? maintenance : k === 'total_time' ? hms(row.total_time) : k === 'job_standard_duration' ? hms(row.job_standard_duration == null ? null : row.job_standard_duration * 60) : row[k])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="work-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
}));

app.get('/api/work-orders/:id', wrap((req) => getWorkOrder(req.params.id)));

app.post('/api/work-orders', requirePermission('wo.create'), wrap((req, res) => {
  // The channel records where the WO came from; every WO still needs approval.
  const channel = hasPermission(req.user, 'wo.approve') ? CHANNEL.WEB : CHANNEL.MOBILE;
  res.status(201);
  return createWorkOrder(req.body ?? {}, req.user, channel);
}));

app.put('/api/work-orders/:id', requirePermission('wo.update'), wrap((req) => updateWorkOrder(req.params.id, req.body ?? {}, req.user)));

app.delete('/api/work-orders/:id', requirePermission('wo.delete'), wrap((req) => {
  deleteWorkOrder(req.params.id);
  return { message: 'Deleted' };
}));

app.post('/api/work-orders/:id/approval', requirePermission('wo.approve'), wrap((req) => {
  const { action, reason, remarks } = req.body ?? {};
  return setApproval(req.params.id, action === 'REJECT' ? APPROVAL.REJECT : action === 'APPROVE' ? APPROVAL.APPROVE : action, { reason, remarks });
}));

app.post('/api/work-orders/:id/steps/:stepId/:action(start|finish)', requirePermission('wo.progress'), wrap((req) =>
  progressStep(req.params.id, Number(req.params.stepId), req.params.action, req.user, req.body?.remarks)));

app.post('/api/work-orders/:id/steps/:stepId(\\d+)/sub-steps', requirePermission('wo.progress'), wrap((req) =>
  addSubStep(req.params.id, Number(req.params.stepId), req.body?.name)));

/* ---------- Proof of completion (finished work orders) ---------- */
app.get('/api/work-orders/:id/proofs/:proofId(\\d+)', wrap((req, res) => {
  const file = getProofFile(req.params.id, Number(req.params.proofId));
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
  res.sendFile(file.path, (err) => {
    if (err && !res.headersSent) res.status(404).json({ message: 'Proof file not found' });
  });
}));

// The file is the raw request body; its name comes in the X-File-Name header (URI-encoded).
app.post('/api/work-orders/:id/proofs', requirePermission('wo.approve'), express.raw({ type: () => true, limit: MAX_PROOF_BYTES }), wrap((req, res) => {
  res.status(201);
  return addProof(req.params.id, { body: req.body, fileName: req.get('X-File-Name') }, req.user);
}));

app.delete('/api/work-orders/:id/proofs/:proofId(\\d+)', requirePermission('wo.approve'), wrap((req) =>
  deleteProof(req.params.id, Number(req.params.proofId))));

// Repair category and job codes of a work order (Step 7): mechanics (wo.progress) while the step runs, approvers (wo.approve) after it started.
const canWorkJobs = (req, res, next) =>
  hasPermission(req.user, 'wo.progress') || hasPermission(req.user, 'wo.approve') ? next() : next(new HttpError(403, 'Forbidden for your role'));
app.put('/api/work-orders/:id/category', canWorkJobs, wrap((req) => setWoCategory(req.params.id, req.body ?? {}, req.user)));
app.post('/api/work-orders/:id/job-codes', canWorkJobs, wrap((req, res) => {
  res.status(201);
  return addWoJobCode(req.params.id, req.body ?? {}, req.user);
}));
app.post('/api/work-orders/:id/job-codes/:entryId(\\d+)/:action(start|finish)', requirePermission('wo.progress'), wrap((req) =>
  timeWoJobCode(req.params.id, Number(req.params.entryId), req.params.action, req.user)));
app.put('/api/work-orders/:id/job-codes/:entryId(\\d+)', requirePermission('wo.approve'), wrap((req) =>
  setWoJobCodeTimes(req.params.id, Number(req.params.entryId), req.body ?? {}, req.user)));
app.delete('/api/work-orders/:id/job-codes/:entryId(\\d+)', canWorkJobs, wrap((req) => removeWoJobCode(req.params.id, Number(req.params.entryId), req.user)));
// Spare parts per job code entry.
app.post('/api/work-orders/:id/job-codes/:entryId(\\d+)/parts', canWorkJobs, wrap((req, res) => {
  res.status(201);
  return addWoJobPart(req.params.id, Number(req.params.entryId), req.body ?? {}, req.user);
}));
app.put('/api/work-orders/:id/job-codes/:entryId(\\d+)/parts/:lineId(\\d+)', canWorkJobs, wrap((req) =>
  updateWoJobPart(req.params.id, Number(req.params.entryId), Number(req.params.lineId), req.body ?? {}, req.user)));
app.delete('/api/work-orders/:id/job-codes/:entryId(\\d+)/parts/:lineId(\\d+)', canWorkJobs, wrap((req) =>
  removeWoJobPart(req.params.id, Number(req.params.entryId), Number(req.params.lineId), req.user)));

app.post('/api/work-orders/:id/additional-work', requirePermission('wo.progress'), wrap((req) =>
  addAdditionalWork(req.params.id, req.body?.name)));

/* ---------- Offline sync (mechanic app outbox) ---------- */
app.post('/api/sync', wrap((req) => applyOp(req.body ?? {}, req.user)));

/* ---------- Notifications (own only) ---------- */
app.get('/api/notifications', wrap((req) => listNotifications(req.user, req.query)));
app.post('/api/notifications/read-all', wrap((req) => markAllRead(req.user)));
app.post('/api/notifications/:id(\\d+)/read', wrap((req) => markRead(req.user, Number(req.params.id))));

app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));

/* ---------- Static client (production build) ---------- */
const clientDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, errors: err.errors });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'File is too large (max 10 MB)' });
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => console.log(`WOS API listening on http://localhost:${PORT}`));

// Work orders open for more than a day are reported once; checked on start and every 5 minutes.
const overdueCheck = () => {
  try {
    const n = scanOverdue();
    if (n) console.log(`Reported ${n} work order(s) open for more than 1 day`);
  } catch (err) {
    console.error('Overdue check failed:', err.message);
  }
};
overdueCheck();
setInterval(overdueCheck, 5 * 60 * 1000).unref();
