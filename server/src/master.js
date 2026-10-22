import { hashPassword } from './auth.js';
import { db, roleHas, tx } from './db.js';
import { ADMIN_PERMISSIONS, PERMISSION_KEYS } from './permissions.js';
import { ALL_SITES, coversRole, inScope, siteCondition } from './scope.js';
import { DECIMAL_UOMS, HttpError, UOMS } from './workorders.js';

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

function validateRole(body, existing, user) {
  const errors = {};
  // Nobody can hand out (or edit a role with) permissions their own role does not have.
  if (existing && user && !coversRole(user, existing.permissions)) throw new HttpError(403, 'This role has permissions your own role does not have');
  const code = existing?.is_system ? existing.code : str(body.code).toLowerCase();
  const name = str(body.name);
  const permissions = [...new Set(Array.isArray(body.permissions) ? body.permissions : [])];
  if (!/^[a-z0-9_]{2,30}$/.test(code)) errors.code = 'Code must be 2-30 characters: a-z, 0-9 or _';
  else if (taken('roles', 'code', code, existing?.id)) errors.code = 'Code is already used';
  if (name.length < 2 || name.length > 60) errors.name = 'Name must be 2-60 characters';
  else if (taken('roles', 'name', name, existing?.id)) errors.name = 'Name is already used';
  const unknown = permissions.filter((p) => !PERMISSION_KEYS.includes(p));
  if (unknown.length) errors.permissions = `Unknown permission: ${unknown.join(', ')}`;
  else if (user && !coversRole(user, permissions)) errors.permissions = 'You can only give permissions your own role has';
  fail(errors);
  return {
    code,
    name,
    description: optional(body.description),
    // Admin Company is the recovery path for every other setting, so it always keeps full access.
    permissions: PERMISSION_KEYS.filter((p) => permissions.includes(p) || (existing?.code === 'admin_company' && ADMIN_PERMISSIONS.includes(p))),
  };
}

export function createRole(body, user) {
  const data = validateRole(body, null, user);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO roles (code, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 0)')
    .run(data.code, data.name, data.description, JSON.stringify(data.permissions));
  return getRole(lastInsertRowid);
}

export function updateRole(id, body, user) {
  const existing = getRole(id);
  const data = validateRole(body, existing, user);
  if (existing.id === user.role_id && !data.permissions.includes('master.role'))
    throw new HttpError(409, 'You cannot remove "Manage roles" from your own role');
  db.prepare('UPDATE roles SET code = ?, name = ?, description = ?, permissions = ? WHERE id = ?')
    .run(data.code, data.name, data.description, JSON.stringify(data.permissions), id);
  return getRole(id);
}

export function deleteRole(id, user) {
  const role = getRole(id);
  if (user && !coversRole(user, role.permissions)) throw new HttpError(403, 'This role has permissions your own role does not have');
  if (role.is_system) throw new HttpError(409, 'Built-in roles cannot be deleted');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM employees WHERE role_id = ?').get(id);
  if (n) throw new HttpError(409, `Role is assigned to ${n} employee(s). Move them to another role first`);
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
}

/* ---------- Employees ---------- */

const EMPLOYEE_COLUMNS = `e.id, e.employee_id, e.full_name, e.role_id, r.code AS role, r.name AS role_name, e.company, e.site,
  e.phone, e.email, e.username, e.username IS NOT NULL AS has_account, e.is_active`;

export function listEmployees(q = {}, user = null) {
  const s = `%${str(q.search)}%`;
  const where = ['(e.employee_id LIKE ? OR e.full_name LIKE ? OR IFNULL(e.username, \'\') LIKE ?)'];
  const params = [s, s, s];
  if (user) {
    const scope = siteCondition(user, 'e.site');
    where.push(scope.sql);
    params.push(...scope.params);
  }
  if (q.role_id) {
    where.push('e.role_id = ?');
    params.push(Number(q.role_id));
  }
  if (q.status === 'active' || q.status === 'inactive') where.push(`e.is_active = ${q.status === 'active' ? 1 : 0}`);
  if (q.account === 'yes' || q.account === 'no') where.push(`e.username IS ${q.account === 'yes' ? 'NOT' : ''} NULL`);
  if (q.site) {
    where.push('e.site = ? COLLATE NOCASE');
    params.push(str(q.site));
  }
  return pagedQuery({
    select: EMPLOYEE_COLUMNS,
    from: `FROM employees e JOIN roles r ON r.id = e.role_id WHERE ${where.join(' AND ')}`,
    params,
    order: orderBy(q, { employee_id: 'e.employee_id', full_name: 'e.full_name', role: 'r.name', username: 'e.username' }, 'full_name'),
    q,
  });
}

