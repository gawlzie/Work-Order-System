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
  site          TEXT, -- site name (sites.site_name)
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS repair_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1
);

${jobCodesDdl('job_codes')}

-- Sites (mine pits, workshops). Employees refer to their site by name (employees.site).
CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_code   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  site_name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  company     TEXT NOT NULL,
  location    TEXT,
  site_alias  TEXT, -- short name of the site, e.g. BIB
  location_alias TEXT, -- short name of the location, e.g. KUKAR
  is_active   INTEGER NOT NULL DEFAULT 1
);

-- Spare part inventory: stock on hand per part; low stock when stock is at or below min_stock.
CREATE TABLE IF NOT EXISTS spareparts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  part_name   TEXT NOT NULL,
  category_id INTEGER REFERENCES repair_categories(id),
  brand       TEXT,
  uom         TEXT NOT NULL DEFAULT 'PCS',
  stock       REAL NOT NULL DEFAULT 0,
  min_stock   REAL NOT NULL DEFAULT 0,
  location    TEXT,
  unit_price  INTEGER,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
  wo_uuid          TEXT PRIMARY KEY,
  wo_number        TEXT NOT NULL UNIQUE,
  unit_id          INTEGER NOT NULL REFERENCES units(id),
  driver_id        INTEGER NOT NULL REFERENCES employees(id),
  mechanic_id      INTEGER REFERENCES employees(id),
  category_id      INTEGER REFERENCES repair_categories(id),
  job_code_id      INTEGER REFERENCES job_codes(id), -- no longer used: job codes are in wo_job_codes
  problem          TEXT NOT NULL,
  maintenance_type TEXT, -- PREVENTIVE | REPAIR | WARRANTY | PDI | OTHERS
  maintenance_other TEXT, -- free text when maintenance_type = OTHERS
  customer_type    TEXT, -- INTERNAL | EXTERNAL
  payment_type     TEXT, -- CUSTOMER_PAID | FREE | OTHERS
  payment_other    TEXT, -- description when payment_type = OTHERS
  site             TEXT, -- site of the unit when the WO was raised (sites.site_name)
  hm               REAL, -- hour meter reading when the WO was raised
  km               REAL, -- odometer reading when the WO was raised
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

/* Job codes done on a work order, each with the mechanic who did it; added in the repair step (Step 7). */
CREATE TABLE IF NOT EXISTS wo_job_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_uuid     TEXT NOT NULL REFERENCES work_orders(wo_uuid) ON DELETE CASCADE,
  job_code_id INTEGER NOT NULL REFERENCES job_codes(id),
  mechanic_id INTEGER NOT NULL REFERENCES employees(id),
  added_by    INTEGER REFERENCES employees(id),
  added_at    TEXT NOT NULL,
  started_at  TEXT, -- each job code has its own timer, run during Step 7
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wo_job_codes_wo ON wo_job_codes(wo_uuid);

/* Repair categories of a work order (one or more), chosen in the repair step (Step 7); job codes come from these. */
CREATE TABLE IF NOT EXISTS wo_categories (
  wo_uuid     TEXT NOT NULL REFERENCES work_orders(wo_uuid) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES repair_categories(id),
  added_by    INTEGER REFERENCES employees(id),
  added_at    TEXT NOT NULL,
  PRIMARY KEY (wo_uuid, category_id)
);

-- Spare parts used for one job code entry (job code + mechanic) of Step 7, typed in freely (part_name, qty, uom).
-- sparepart_id / part_number only on lines from before, when parts were picked from the spare part master.
CREATE TABLE IF NOT EXISTS wo_job_parts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_job_code_id INTEGER NOT NULL REFERENCES wo_job_codes(id) ON DELETE CASCADE,
  sparepart_id INTEGER REFERENCES spareparts(id),
  part_number  TEXT,
  part_name    TEXT NOT NULL,
  qty          REAL NOT NULL,
  uom          TEXT NOT NULL,
  added_by     INTEGER REFERENCES employees(id),
  added_at     TEXT NOT NULL,
  updated_at   TEXT,
  client_ref   TEXT
);
CREATE INDEX IF NOT EXISTS idx_wo_job_parts_entry ON wo_job_parts(wo_job_code_id);

