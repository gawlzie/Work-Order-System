import { hashPassword } from './auth.js';
import { db, roleHas } from './db.js';
import { ADMIN_PERMISSIONS, PERMISSION_KEYS } from './permissions.js';
import { HttpError } from './workorders.js';

/* ---------- Shared helpers ---------- */

const str = (v) => String(v ?? '').trim();
const optional = (v) => str(v) || null;
const flag = (v, fallback = 1) => (v === undefined ? fallback : v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function fail(errors) {
  if (!Object.keys(errors).length) return;
  const err = new HttpError(422, 'Validation failed');
  err.errors = errors;
  throw err;
}

function paging(q) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 10));
  return { page, limit, offset: (page - 1) * limit };
}

/** Runs a paged SELECT built from `from` (FROM ... WHERE ...) and returns { data, meta }. */
function pagedQuery({ select, from, params, order, q }) {
  const { page, limit, offset } = paging(q);
  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params).n;
  const data = db.prepare(`SELECT ${select} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { data, meta: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Picks a whitelisted ORDER BY from ?sort_by / ?sort_order. */
function orderBy(q, sortable, fallback) {
  const col = sortable[q.sort_by] ?? sortable[fallback];
  return `${col} ${q.sort_order === 'desc' ? 'DESC' : 'ASC'}`;
}

const taken = (table, column, value, exceptId) =>
  !!db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? COLLATE NOCASE AND id != ?`).get(value, exceptId ?? 0);

/* ---------- Roles ---------- */

const decodeRole = (r) => r && { ...r, permissions: JSON.parse(r.permissions) };

export function listRoles(q = {}) {
  const s = `%${str(q.search)}%`;
  const out = pagedQuery({
    select: 'r.*, (SELECT COUNT(*) FROM employees e WHERE e.role_id = r.id) AS employee_count',
    from: 'FROM roles r WHERE (r.code LIKE ? OR r.name LIKE ?)',
    params: [s, s],
    order: orderBy(q, { code: 'r.code', name: 'r.name', employee_count: 'employee_count' }, 'name'),
    q,
  });
  return { ...out, data: out.data.map(decodeRole) };
}

export function getRole(id) {
  const role = decodeRole(db.prepare('SELECT * FROM roles WHERE id = ?').get(id));
  if (!role) throw new HttpError(404, 'Role not found');
  return role;
}

function validateRole(body, existing) {
  const errors = {};
  const code = existing?.is_system ? existing.code : str(body.code).toLowerCase();
  const name = str(body.name);
  const permissions = [...new Set(Array.isArray(body.permissions) ? body.permissions : [])];
  if (!/^[a-z0-9_]{2,30}$/.test(code)) errors.code = 'Code must be 2-30 characters: a-z, 0-9 or _';
  else if (taken('roles', 'code', code, existing?.id)) errors.code = 'Code is already used';
  if (name.length < 2 || name.length > 60) errors.name = 'Name must be 2-60 characters';
  else if (taken('roles', 'name', name, existing?.id)) errors.name = 'Name is already used';
  const unknown = permissions.filter((p) => !PERMISSION_KEYS.includes(p));
  if (unknown.length) errors.permissions = `Unknown permission: ${unknown.join(', ')}`;
  fail(errors);
  return {
    code,
    name,
    description: optional(body.description),
    // The admin role is the recovery path for every other setting, so it always keeps full access.
    permissions: PERMISSION_KEYS.filter((p) => permissions.includes(p) || (existing?.code === 'admin' && ADMIN_PERMISSIONS.includes(p))),
  };
}

export function createRole(body) {
  const data = validateRole(body);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO roles (code, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 0)')
    .run(data.code, data.name, data.description, JSON.stringify(data.permissions));
  return getRole(lastInsertRowid);
}

export function updateRole(id, body, user) {
  const existing = getRole(id);
  const data = validateRole(body, existing);
  if (existing.id === user.role_id && !data.permissions.includes('master.role'))
    throw new HttpError(409, 'You cannot remove "Manage roles" from your own role');
  db.prepare('UPDATE roles SET code = ?, name = ?, description = ?, permissions = ? WHERE id = ?')
    .run(data.code, data.name, data.description, JSON.stringify(data.permissions), id);
  return getRole(id);
}

export function deleteRole(id) {
  const role = getRole(id);
  if (role.is_system) throw new HttpError(409, 'Built-in roles cannot be deleted');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM employees WHERE role_id = ?').get(id);
  if (n) throw new HttpError(409, `Role is assigned to ${n} employee(s). Move them to another role first`);
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
}

/* ---------- Employees ---------- */

const EMPLOYEE_COLUMNS = `e.id, e.employee_id, e.full_name, e.role_id, r.code AS role, r.name AS role_name, e.company, e.site,
  e.phone, e.email, e.username, e.username IS NOT NULL AS has_account, e.is_active`;