/** With `user`: only employees within the user's site scope. */
export function getEmployee(id, user = null) {
  const row = db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees e JOIN roles r ON r.id = e.role_id WHERE e.id = ?`).get(id);
  if (!row || (user && !inScope(user, row.site))) throw new HttpError(404, 'Employee not found');
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
  const role = data.role_id && db.prepare('SELECT permissions FROM roles WHERE id = ?').get(data.role_id);
  const permissions = role ? JSON.parse(role.permissions) : [];
  if (role && !coversRole(user, permissions)) errors.role_id = 'You cannot give a role with more rights than your own';
  // A company-wide role (Admin Company) works at every site of the company, so it has no site of its own.
  if (permissions.includes(ALL_SITES)) data.site = '';
  else {
    const site = siteName(data.site, existing?.site);
    if (site) data.site = site;
    else errors.site = 'Choose an active site from the site master';
    if (site && !inScope(user, site)) errors.site = 'You can only place employees at your own site';
  }

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
  const existing = getEmployee(id, user);
  assertCovers(user, existing);
  const d = validateEmployee(body, existing, user);
  db.prepare(`UPDATE employees SET employee_id = ?, full_name = ?, role_id = ?, company = ?, site = ?, phone = ?, email = ?,
              username = ?, is_active = ? ${d.password_hash === undefined ? '' : ', password_hash = ?'} WHERE id = ?`)
    .run(d.employee_id, d.full_name, d.role_id, d.company, d.site, d.phone, d.email, d.username, d.is_active,
      ...(d.password_hash === undefined ? [] : [d.password_hash]), id);
  return getEmployee(id);
}

export function deleteEmployee(id, user) {
  assertCovers(user, getEmployee(id, user));
  if (Number(id) === user.id) throw new HttpError(409, 'You cannot delete your own account');
  const { n } = db.prepare(
    `SELECT (SELECT COUNT(*) FROM work_orders WHERE driver_id = ? OR mechanic_id = ? OR created_by = ?)
          + (SELECT COUNT(*) FROM wo_steps WHERE pic_id = ?)
          + (SELECT COUNT(*) FROM wo_proofs WHERE uploaded_by = ?) AS n`,
  ).get(id, id, id, id, id);
  if (n) throw new HttpError(409, 'Employee is used in work order history. Deactivate the employee instead');
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
}

/** Accounts with more rights than the user's own (e.g. Admin Company for an Admin Site) cannot be changed by them. */
function assertCovers(user, employee) {
  const role = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(employee.role_id);
  if (role && !coversRole(user, JSON.parse(role.permissions))) throw new HttpError(403, 'This employee has more rights than your own role');
}

/** Active employees whose role may be assigned as driver / mechanic on a work order; with `user`, within their site scope. */
export function assignableEmployees({ search, role }, user = null) {
  const s = `%${str(search)}%`;
  const permission = { driver: 'wo.as_driver', mechanic: 'wo.as_mechanic' }[role];
  const scope = user ? siteCondition(user, 'e.site') : { sql: '1', params: [] };
  return db.prepare(
    `SELECT e.id, e.employee_id, e.full_name, r.code AS role, e.site FROM employees e JOIN roles r ON r.id = e.role_id
     WHERE e.is_active = 1 AND (e.full_name LIKE ? OR e.employee_id LIKE ?) ${permission ? `AND ${roleHas()}` : ''} AND ${scope.sql}
     ORDER BY e.full_name`,
  ).all(...(permission ? [s, s, permission] : [s, s]), ...scope.params);
}

/* ---------- Shared: site of an employee / unit ---------- */

/** Canonical site name for `value`, or null when it is not an active site (keeping `current` is always allowed). */
function siteName(value, current) {
  const site = db.prepare('SELECT site_name, is_active FROM sites WHERE site_name = ? COLLATE NOCASE').get(str(value));
  if (site && (site.is_active || site.site_name === current)) return site.site_name;
  return str(value) && str(value) === current ? current : null;
}

/* ---------- Units ---------- */

const UNIT_COLUMNS = `u.*,
  (SELECT COUNT(*) FROM work_orders w WHERE w.unit_id = u.id) AS wo_count,
  (SELECT w.wo_number FROM work_orders w WHERE w.unit_id = u.id AND w.status != 'FINISH' AND w.approval_status != 'REJECT') AS active_wo`;

export function listUnits(q = {}, user = null) {
  const s = `%${str(q.search)}%`;
  const where = ['(u.unit_code LIKE ? OR u.unit_number LIKE ? OR IFNULL(u.brand, \'\') LIKE ? OR IFNULL(u.model, \'\') LIKE ? OR IFNULL(u.serial_number, \'\') LIKE ?)'];
  const params = [s, s, s, s, s];
  if (user) {
    const scope = siteCondition(user, 'u.site');
    where.push(scope.sql);
    params.push(...scope.params);
  }
  if (q.unit_type) {
    where.push('u.unit_type = ?');
    params.push(str(q.unit_type));
  }
  if (q.site) {
    where.push('u.site = ? COLLATE NOCASE');
    params.push(str(q.site));
  }
  if (q.status === 'active' || q.status === 'inactive') where.push(`u.is_active = ${q.status === 'active' ? 1 : 0}`);
  return pagedQuery({
    select: UNIT_COLUMNS,
    from: `FROM units u WHERE ${where.join(' AND ')}`,
    params,
    order: orderBy(q, { unit_code: 'u.unit_code', unit_number: 'u.unit_number', unit_type: 'u.unit_type', brand: 'u.brand', year: 'u.year', site: 'u.site' }, 'unit_code'),
    q,
  });
}

/** With `user`: only units within the user's site scope. */
export function getUnit(id, user = null) {
  const row = db.prepare(`SELECT ${UNIT_COLUMNS} FROM units u WHERE u.id = ?`).get(id);
  if (!row || (user && !inScope(user, row.site))) throw new HttpError(404, 'Unit not found');
  return row;
}

function validateUnit(body, existing, user) {
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
    site: str(body.site) || existing?.site || user?.site || '',
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
  const site = siteName(data.site, existing?.site);
  if (site) data.site = site;
  else errors.site = 'Choose an active site from the site master';
  if (site && user && !inScope(user, site)) errors.site = 'You can only place units at your own site';
  fail(errors);
  return data;
}

export function createUnit(body, user) {
  const d = validateUnit(body, null, user);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO units (unit_code, unit_number, unit_type, brand, model, serial_number, year, site, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.unit_code, d.unit_number, d.unit_type, d.brand, d.model, d.serial_number, d.year, d.site, d.is_active);
  return getUnit(lastInsertRowid);
}

/** Moving a unit to another site does not change its work orders: they keep the site they were raised at. */
export function updateUnit(id, body, user) {
  const existing = getUnit(id, user);
  const d = validateUnit(body, existing, user);
  db.prepare('UPDATE units SET unit_code = ?, unit_number = ?, unit_type = ?, brand = ?, model = ?, serial_number = ?, year = ?, site = ?, is_active = ? WHERE id = ?')
    .run(d.unit_code, d.unit_number, d.unit_type, d.brand, d.model, d.serial_number, d.year, d.site, d.is_active, id);
  return getUnit(id);
}

export function deleteUnit(id, user) {
  const unit = getUnit(id, user);
  if (unit.wo_count) throw new HttpError(409, 'Unit is used in work order history. Deactivate the unit instead');
  db.prepare('DELETE FROM units WHERE id = ?').run(id);
}

export const unitTypes = () => db.prepare('SELECT DISTINCT unit_type FROM units ORDER BY unit_type').all().map((r) => r.unit_type);

/** Brand / model pairs already used on units, as suggestions for the unit form. */
export const unitModels = () =>
  db.prepare("SELECT DISTINCT brand, model FROM units WHERE IFNULL(brand, '') != '' ORDER BY brand, model").all();

/* ---------- Repair categories ---------- */

const CATEGORY_COLUMNS = `c.*,
  (SELECT COUNT(*) FROM wo_categories w WHERE w.category_id = c.id) AS wo_count,
  (SELECT COUNT(*) FROM job_codes j WHERE j.category_id = c.id) AS job_count,
  (SELECT COUNT(*) FROM spareparts p WHERE p.category_id = c.id) AS part_count`;

export function listCategories(q = {}) {
  const s = `%${str(q.search)}%`;
  const where = ["(c.name LIKE ? OR IFNULL(c.description, '') LIKE ?)"];
  if (q.status === 'active' || q.status === 'inactive') where.push(`c.is_active = ${q.status === 'active' ? 1 : 0}`);
  return pagedQuery({
    select: CATEGORY_COLUMNS,
    from: `FROM repair_categories c WHERE ${where.join(' AND ')}`,
    params: [s, s],
    order: orderBy(q, { name: 'c.name', job_count: 'job_count', wo_count: 'wo_count' }, 'name'),
    q,
  });
}

export function getCategory(id) {
  const row = db.prepare(`SELECT ${CATEGORY_COLUMNS} FROM repair_categories c WHERE c.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Repair category not found');
  return row;
}