-- Helpers of a job code entry (Step 7); the entry's mechanic_id is the lead who started it. The lead's start / finish
-- times the whole crew: a helper counts from the start (joined_at NULL) or, when added while it ran, from joined_at.
CREATE TABLE IF NOT EXISTS wo_job_crew (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_job_code_id INTEGER NOT NULL REFERENCES wo_job_codes(id) ON DELETE CASCADE,
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  joined_at      TEXT,
  added_by       INTEGER REFERENCES employees(id),
  added_at       TEXT NOT NULL,
  UNIQUE (wo_job_code_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_wo_job_crew_entry ON wo_job_crew(wo_job_code_id);

-- In-app notifications, one row per recipient; data holds the work order details for the text (JSON).
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type       TEXT NOT NULL, -- WO_CREATED | WO_FINISHED | WO_OVERDUE
  wo_uuid    TEXT REFERENCES work_orders(wo_uuid) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_wo ON notifications(wo_uuid, type);

-- Offline sync: outbox operations from the mechanic app that were applied (op_id is the phone's id for the action),
-- so a resent operation is not applied twice.
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  type       TEXT NOT NULL,
  wo_uuid    TEXT,
  done_at    TEXT NOT NULL, -- when the mechanic did it on the phone
  applied_at TEXT NOT NULL
);
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
  // Admin Company came after Admin Plant: when it is added, Admin Plant becomes Admin Site (own site only) once.
  const firstCompanyAdmin = !db.prepare("SELECT 1 FROM roles WHERE code = 'admin_company'").get();
  for (const r of SYSTEM_ROLES) upsert.run(r.code, r.name, r.description, JSON.stringify(r.permissions));
  if (firstCompanyAdmin && !reset) {
    const site = SYSTEM_ROLES.find((r) => r.code === 'admin');
    db.prepare("UPDATE roles SET name = ?, description = ?, permissions = ? WHERE code = 'admin'").run(site.name, site.description, JSON.stringify(site.permissions));
  }
  // Admin Company keeps every access permission, including ones added in later versions.
  const admin = db.prepare("SELECT permissions FROM roles WHERE code = 'admin_company'").get();
  const current = JSON.parse(admin.permissions);
  const missing = ADMIN_PERMISSIONS.filter((p) => !current.includes(p));
  if (missing.length) db.prepare("UPDATE roles SET permissions = ? WHERE code = 'admin_company'").run(JSON.stringify([...current, ...missing]));
}
ensureSystemRoles();

/**
 * Every site an employee works at is in the site master: missing ones are added as SITE-nn with that employee's
 * company (first used once, when the master was introduced; also after a seed).
 */
export function ensureSitesFromEmployees() {
  const codes = new Set(db.prepare('SELECT site_code FROM sites').all().map((r) => r.site_code));
  const missing = db.prepare(`SELECT e.site, MIN(e.company) AS company FROM employees e
                               WHERE e.site != '' AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.site_name = e.site COLLATE NOCASE)
                               GROUP BY e.site ORDER BY MIN(e.id)`).all();
  const ins = db.prepare('INSERT INTO sites (site_code, site_name, company, is_active) VALUES (?, ?, ?, 1)');
  for (const { site, company } of missing) {
    let n = 1;
    while (codes.has(`SITE-${String(n).padStart(2, '0')}`)) n++;
    const code = `SITE-${String(n).padStart(2, '0')}`;
    codes.add(code);
    ins.run(code, site, company);
  }
  return missing.length;
}
ensureSitesFromEmployees();

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
if (!unitCols.includes('site')) db.exec('ALTER TABLE units ADD COLUMN site TEXT');
if (!columns('work_orders').includes('site')) db.exec('ALTER TABLE work_orders ADD COLUMN site TEXT');

/**
 * Units without a site go to the site most employees work at (else the first site); work orders without one take
 * their unit's site. Run on start (units and work orders from before the site master) and after a seed.
 */
export function fillMissingSites() {
  const main = db.prepare(`SELECT s.site_name FROM sites s
                            ORDER BY (SELECT COUNT(*) FROM employees e WHERE e.site = s.site_name COLLATE NOCASE) DESC, s.id LIMIT 1`).get()?.site_name;
  const units = main ? db.prepare("UPDATE units SET site = ? WHERE site IS NULL OR site = ''").run(main).changes : 0;
  const wos = db.prepare(`UPDATE work_orders SET site = (SELECT u.site FROM units u WHERE u.id = work_orders.unit_id)
                          WHERE site IS NULL OR site = ''`).run().changes;
  return { units, wos };
}
fillMissingSites();

const woCols2 = columns('work_orders');
if (!woCols2.includes('maintenance_type')) db.exec('ALTER TABLE work_orders ADD COLUMN maintenance_type TEXT');
if (!woCols2.includes('maintenance_other')) db.exec('ALTER TABLE work_orders ADD COLUMN maintenance_other TEXT');
// Customer type and payment; empty on work orders from before they were asked.
for (const col of ['customer_type', 'payment_type', 'payment_other'])
  if (!woCols2.includes(col)) db.exec(`ALTER TABLE work_orders ADD COLUMN ${col} TEXT`);
// Optional short names of a site and of its location.
for (const col of ['site_alias', 'location_alias'])
  if (!columns('sites').includes(col)) db.exec(`ALTER TABLE sites ADD COLUMN ${col} TEXT`);

/**
 * Work orders from before the type of maintenance was asked: Preventive when one of their job codes is a periodic
 * maintenance / greasing job, otherwise Repair. Run on start and after a seed.
 */
export function fillMaintenanceTypes() {
  return db.prepare(`UPDATE work_orders SET maintenance_type = CASE WHEN EXISTS (
      SELECT 1 FROM wo_job_codes x JOIN job_codes j ON j.id = x.job_code_id WHERE x.wo_uuid = work_orders.wo_uuid
        AND (j.job_name LIKE '%periodic maintenance%' OR j.job_name LIKE '%preventive maintenance%' OR j.job_name LIKE '%greasing%' OR j.job_name LIKE '%service berkala%')
    ) OR problem LIKE '%servis berkala%' OR problem LIKE '%periodic%' THEN 'PREVENTIVE' ELSE 'REPAIR' END
    WHERE maintenance_type IS NULL`).run().changes;
}
fillMaintenanceTypes();

// Things made offline in the mechanic app carry the phone's reference until they have a server id.
for (const table of ['wo_steps', 'wo_job_codes', 'wo_job_parts']) if (!columns(table).includes('client_ref')) db.exec(`ALTER TABLE ${table} ADD COLUMN client_ref TEXT`);
// Spare part lines became free text: rebuilt once without the required master link, keeping each line's part number and name.
if (!columns('wo_job_parts').includes('part_name')) {
  tx(() => {
    db.exec(`CREATE TABLE wo_job_parts_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_job_code_id INTEGER NOT NULL REFERENCES wo_job_codes(id) ON DELETE CASCADE,
      sparepart_id INTEGER REFERENCES spareparts(id),
      part_number TEXT, part_name TEXT NOT NULL, qty REAL NOT NULL, uom TEXT NOT NULL,
      added_by INTEGER REFERENCES employees(id), added_at TEXT NOT NULL, updated_at TEXT, client_ref TEXT)`);
    db.exec(`INSERT INTO wo_job_parts_new (id, wo_job_code_id, sparepart_id, part_number, part_name, qty, uom, added_by, added_at, updated_at, client_ref)
             SELECT p.id, p.wo_job_code_id, p.sparepart_id, sp.part_number, COALESCE(sp.part_name, '-'), p.qty, p.uom, p.added_by, p.added_at, p.updated_at, p.client_ref
             FROM wo_job_parts p LEFT JOIN spareparts sp ON sp.id = p.sparepart_id`);
    db.exec(`DROP TABLE wo_job_parts; ALTER TABLE wo_job_parts_new RENAME TO wo_job_parts;
             CREATE INDEX IF NOT EXISTS idx_wo_job_parts_entry ON wo_job_parts(wo_job_code_id);`);
  });
}
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
// One job code per work order (work_orders.job_code_id) became a list per work order: move it over once.
if (db.prepare('SELECT 1 FROM work_orders WHERE job_code_id IS NOT NULL LIMIT 1').get()) {
  tx(() => {
    db.exec(`INSERT INTO wo_job_codes (wo_uuid, job_code_id, mechanic_id, added_by, added_at)
             SELECT w.wo_uuid, w.job_code_id, w.mechanic_id, w.mechanic_id, COALESCE(w.started_at, w.created_at)
             FROM work_orders w WHERE w.job_code_id IS NOT NULL AND w.mechanic_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM wo_job_codes x WHERE x.wo_uuid = w.wo_uuid AND x.job_code_id = w.job_code_id)`);
    db.exec('UPDATE work_orders SET job_code_id = NULL WHERE job_code_id IS NOT NULL');
  });
}
const jobEntryCols = columns('wo_job_codes');
if (!jobEntryCols.includes('started_at')) db.exec('ALTER TABLE wo_job_codes ADD COLUMN started_at TEXT');
if (!jobEntryCols.includes('finished_at')) db.exec('ALTER TABLE wo_job_codes ADD COLUMN finished_at TEXT');
const woCols = columns('work_orders');
if (!woCols.includes('hm')) db.exec('ALTER TABLE work_orders ADD COLUMN hm REAL');
if (!woCols.includes('km')) db.exec('ALTER TABLE work_orders ADD COLUMN km REAL');
if (!columns('wo_steps').includes('allow_add_sub')) db.exec('ALTER TABLE wo_steps ADD COLUMN allow_add_sub INTEGER NOT NULL DEFAULT 0');
if (!columns('step_templates').includes('allow_add_sub')) db.exec('ALTER TABLE step_templates ADD COLUMN allow_add_sub INTEGER NOT NULL DEFAULT 0');
// One repair category per work order (work_orders.category_id) became a list (wo_categories). The column stays as the
// first category of the list, so a work order written with it alone (older seed data) gets it listed here.
db.exec(`INSERT OR IGNORE INTO wo_categories (wo_uuid, category_id, added_by, added_at)
         SELECT wo_uuid, category_id, mechanic_id, COALESCE(started_at, created_at) FROM work_orders WHERE category_id IS NOT NULL`);

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