export function listEmployees(q = {}) {
  const s = `%${str(q.search)}%`;
  const where = ['(e.employee_id LIKE ? OR e.full_name LIKE ? OR IFNULL(e.username, \'\') LIKE ?)'];
  const params = [s, s, s];
  if (q.role_id) {
    where.push('e.role_id = ?');
    params.push(Number(q.role_id));
  }
  if (q.status === 'active' || q.status === 'inactive') where.push(`e.is_active = ${q.status === 'active' ? 1 : 0}`);
  if (q.account === 'yes' || q.account === 'no') where.push(`e.username IS ${q.account === 'yes' ? 'NOT' : ''} NULL`);
  return pagedQuery({
    select: EMPLOYEE_COLUMNS,
    from: `FROM employees e JOIN roles r ON r.id = e.role_id WHERE ${where.join(' AND ')}`,
    params,
    order: orderBy(q, { employee_id: 'e.employee_id', full_name: 'e.full_name', role: 'r.name', username: 'e.username' }, 'full_name'),
    q,
  });
}

export function getEmployee(id) {
  const row = db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees e JOIN roles r ON r.id = e.role_id WHERE e.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Employee not found');
  return row;
}

/**
 * Body: employee fields plus `has_account`, `username`, `password`.
 * A new account needs a password; on an existing account a blank password keeps the current one.
 */
function validateEmployee(body, existing, user) {
  const errors = {};
  const data = {
    employee_id: str(body.employee_id).toUpperCase(),
    full_name: str(body.full_name),
    role_id: Number(body.role_id),
    company: str(body.company) || user.company,
    site: str(body.site) || user.site,
    phone: optional(body.phone),
    email: optional(body.email)?.toLowerCase() ?? null,
    is_active: flag(body.is_active, existing?.is_active ?? 1),
  };
  if (!/^[A-Z0-9._-]{2,30}$/.test(data.employee_id)) errors.employee_id = 'Employee ID must be 2-30 characters: A-Z, 0-9, . _ -';
  else if (taken('employees', 'employee_id', data.employee_id, existing?.id)) errors.employee_id = 'Employee ID is already used';
  if (data.full_name.length < 2 || data.full_name.length > 100) errors.full_name = 'Full name must be 2-100 characters';
  if (!data.role_id || !db.prepare('SELECT 1 FROM roles WHERE id = ?').get(data.role_id)) errors.role_id = 'Role is required';
  if (data.phone && !/^\+?[0-9 -]{6,20}$/.test(data.phone)) errors.phone = 'Phone number is not valid';
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Email is not valid';

  const hasAccount = flag(body.has_account, existing?.has_account ?? 0) === 1;
  const password = String(body.password ?? '');
  data.username = null;
  data.password_hash = null;
  if (hasAccount) {
    data.username = str(body.username).toLowerCase();
    if (!/^[a-z0-9._]{3,30}$/.test(data.username)) errors.username = 'Username must be 3-30 characters: a-z, 0-9, . or _';
    else if (taken('employees', 'username', data.username, existing?.id)) errors.username = 'Username is already used';
    if (password) {
      if (password.length < 8) errors.password = 'Password must be at least 8 characters';
      else data.password_hash = hashPassword(password);
    } else if (!existing?.has_account) {
      errors.password = 'Password is required for a new user account';
    } else {
      data.password_hash = undefined; // keep the stored hash
    }
  }

  if (existing && existing.id === user.id) {
    if (!data.is_active) errors.is_active = 'You cannot deactivate your own account';
    if (!hasAccount) errors.has_account = 'You cannot remove your own user account';
    if (data.role_id !== existing.role_id) errors.role_id = 'You cannot change your own role';
  }
  fail(errors);
  return data;
}

export function createEmployee(body, user) {
  const d = validateEmployee(body, null, user);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO employees (employee_id, full_name, role_id, company, site, phone, email, username, password_hash, is_active)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(d.employee_id, d.full_name, d.role_id, d.company, d.site, d.phone, d.email, d.username, d.password_hash, d.is_active);
  return getEmployee(lastInsertRowid);
}

export function updateEmployee(id, body, user) {
  const existing = getEmployee(id);
  const d = validateEmployee(body, existing, user);
  db.prepare(`UPDATE employees SET employee_id = ?, full_name = ?, role_id = ?, company = ?, site = ?, phone = ?, email = ?,
              username = ?, is_active = ? ${d.password_hash === undefined ? '' : ', password_hash = ?'} WHERE id = ?`)
    .run(d.employee_id, d.full_name, d.role_id, d.company, d.site, d.phone, d.email, d.username, d.is_active,
      ...(d.password_hash === undefined ? [] : [d.password_hash]), id);
  return getEmployee(id);
}

export function deleteEmployee(id, user) {
  getEmployee(id);
  if (Number(id) === user.id) throw new HttpError(409, 'You cannot delete your own account');
  const { n } = db.prepare(
    `SELECT (SELECT COUNT(*) FROM work_orders WHERE driver_id = ? OR mechanic_id = ? OR created_by = ?)
          + (SELECT COUNT(*) FROM wo_steps WHERE pic_id = ?) AS n`,
  ).get(id, id, id, id);
  if (n) throw new HttpError(409, 'Employee is used in work order history. Deactivate the employee instead');
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
}