function validateCategory(body, existing) {
  const errors = {};
  const data = {
    name: str(body.name),
    description: optional(body.description),
    is_active: flag(body.is_active, existing?.is_active ?? 1),
  };
  if (data.name.length < 2 || data.name.length > 50) errors.name = 'Category name must be 2-50 characters';
  else if (taken('repair_categories', 'name', data.name, existing?.id)) errors.name = 'Category name is already used';
  if (data.description && data.description.length > 200) errors.description = 'Description is too long (max 200)';
  fail(errors);
  return data;
}

export function createCategory(body) {
  const d = validateCategory(body);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO repair_categories (name, description, is_active) VALUES (?, ?, ?)')
    .run(d.name, d.description, d.is_active);
  return getCategory(lastInsertRowid);
}

export function updateCategory(id, body) {
  const existing = getCategory(id);
  const d = validateCategory(body, existing);
  db.prepare('UPDATE repair_categories SET name = ?, description = ?, is_active = ? WHERE id = ?').run(d.name, d.description, d.is_active, id);
  return getCategory(id);
}

export function deleteCategory(id) {
  const category = getCategory(id);
  if (category.wo_count) throw new HttpError(409, 'Category is used in work order history. Deactivate the category instead');
  if (category.job_count) throw new HttpError(409, `Category has ${category.job_count} job code(s). Delete them or move them to another category first`);
  // The spare part master is hidden, so its parts cannot be moved first: they just lose the category.
  tx(() => {
    db.prepare('UPDATE spareparts SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM repair_categories WHERE id = ?').run(id);
  });
}

