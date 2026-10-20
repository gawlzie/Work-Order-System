import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_PERMISSIONS, SYSTEM_ROLES } from './permissions.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.WOS_DB || join(here, '..', 'data', 'wos.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/** Job codes: standard repair jobs within a category; standard_duration (minutes) is optional ("-" when unknown). */
const jobCodesDdl = (name) => `
CREATE TABLE IF NOT EXISTS ${name} (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_code          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  job_name          TEXT NOT NULL,
  category_id       INTEGER NOT NULL REFERENCES repair_categories(id),
  standard_duration INTEGER,
  is_active         INTEGER NOT NULL DEFAULT 1
);`;

const employeesDdl = (name) => `
CREATE TABLE IF NOT EXISTS ${name} (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  company       TEXT NOT NULL,
  site          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  username      TEXT UNIQUE,
  password_hash TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1
);`;

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system   INTEGER NOT NULL DEFAULT 0
);

${employeesDdl('employees')}

CREATE TABLE IF NOT EXISTS units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_code     TEXT NOT NULL UNIQUE,
  unit_number   TEXT NOT NULL,
  unit_type     TEXT NOT NULL,
  brand         TEXT,
  model         TEXT,
  serial_number TEXT,
  year          INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS repair_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1
);

${jobCodesDdl('job_codes')}

CREATE TABLE IF NOT EXISTS work_orders (
  wo_uuid          TEXT PRIMARY KEY,
  wo_number        TEXT NOT NULL UNIQUE,
  unit_id          INTEGER NOT NULL REFERENCES units(id),
  driver_id        INTEGER NOT NULL REFERENCES employees(id),
  mechanic_id      INTEGER REFERENCES employees(id),
  category_id      INTEGER REFERENCES repair_categories(id),
  job_code_id      INTEGER REFERENCES job_codes(id),
  problem          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN',
  approval_status  TEXT NOT NULL DEFAULT 'WAITING',
  reject_reason    TEXT,
  approval_remarks TEXT,
  channel_source   TEXT NOT NULL DEFAULT 'WEB',
  created_by       INTEGER REFERENCES employees(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  mobile_sync_time TEXT,
  started_at       TEXT,
  finished_at      TEXT
);

CREATE TABLE IF NOT EXISTS wo_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_uuid       TEXT NOT NULL REFERENCES work_orders(wo_uuid) ON DELETE CASCADE,
  parent_id     INTEGER REFERENCES wo_steps(id) ON DELETE CASCADE,
  step_no       INTEGER NOT NULL,
  step_name     TEXT NOT NULL,
  is_waiting    INTEGER NOT NULL DEFAULT 0,
  is_additional INTEGER NOT NULL DEFAULT 0,
  allow_add_sub INTEGER NOT NULL DEFAULT 0,
  pic_id        INTEGER REFERENCES employees(id),
  started_at    TEXT,
  finished_at   TEXT,
  remarks       TEXT
);

