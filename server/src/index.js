import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { allowRoles, hashPassword, issueToken, publicUser, requireAuth, verifyPassword } from './auth.js';
import { seed } from './seed.js';
import {
  APPROVAL, CHANNEL, HttpError, addAdditionalWork, createWorkOrder, dashboard, deleteWorkOrder,
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
  const user = db.prepare('SELECT * FROM employees WHERE username = ? AND is_active = 1').get(String(username ?? '').trim().toLowerCase());
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

/* ---------- Master data ---------- */
app.get('/api/master/units', wrap((req) => {
  const s = `%${req.query.search ?? ''}%`;
  return db.prepare('SELECT * FROM units WHERE unit_number LIKE ? OR unit_code LIKE ? ORDER BY unit_code').all(s, s);
}));

app.get('/api/master/employees', wrap((req) => {
  const s = `%${req.query.search ?? ''}%`;
  const role = req.query.role;
  const sql = `SELECT id, employee_id, full_name, role FROM employees
               WHERE is_active = 1 AND (full_name LIKE ? OR employee_id LIKE ?) ${role ? 'AND role = ?' : ''} ORDER BY full_name`;
  return db.prepare(sql).all(...(role ? [s, s, role] : [s, s]));
}));

app.get('/api/master/repair-categories', wrap(() => db.prepare('SELECT * FROM repair_categories ORDER BY name').all()));

/* ---------- Work orders ---------- */
app.get('/api/dashboard', wrap((req) => dashboard(req.query)));

app.get('/api/work-orders', wrap((req) => listWorkOrders(req.query)));

const CSV_COLUMNS = [
  ['wo_number', 'WO Number'], ['created_at', 'Created At'], ['unit_number', 'Unit'], ['driver_name', 'Driver'],
  ['mechanic_name', 'PIC Mechanic'], ['category', 'Category'], ['problem', 'Problem'], ['status', 'Status'],
  ['approval_status', 'Approval Status'], ['channel_source', 'Channel'], ['step_information', 'Step Information'],
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

app.post('/api/work-orders', allowRoles('admin', 'mechanic'), wrap((req, res) => {
  const channel = req.user.role === 'admin' ? CHANNEL.WEB : CHANNEL.MOBILE;
  res.status(201);
  return createWorkOrder(req.body ?? {}, req.user, channel);
}));

app.put('/api/work-orders/:id', allowRoles('admin'), wrap((req) => updateWorkOrder(req.params.id, req.body ?? {})));

app.delete('/api/work-orders/:id', allowRoles('admin'), wrap((req) => {
  deleteWorkOrder(req.params.id);
  return { message: 'Deleted' };
}));

app.post('/api/work-orders/:id/approval', allowRoles('admin'), wrap((req) => {
  const { action, reason } = req.body ?? {};
  return setApproval(req.params.id, action === 'REJECT' ? APPROVAL.REJECT : action === 'APPROVE' ? APPROVAL.APPROVE : action, reason);
}));

app.post('/api/work-orders/:id/steps/:stepId/:action(start|finish)', allowRoles('admin', 'mechanic'), wrap((req) =>
  progressStep(req.params.id, Number(req.params.stepId), req.params.action, req.user, req.body?.remarks)));

app.post('/api/work-orders/:id/additional-work', allowRoles('admin', 'mechanic'), wrap((req) =>
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