/* ---------- Job codes ---------- */

const JOB_COLUMNS = `j.*, c.name AS category_name, c.is_active AS category_active,
  (SELECT COUNT(DISTINCT x.wo_uuid) FROM wo_job_codes x WHERE x.job_code_id = j.id) AS wo_count`;

export function listJobCodes(q = {}) {
  const s = `%${str(q.search)}%`;
  const where = ['(j.job_code LIKE ? OR j.job_name LIKE ?)'];
  const params = [s, s];
  if (q.category_id) {
    where.push('j.category_id = ?');
    params.push(Number(q.category_id));
  }
  if (q.status === 'active' || q.status === 'inactive') where.push(`j.is_active = ${q.status === 'active' ? 1 : 0}`);
  return pagedQuery({
    select: JOB_COLUMNS,
    from: `FROM job_codes j JOIN repair_categories c ON c.id = j.category_id WHERE ${where.join(' AND ')}`,
    params,
    order: orderBy(q, { job_code: 'j.job_code', job_name: 'j.job_name', category: 'c.name', standard_duration: 'j.standard_duration' }, 'job_code'),
    q,
  });
}

export function getJobCode(id) {
  const row = db.prepare(`SELECT ${JOB_COLUMNS} FROM job_codes j JOIN repair_categories c ON c.id = j.category_id WHERE j.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Job code not found');
  return row;
}

/** Body: job_code, job_name, category_id, standard_duration (minutes, optional: empty = unknown), is_active. */
function validateJobCode(body, existing) {
  const errors = {};
  const data = {
    job_code: str(body.job_code).toUpperCase(),
    job_name: str(body.job_name),
    category_id: Number(body.category_id),
    standard_duration: str(body.standard_duration) ? Number(str(body.standard_duration)) : null,
    is_active: flag(body.is_active, existing?.is_active ?? 1),
  };
  if (!/^[A-Z0-9][A-Z0-9._-]{1,19}$/.test(data.job_code)) errors.job_code = 'Job code must be 2-20 characters: A-Z, 0-9, . _ -';
  else if (taken('job_codes', 'job_code', data.job_code, existing?.id)) errors.job_code = 'Job code is already used';
  if (data.job_name.length < 2 || data.job_name.length > 200) errors.job_name = 'Job name must be 2-200 characters';
  // A job code may keep a category that was deactivated since; new choices must be active.
  if (!data.category_id || !db.prepare('SELECT 1 FROM repair_categories WHERE id = ? AND (is_active = 1 OR id = ?)').get(data.category_id, existing?.category_id ?? 0))
    errors.category_id = 'Category is required (active categories only)';
  if (data.standard_duration !== null && !(Number.isInteger(data.standard_duration) && data.standard_duration >= 1 && data.standard_duration <= 60000))
    errors.standard_duration = 'Standard duration must be between 1 minute and 1000 hours';
  fail(errors);
  return data;
}

export function createJobCode(body) {
  const d = validateJobCode(body);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO job_codes (job_code, job_name, category_id, standard_duration, is_active) VALUES (?, ?, ?, ?, ?)')
    .run(d.job_code, d.job_name, d.category_id, d.standard_duration, d.is_active);
  return getJobCode(lastInsertRowid);
}

export function updateJobCode(id, body) {
  const existing = getJobCode(id);
  const d = validateJobCode(body, existing);
  db.prepare('UPDATE job_codes SET job_code = ?, job_name = ?, category_id = ?, standard_duration = ?, is_active = ? WHERE id = ?')
    .run(d.job_code, d.job_name, d.category_id, d.standard_duration, d.is_active, id);
  return getJobCode(id);
}

export function deleteJobCode(id) {
  const job = getJobCode(id);
  if (job.wo_count) throw new HttpError(409, 'Job code is used on work orders. Deactivate it instead');
  db.prepare('DELETE FROM job_codes WHERE id = ?').run(id);
}

/* ---------- Sites ---------- */

const SITE_COLUMNS = `s.*, (SELECT COUNT(*) FROM employees e WHERE e.site = s.site_name COLLATE NOCASE) AS employee_count,
  (SELECT COUNT(*) FROM units u WHERE u.site = s.site_name COLLATE NOCASE) AS unit_count,
  (SELECT COUNT(*) FROM work_orders w WHERE w.site = s.site_name COLLATE NOCASE) AS wo_count`;

export function listSites(q = {}) {
  const s = `%${str(q.search)}%`;
  const where = [`(s.site_code LIKE ? OR s.site_name LIKE ? OR s.company LIKE ? OR IFNULL(s.location, '') LIKE ?)`];
  if (q.status === 'active' || q.status === 'inactive') where.push(`s.is_active = ${q.status === 'active' ? 1 : 0}`);
  return pagedQuery({
    select: SITE_COLUMNS,
    from: `FROM sites s WHERE ${where.join(' AND ')}`,
    params: [s, s, s, s],
    order: orderBy(q, { site_code: 's.site_code', site_name: 's.site_name', company: 's.company', employee_count: 'employee_count', unit_count: 'unit_count', wo_count: 'wo_count' }, 'site_code'),
    q,
  });
}

export function getSite(id) {
  const row = db.prepare(`SELECT ${SITE_COLUMNS} FROM sites s WHERE s.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Site not found');
  return row;
}

/** Body: site_code, site_name, company, location (optional), is_active. */
function validateSite(body, existing) {
  const errors = {};
  const data = {
    site_code: str(body.site_code).toUpperCase(),
    site_name: str(body.site_name).replace(/\s+/g, ' '),
    company: str(body.company).replace(/\s+/g, ' '),
    location: optional(body.location),
    is_active: flag(body.is_active, existing?.is_active ?? 1),
  };
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(data.site_code)) errors.site_code = 'Site code must be 2-20 characters: A-Z, 0-9, _ -';
  else if (taken('sites', 'site_code', data.site_code, existing?.id)) errors.site_code = 'Site code is already used';
  if (data.site_name.length < 2 || data.site_name.length > 100) errors.site_name = 'Site name must be 2-100 characters';
  else if (taken('sites', 'site_name', data.site_name, existing?.id)) errors.site_name = 'Site name is already used';
  if (data.company.length < 2 || data.company.length > 100) errors.company = 'Company must be 2-100 characters';
  if (data.location && data.location.length > 200) errors.location = 'Location must be at most 200 characters';
  fail(errors);
  return data;
}