/* Master list of repair steps; new work orders copy the active ones into wo_steps. */
CREATE TABLE IF NOT EXISTS step_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER REFERENCES step_templates(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  is_waiting  INTEGER NOT NULL DEFAULT 0,
  allow_add_sub INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

/* Proof-of-completion files (PDF / photo) for finished work orders; the files live in data/uploads/<wo_uuid>/. */
CREATE TABLE IF NOT EXISTS wo_proofs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_uuid     TEXT NOT NULL REFERENCES work_orders(wo_uuid) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES employees(id),
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proofs_wo ON wo_proofs(wo_uuid);
CREATE INDEX IF NOT EXISTS idx_wo_created ON work_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_steps_wo ON wo_steps(wo_uuid);
`);

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Insert missing built-in roles; with reset, also restore their default name and permissions. */
export function ensureSystemRoles({ reset = false } = {}) {
  const upsert = db.prepare(
    `INSERT INTO roles (code, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(code) DO ${reset ? 'UPDATE SET name = excluded.name, description = excluded.description, permissions = excluded.permissions, is_system = 1' : 'NOTHING'}`,
  );
  for (const r of SYSTEM_ROLES) upsert.run(r.code, r.name, r.description, JSON.stringify(r.permissions));
  // Admin keeps every access permission, including ones added in later versions (e.g. master.step).
  const admin = db.prepare("SELECT permissions FROM roles WHERE code = 'admin'").get();
  const current = JSON.parse(admin.permissions);
  const missing = ADMIN_PERMISSIONS.filter((p) => !current.includes(p));
  if (missing.length) db.prepare("UPDATE roles SET permissions = ? WHERE code = 'admin'").run(JSON.stringify([...current, ...missing]));
}
ensureSystemRoles();

const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// Databases created before the role master stored the role as a fixed text enum on employees.
if (columns('employees').includes('role')) {
  db.exec('PRAGMA foreign_keys = OFF');
  tx(() => {
    db.exec(employeesDdl('employees_new'));
    db.exec(`INSERT INTO employees_new (id, employee_id, full_name, role_id, company, site, username, password_hash, is_active)
             SELECT e.id, e.employee_id, e.full_name, r.id, e.company, e.site, e.username, e.password_hash, e.is_active
             FROM employees e JOIN roles r ON r.code = e.role`);
    db.exec('DROP TABLE employees; ALTER TABLE employees_new RENAME TO employees;');
  });
  db.exec('PRAGMA foreign_keys = ON');
}

const unitCols = columns('units');
if (!unitCols.includes('serial_number')) db.exec('ALTER TABLE units ADD COLUMN serial_number TEXT');
if (!unitCols.includes('year')) db.exec('ALTER TABLE units ADD COLUMN year INTEGER');
if (!unitCols.includes('is_active')) db.exec('ALTER TABLE units ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
if (!columns('work_orders').includes('approval_remarks')) db.exec('ALTER TABLE work_orders ADD COLUMN approval_remarks TEXT');
const categoryCols = columns('repair_categories');
if (!categoryCols.includes('description')) db.exec('ALTER TABLE repair_categories ADD COLUMN description TEXT');
if (!categoryCols.includes('is_active')) db.exec('ALTER TABLE repair_categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
// Job code and standard duration moved from repair categories to their own master (job_codes).
// Values a category still has are carried over (job name = category name) before the columns are dropped.
if (categoryCols.includes('job_code') || categoryCols.includes('standard_duration')) {
  tx(() => {
    if (categoryCols.includes('job_code') && categoryCols.includes('standard_duration')) {
      db.exec(`INSERT INTO job_codes (job_code, job_name, category_id, standard_duration, is_active)
               SELECT UPPER(c.job_code), c.name, c.id, c.standard_duration, c.is_active FROM repair_categories c
               WHERE c.job_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM job_codes j WHERE j.job_code = c.job_code)`);
    }
    db.exec('DROP INDEX IF EXISTS idx_category_job_code');
    if (categoryCols.includes('job_code')) db.exec('ALTER TABLE repair_categories DROP COLUMN job_code');
    if (categoryCols.includes('standard_duration')) db.exec('ALTER TABLE repair_categories DROP COLUMN standard_duration');
  });
}
// "Approved by system" no longer exists: work orders that had it count as approved.
db.exec("UPDATE work_orders SET approval_status = 'APPROVE' WHERE approval_status = 'APPROVE_BY_SYSTEM'");
// Standard duration became optional; databases created before that have it NOT NULL, so rebuild the table.
if (db.prepare('PRAGMA table_info(job_codes)').all().find((c) => c.name === 'standard_duration')?.notnull) {
  tx(() => {
    db.exec(jobCodesDdl('job_codes_new'));
    db.exec(`INSERT INTO job_codes_new (id, job_code, job_name, category_id, standard_duration, is_active)
             SELECT id, job_code, job_name, category_id, standard_duration, is_active FROM job_codes`);
    db.exec('DROP TABLE job_codes; ALTER TABLE job_codes_new RENAME TO job_codes;');
  });
}
if (!columns('work_orders').includes('job_code_id')) db.exec('ALTER TABLE work_orders ADD COLUMN job_code_id INTEGER REFERENCES job_codes(id)');
if (!columns('wo_steps').includes('allow_add_sub')) db.exec('ALTER TABLE wo_steps ADD COLUMN allow_add_sub INTEGER NOT NULL DEFAULT 0');
if (!columns('step_templates').includes('allow_add_sub')) db.exec('ALTER TABLE step_templates ADD COLUMN allow_add_sub INTEGER NOT NULL DEFAULT 0');

/** SQL condition: the role aliased `r` holds the permission bound to the next `?`. */
export const roleHas = (alias = 'r') => `EXISTS (SELECT 1 FROM json_each(${alias}.permissions) WHERE value = ?)`;

/** Employee row joined with its role; permissions parsed into an array. */
export function loadUser(where, ...params) {
  const row = db
    .prepare(`SELECT e.*, r.code AS role, r.name AS role_name, r.permissions
              FROM employees e JOIN roles r ON r.id = e.role_id WHERE ${where}`)
    .get(...params);
  return row && { ...row, permissions: JSON.parse(row.permissions) };
}
