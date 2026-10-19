import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, loadUser } from './db.js';
import { hasPermission, hashPassword, issueToken, publicUser, requireAuth, requirePermission, verifyPassword } from './auth.js';
import {
  assignableEmployees, createEmployee, createRole, createUnit, deleteEmployee, deleteRole, deleteUnit, getEmployee, getRole,
  getUnit, listEmployees, listRoles, listUnits, unitTypes, updateEmployee, updateRole, updateUnit,
  createStepTemplate, deleteStepTemplate, getStepTemplate, listStepTemplates, moveStepTemplate, updateStepTemplate,
} from './master.js';
import { PERMISSIONS } from './permissions.js';
import { seed } from './seed.js';
import {
  APPROVAL, CHANNEL, HttpError, addAdditionalWork, addSubStep, createWorkOrder, dashboard, deleteWorkOrder,
  getWorkOrder, listWorkOrders, progressStep, setApproval, updateWorkOrder,
} from './workorders.js';

seed();

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

app.get('/api/master/repair-categories', wrap(() => db.prepare('SELECT * FROM repair_categories ORDER BY name').all()));

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
app.post('/api/steps/:id(\\d+)/move', requirePermission('master.step'), wrap((req) => moveStepTemplate(Number(req.params.id), req.body?.direction)));
crud('steps', 'master.step', { list: listStepTemplates, get: getStepTemplate, create: createStepTemplate, update: updateStepTemplate, remove: deleteStepTemplate });

/* ---------- Work orders ---------- */
app.get('/api/dashboard', wrap((req) => dashboard(req.query)));

app.get('/api/work-orders', wrap((req) => listWorkOrders(req.query)));

const CSV_COLUMNS = [
  ['wo_number', 'WO Number'], ['created_at', 'Created At'], ['unit_number', 'Unit'], ['driver_name', 'Driver'],
  ['mechanic_name', 'PIC Mechanic'], ['category', 'Category'], ['problem', 'Problem'], ['status', 'Status'],
  ['approval_status', 'Approval Status'], ['approval_remarks', 'Approval Remarks'], ['reject_reason', 'Reject Reason'], ['channel_source', 'Channel'], ['step_information', 'Step Information'],
  ['total_time', 'Total Time (minutes)'],
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
  // Users who may approve work orders are trusted, so their own WOs are approved by the system.
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
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => console.log(`WOS API listening on http://localhost:${PORT}`));