export function createSite(body) {
  const d = validateSite(body);
  const { lastInsertRowid } = db.prepare('INSERT INTO sites (site_code, site_name, company, location, is_active) VALUES (?, ?, ?, ?, ?)')
    .run(d.site_code, d.site_name, d.company, d.location, d.is_active);
  return getSite(lastInsertRowid);
}

/** A renamed site stays assigned to its employees, units and work orders: their site name is updated with it. */
export function updateSite(id, body) {
  const existing = getSite(id);
  const d = validateSite(body, existing);
  tx(() => {
    db.prepare('UPDATE sites SET site_code = ?, site_name = ?, company = ?, location = ?, is_active = ? WHERE id = ?')
      .run(d.site_code, d.site_name, d.company, d.location, d.is_active, id);
    if (d.site_name !== existing.site_name)
      for (const table of ['employees', 'units', 'work_orders']) db.prepare(`UPDATE ${table} SET site = ? WHERE site = ? COLLATE NOCASE`).run(d.site_name, existing.site_name);
  });
  return getSite(id);
}

export function deleteSite(id) {
  const site = getSite(id);
  const used = [[site.employee_count, 'employee(s)'], [site.unit_count, 'unit(s)'], [site.wo_count, 'work order(s)']].filter(([n]) => n).map(([n, what]) => `${n} ${what}`);
  if (used.length) throw new HttpError(409, `Site has ${used.join(', ')}. Deactivate the site instead`);
  db.prepare('DELETE FROM sites WHERE id = ?').run(id);
}

