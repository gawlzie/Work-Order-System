import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, loadUser } from './db.js';
import { hasPermission, hashPassword, issueToken, publicUser, requireAuth, requirePermission, verifyPassword } from './auth.js';
import {
  assignableEmployees, createEmployee, createRole, createUnit, deleteEmployee, deleteRole, deleteUnit, getEmployee, getRole,
  getUnit, listEmployees, listRoles, listUnits, unitTypes, updateEmployee, updateRole, updateUnit,
  createCategory, deleteCategory, getCategory, listCategories, updateCategory,
  createJobCode, deleteJobCode, getJobCode, listJobCodes, updateJobCode,
  createStepTemplate, deleteStepTemplate, getStepTemplate, listStepTemplates, moveStepTemplate, updateStepTemplate,
} from './master.js';
import { PERMISSIONS } from './permissions.js';
import { MAX_PROOF_BYTES, addProof, deleteProof, getProofFile } from './proofs.js';
import { seed } from './seed.js';
import {
  APPROVAL, CHANNEL, HttpError, addAdditionalWork, addSubStep, addWoJobCode, removeWoJobCode, createWorkOrder, dashboard, deleteWorkOrder,
  getWorkOrder, listWorkOrders, progressStep, setApproval, syncStatuses, updateWorkOrder,
} from './workorders.js';

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
  return db.prepare(`SELECT * FROM units WHERE (unit_number LIKE ? OR unit_code LIKE ?) ${req.query.all ? '' : 'AND is_active = 1'} ORDER BY unit_code`).all(s, s);
}));

app.get('/api/master/employees', wrap((req) => assignableEmployees(req.query)));

app.get('/api/master/roles', wrap(() => db.prepare('SELECT id, code, name FROM roles ORDER BY name').all()));

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
  app.get(`/api/${path}`, guard, wrap((req) => list(req.query)));
  app.get(`/api/${path}/:id(\\d+)`, guard, wrap((req) => get(Number(req.params.id))));
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
crud('units', 'master.unit', { list: listUnits, get: getUnit, create: createUnit, update: updateUnit, remove: deleteUnit });
crud('categories', 'master.category', { list: listCategories, get: getCategory, create: createCategory, update: updateCategory, remove: deleteCategory });
crud('job-codes', 'master.job', { list: listJobCodes, get: getJobCode, create: createJobCode, update: updateJobCode, remove: deleteJobCode });
app.post('/api/steps/:id(\\d+)/move', requirePermission('master.step'), wrap((req) => moveStepTemplate(Number(req.params.id), req.body?.direction)));
crud('steps', 'master.step', { list: listStepTemplates, get: getStepTemplate, create: createStepTemplate, update: updateStepTemplate, remove: deleteStepTemplate });

/* ---------- Work orders ---------- */
app.get('/api/dashboard', wrap((req) => dashboard(req.query)));

app.get('/api/work-orders', wrap((req) => listWorkOrders(req.query)));

const CSV_COLUMNS = [
  ['wo_number', 'WO Number'], ['created_at', 'Created At'], ['unit_number', 'Unit'], ['driver_name', 'Driver'],
  ['mechanic_name', 'PIC Mechanic'], ['category', 'Category'], ['job_code_list', 'Job Codes'], ['job_standard_duration', 'Standard Duration (minutes, total)'], ['problem', 'Problem'], ['status', 'Status'],
  ['approval_status', 'Approval Status'], ['approval_remarks', 'Approval Remarks'], ['reject_reason', 'Reject Reason'], ['channel_source', 'Channel'], ['step_information', 'Step Information'],
  ['total_time', 'Total Time (minutes)'], ['proof_count', 'Proof Files'],
];
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

app.get('/api/work-orders/export', wrap((req, res) => {
  const { data } = listWorkOrders({ ...req.query, page: 1, limit: 500 });
  const lines = [CSV_COLUMNS.map(([, h]) => csvCell(h)).join(',')];
  for (const row of data) {
    lines.push(CSV_COLUMNS.map(([k]) => csvCell(k === 'total_time' ? Math.round(row.total_time / 60) : row[k])).join(','));
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

app.put('/api/work-orders/:id', requirePermission('wo.update'), wrap((req) => updateWorkOrder(req.params.id, req.body ?? {})));

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

// Job codes of a work order (Step 7): mechanics (wo.progress) while the step runs, approvers (wo.approve) after it started.
const canWorkJobs = (req, res, next) =>
  hasPermission(req.user, 'wo.progress') || hasPermission(req.user, 'wo.approve') ? next() : next(new HttpError(403, 'Forbidden for your role'));
app.post('/api/work-orders/:id/job-codes', canWorkJobs, wrap((req, res) => {
  res.status(201);
  return addWoJobCode(req.params.id, req.body ?? {}, req.user);
}));
app.delete('/api/work-orders/:id/job-codes/:entryId(\\d+)', canWorkJobs, wrap((req) => removeWoJobCode(req.params.id, Number(req.params.entryId), req.user)));

app.post('/api/work-orders/:id/additional-work', requirePermission('wo.progress'), wrap((req) =>
  addAdditionalWork(req.params.id, req.body?.name)));

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