/** Active employees whose role may be assigned as driver / mechanic on a work order. */
export function assignableEmployees({ search, role }) {
  const s = `%${str(search)}%`;
  const permission = { driver: 'wo.as_driver', mechanic: 'wo.as_mechanic' }[role];
  return db.prepare(
    `SELECT e.id, e.employee_id, e.full_name, r.code AS role FROM employees e JOIN roles r ON r.id = e.role_id
     WHERE e.is_active = 1 AND (e.full_name LIKE ? OR e.employee_id LIKE ?) ${permission ? `AND ${roleHas()}` : ''}
     ORDER BY e.full_name`,
  ).all(...(permission ? [s, s, permission] : [s, s]));
}

/* ---------- Units ---------- */

const UNIT_COLUMNS = `u.*,
  (SELECT COUNT(*) FROM work_orders w WHERE w.unit_id = u.id) AS wo_count,
  (SELECT w.wo_number FROM work_orders w WHERE w.unit_id = u.id AND w.status != 'FINISH' AND w.approval_status != 'REJECT') AS active_wo`;

export function listUnits(q = {}) {
  const s = `%${str(q.search)}%`;
  const where = ['(u.unit_code LIKE ? OR u.unit_number LIKE ? OR IFNULL(u.brand, \'\') LIKE ? OR IFNULL(u.model, \'\') LIKE ? OR IFNULL(u.serial_number, \'\') LIKE ?)'];
  const params = [s, s, s, s, s];
  if (q.unit_type) {
    where.push('u.unit_type = ?');
    params.push(str(q.unit_type));
  }
  if (q.status === 'active' || q.status === 'inactive') where.push(`u.is_active = ${q.status === 'active' ? 1 : 0}`);
  return pagedQuery({
    select: UNIT_COLUMNS,
    from: `FROM units u WHERE ${where.join(' AND ')}`,
    params,
    order: orderBy(q, { unit_code: 'u.unit_code', unit_number: 'u.unit_number', unit_type: 'u.unit_type', brand: 'u.brand', year: 'u.year' }, 'unit_code'),
    q,
  });
}

export function getUnit(id) {
  const row = db.prepare(`SELECT ${UNIT_COLUMNS} FROM units u WHERE u.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Unit not found');
  return row;
}

function validateUnit(body, existing) {
  const errors = {};
  const yearRaw = str(body.year);
  const data = {
    unit_code: str(body.unit_code).toUpperCase(),
    unit_number: str(body.unit_number),
    unit_type: str(body.unit_type),
    brand: optional(body.brand),
    model: optional(body.model),
    serial_number: optional(body.serial_number)?.toUpperCase() ?? null,
    year: yearRaw ? Number(yearRaw) : null,
    is_active: flag(body.is_active, existing?.is_active ?? 1),
  };
  if (!/^[A-Z0-9-]{2,20}$/.test(data.unit_code)) errors.unit_code = 'Unit code must be 2-20 characters: A-Z, 0-9 or -';
  else if (taken('units', 'unit_code', data.unit_code, existing?.id)) errors.unit_code = 'Unit code is already used';
  if (data.unit_number.length < 1 || data.unit_number.length > 30) errors.unit_number = 'Unit number is required (max 30)';
  else if (taken('units', 'unit_number', data.unit_number, existing?.id)) errors.unit_number = 'Unit number is already used';
  if (data.unit_type.length < 2 || data.unit_type.length > 50) errors.unit_type = 'Unit type is required';
  if (data.serial_number && taken('units', 'serial_number', data.serial_number, existing?.id)) errors.serial_number = 'Serial number is already used';
  const maxYear = new Date().getFullYear() + 1;
  if (data.year !== null && !(Number.isInteger(data.year) && data.year >= 1950 && data.year <= maxYear))
    errors.year = `Year must be between 1950 and ${maxYear}`;
  if (existing?.active_wo && !data.is_active) errors.is_active = `Unit has an active work order (${existing.active_wo})`;
  fail(errors);
  return data;
}

export function createUnit(body) {
  const d = validateUnit(body);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO units (unit_code, unit_number, unit_type, brand, model, serial_number, year, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.unit_code, d.unit_number, d.unit_type, d.brand, d.model, d.serial_number, d.year, d.is_active);
  return getUnit(lastInsertRowid);
}

export function updateUnit(id, body) {
  const existing = getUnit(id);
  const d = validateUnit(body, existing);
  db.prepare('UPDATE units SET unit_code = ?, unit_number = ?, unit_type = ?, brand = ?, model = ?, serial_number = ?, year = ?, is_active = ? WHERE id = ?')
    .run(d.unit_code, d.unit_number, d.unit_type, d.brand, d.model, d.serial_number, d.year, d.is_active, id);
  return getUnit(id);
}

export function deleteUnit(id) {
  const unit = getUnit(id);
  if (unit.wo_count) throw new HttpError(409, 'Unit is used in work order history. Deactivate the unit instead');
  db.prepare('DELETE FROM units WHERE id = ?').run(id);
}

export const unitTypes = () => db.prepare('SELECT DISTINCT unit_type FROM units ORDER BY unit_type').all().map((r) => r.unit_type);