/* ---------- Spare parts ---------- */

export { UOMS };
/** Stock and minimum stock a new spare part starts with when none is given. */
export const DEFAULT_STOCK = 99999;
export const DEFAULT_MIN_STOCK = 15;

/**
 * Part numbers as stored: upper case, single spaces, full-width characters (from Chinese keyboards) as ASCII and the
 * Chinese "一" used as a dash turned into "-". Material codes may hold sizes, e.g. BS40*65*12 or GB/T 70.3.
 */
export const normalizePartNumber = (v) =>
  str(v)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/一/g, '-')
    .replace(/\s+/g, ' ')
    .toUpperCase();
export const PART_NUMBER_RULE = /^[A-Z0-9][A-Z0-9 ._\-/*()+#]{1,59}$/;

const PART_COLUMNS = `p.*, c.name AS category_name, c.is_active AS category_active,
  CASE WHEN p.stock <= 0 THEN 'out' WHEN p.stock <= p.min_stock THEN 'low' ELSE 'ok' END AS stock_status`;
const PART_FROM = 'FROM spareparts p LEFT JOIN repair_categories c ON c.id = p.category_id';

export function listSpareparts(q = {}) {
  const s = `%${str(q.search)}%`;
  const where = [`(p.part_number LIKE ? OR p.part_name LIKE ? OR IFNULL(p.brand, '') LIKE ? OR IFNULL(p.location, '') LIKE ?)`];
  const params = [s, s, s, s];
  if (q.category_id) {
    where.push('p.category_id = ?');
    params.push(Number(q.category_id));
  }
  if (q.status === 'active' || q.status === 'inactive') where.push(`p.is_active = ${q.status === 'active' ? 1 : 0}`);
  if (q.stock === 'out') where.push('p.stock <= 0');
  else if (q.stock === 'low') where.push('p.stock > 0 AND p.stock <= p.min_stock');
  else if (q.stock === 'ok') where.push('p.stock > p.min_stock');
  const result = pagedQuery({
    select: PART_COLUMNS,
    from: `${PART_FROM} WHERE ${where.join(' AND ')}`,
    params,
    order: orderBy(q, { part_number: 'p.part_number', part_name: 'p.part_name', category: 'c.name', stock: 'p.stock', unit_price: 'p.unit_price', location: 'p.location' }, 'part_number'),
    q,
  });
  // Stock alerts over all active parts (not only this page), for the counters above the list.
  const summary = db.prepare(`SELECT COUNT(*) AS total, SUM(stock <= 0) AS out_count, SUM(stock > 0 AND stock <= min_stock) AS low_count,
                                SUM(stock * IFNULL(unit_price, 0)) AS stock_value FROM spareparts WHERE is_active = 1`).get();
  return { ...result, summary: { total: summary.total, out: summary.out_count ?? 0, low: summary.low_count ?? 0, stock_value: Math.round(summary.stock_value ?? 0) } };
}

export function getSparepart(id) {
  const row = db.prepare(`SELECT ${PART_COLUMNS} ${PART_FROM} WHERE p.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Spare part not found');
  return row;
}

/** Body: part_number, part_name, category_id (optional), brand, uom, stock, min_stock, location, unit_price (optional), is_active. */
function validateSparepart(body, existing) {
  const errors = {};
  const num = (v) => (str(v) === '' ? null : Number(str(v).replace(',', '.')));
  const data = {
    part_number: normalizePartNumber(body.part_number),
    part_name: str(body.part_name),
    category_id: str(body.category_id) ? Number(body.category_id) : null,
    brand: optional(body.brand),
    uom: str(body.uom).toUpperCase() || 'PCS',
    // Left empty: a new part gets the defaults, an edited one keeps its value.
    stock: num(body.stock) ?? existing?.stock ?? DEFAULT_STOCK,
    min_stock: num(body.min_stock) ?? existing?.min_stock ?? DEFAULT_MIN_STOCK,
    location: optional(body.location)?.toUpperCase() ?? null,
    unit_price: num(body.unit_price),
    is_active: flag(body.is_active, existing?.is_active ?? 1),
  };
  if (!PART_NUMBER_RULE.test(data.part_number)) errors.part_number = 'Part number must be 2-60 characters: A-Z, 0-9, space . _ - / * ( ) + #';
  else if (taken('spareparts', 'part_number', data.part_number, existing?.id)) errors.part_number = 'Part number is already used';
  if (data.part_name.length < 2 || data.part_name.length > 300) errors.part_name = 'Part name must be 2-300 characters';
  if (data.category_id !== null && !db.prepare('SELECT 1 FROM repair_categories WHERE id = ? AND (is_active = 1 OR id = ?)').get(data.category_id, existing?.category_id ?? 0))
    errors.category_id = 'Choose an active repair category';
  if (data.brand && data.brand.length > 60) errors.brand = 'Brand must be at most 60 characters';
  if (!UOMS.includes(data.uom)) errors.uom = `Unit must be one of ${UOMS.join(', ')}`;
  const decimals = DECIMAL_UOMS.includes(data.uom);
  const qty = (v, label) => {
    if (!Number.isFinite(v) || v < 0 || v > 9999999) return `${label} must be a number from 0 to 9,999,999`;
    if (!decimals && !Number.isInteger(v)) return `${label} must be a whole number for ${data.uom}`;
    if (decimals && Math.round(v * 100) !== v * 100) return `${label} can have at most 2 decimals`;
    return null;
  };
  const stockError = qty(data.stock, 'Stock');
  if (stockError) errors.stock = stockError;
  const minError = qty(data.min_stock, 'Minimum stock');
  if (minError) errors.min_stock = minError;
  if (data.location && !/^[A-Z0-9][A-Z0-9 ._\-/]{0,29}$/.test(data.location)) errors.location = 'Location must be at most 30 characters: A-Z, 0-9, space . _ - /';
  if (data.unit_price !== null && !(Number.isInteger(data.unit_price) && data.unit_price >= 0 && data.unit_price <= 1e12))
    errors.unit_price = 'Unit price must be a whole number of rupiah from 0';
  fail(errors);
  return data;
}

export function createSparepart(body) {
  const d = validateSparepart(body);
  const ts = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO spareparts (part_number, part_name, category_id, brand, uom, stock, min_stock, location, unit_price, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(d.part_number, d.part_name, d.category_id, d.brand, d.uom, d.stock, d.min_stock, d.location, d.unit_price, d.is_active, ts, ts);
  return getSparepart(lastInsertRowid);
}

export function updateSparepart(id, body) {
  const existing = getSparepart(id);
  const d = validateSparepart(body, existing);
  db.prepare(`UPDATE spareparts SET part_number = ?, part_name = ?, category_id = ?, brand = ?, uom = ?, stock = ?, min_stock = ?, location = ?,
              unit_price = ?, is_active = ?, updated_at = ? WHERE id = ?`)
    .run(d.part_number, d.part_name, d.category_id, d.brand, d.uom, d.stock, d.min_stock, d.location, d.unit_price, d.is_active, new Date().toISOString(), id);
  return getSparepart(id);
}

export function deleteSparepart(id) {
  getSparepart(id);
  const used = db.prepare('SELECT COUNT(DISTINCT x.wo_uuid) AS n FROM wo_job_parts p JOIN wo_job_codes x ON x.id = p.wo_job_code_id WHERE p.sparepart_id = ?').get(id).n;
  if (used) throw new HttpError(409, `Spare part is used on ${used} work order(s). Deactivate it instead`);
  db.prepare('DELETE FROM spareparts WHERE id = ?').run(id);
}

/* ---------- Repair steps ---------- */
// Work orders copy the active steps when they are created, so editing the master never changes work order history.

const activeSteps = () => db.prepare('SELECT COUNT(*) AS n FROM step_templates WHERE parent_id IS NULL AND is_active = 1').get().n;

/** Every top-level step in run order with its sub-steps. The list is short and ordered, so it is not paged. */
export function listStepTemplates(q = {}) {
  const rows = db.prepare('SELECT * FROM step_templates ORDER BY sort_order, id').all();
  const s = str(q.search).toLowerCase();
  return rows
    .filter((r) => r.parent_id === null)
    .map((r) => ({ ...r, sub_steps: rows.filter((c) => c.parent_id === r.id).map(({ id, name }) => ({ id, name })) }))
    .filter((r) => !s || r.name.toLowerCase().includes(s) || r.sub_steps.some((c) => c.name.toLowerCase().includes(s)));
}

export function getStepTemplate(id) {
  const step = listStepTemplates().find((r) => r.id === Number(id));
  if (!step) throw new HttpError(404, 'Step not found');
  return step;
}

/** Body: name, description, is_waiting, allow_add_sub, is_active and sub_steps (array of names). */
function validateStep(body, existing) {
  const errors = {};
  const subs = (Array.isArray(body.sub_steps) ? body.sub_steps : []).map((v) => str(v && typeof v === 'object' ? v.name : v)).filter(Boolean);
  const data = {
    name: str(body.name),
    description: optional(body.description),
    is_waiting: flag(body.is_waiting, existing?.is_waiting ?? 0),
    allow_add_sub: flag(body.allow_add_sub, existing?.allow_add_sub ?? 0),
    is_active: flag(body.is_active, existing?.is_active ?? 1),
    subs,
  };
  if (data.name.length < 2 || data.name.length > 60) errors.name = 'Step name must be 2-60 characters';
  else if (db.prepare('SELECT 1 FROM step_templates WHERE parent_id IS NULL AND name = ? COLLATE NOCASE AND id != ?').get(data.name, existing?.id ?? 0))
    errors.name = 'Step name is already used';
  if (data.description && data.description.length > 200) errors.description = 'Description is too long (max 200)';
  if (subs.length > 15) errors.sub_steps = 'A step can have at most 15 sub-steps';
  else if (subs.some((n) => n.length < 2 || n.length > 60)) errors.sub_steps = 'Each sub-step must be 2-60 characters';
  else if (new Set(subs.map((n) => n.toLowerCase())).size !== subs.length) errors.sub_steps = 'Sub-step names must be unique';
  if (existing?.is_active && !data.is_active && activeSteps() === 1) errors.is_active = 'At least one step must stay active';
  else if (!existing && !data.is_active && activeSteps() === 0) errors.is_active = 'At least one step must stay active';
  fail(errors);
  return data;
}

function writeSubSteps(parentId, names) {
  db.prepare('DELETE FROM step_templates WHERE parent_id = ?').run(parentId);
  const insert = db.prepare('INSERT INTO step_templates (parent_id, sort_order, name) VALUES (?, ?, ?)');
  names.forEach((name, i) => insert.run(parentId, i + 1, name));
}

export function createStepTemplate(body) {
  const d = validateStep(body);
  const id = tx(() => {
    const { max } = db.prepare('SELECT MAX(sort_order) AS max FROM step_templates WHERE parent_id IS NULL').get();
    const { lastInsertRowid } = db
      .prepare('INSERT INTO step_templates (parent_id, sort_order, name, description, is_waiting, allow_add_sub, is_active) VALUES (NULL, ?, ?, ?, ?, ?, ?)')
      .run((max ?? 0) + 1, d.name, d.description, d.is_waiting, d.allow_add_sub, d.is_active);
    writeSubSteps(lastInsertRowid, d.subs);
    return lastInsertRowid;
  });
  return getStepTemplate(id);
}

export function updateStepTemplate(id, body) {
  const existing = getStepTemplate(id);
  const d = validateStep(body, existing);
  tx(() => {
    db.prepare('UPDATE step_templates SET name = ?, description = ?, is_waiting = ?, allow_add_sub = ?, is_active = ? WHERE id = ?')
      .run(d.name, d.description, d.is_waiting, d.allow_add_sub, d.is_active, id);
    writeSubSteps(id, d.subs);
  });
  return getStepTemplate(id);
}

export function deleteStepTemplate(id) {
  const step = getStepTemplate(id);
  if (step.is_active && activeSteps() === 1) throw new HttpError(409, 'At least one step must stay active');
  db.prepare('DELETE FROM step_templates WHERE id = ?').run(id);
}

/** Moves a step one place up or down in the run order and returns the reordered list. */
export function moveStepTemplate(id, direction) {
  if (direction !== 'up' && direction !== 'down') throw new HttpError(422, 'Direction must be up or down');
  const steps = listStepTemplates();
  const from = steps.findIndex((s) => s.id === id);
  if (from < 0) throw new HttpError(404, 'Step not found');
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= steps.length) return steps;
  [steps[from], steps[to]] = [steps[to], steps[from]];
  const setOrder = db.prepare('UPDATE step_templates SET sort_order = ? WHERE id = ?');
  tx(() => steps.forEach((s, i) => setOrder.run(i + 1, s.id)));
  return listStepTemplates();
}
