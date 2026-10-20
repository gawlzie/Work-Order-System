import { hashPassword } from './auth.js';
import { db, roleHas, tx } from './db.js';
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
          + (SELECT COUNT(*) FROM wo_steps WHERE pic_id = ?)
          + (SELECT COUNT(*) FROM wo_proofs WHERE uploaded_by = ?) AS n`,
  ).get(id, id, id, id, id);
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

/* ---------- Repair categories ---------- */

const CATEGORY_COLUMNS = `c.*,
  (SELECT COUNT(*) FROM work_orders w WHERE w.category_id = c.id) AS wo_count,
  (SELECT COUNT(*) FROM job_codes j WHERE j.category_id = c.id) AS job_count`;

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
  db.prepare('DELETE FROM repair_categories WHERE id = ?').run(id);
}

/* ---------- Job codes ---------- */

const JOB_COLUMNS = `j.*, c.name AS category_name, c.is_active AS category_active,
  (SELECT COUNT(*) FROM work_orders w WHERE w.job_code_id = j.id) AS wo_count`;

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
