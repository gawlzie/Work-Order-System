import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.WOS_DB || join(here, '..', 'data', 'wos.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','mechanic','driver')),
  company       TEXT NOT NULL,
  site          TEXT NOT NULL,
  username      TEXT UNIQUE,
  password_hash TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_code   TEXT NOT NULL UNIQUE,
  unit_number TEXT NOT NULL,
  unit_type   TEXT NOT NULL,
  brand       TEXT,
  model       TEXT
);

CREATE TABLE IF NOT EXISTS repair_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS work_orders (
  wo_uuid          TEXT PRIMARY KEY,
  wo_number        TEXT NOT NULL UNIQUE,
  unit_id          INTEGER NOT NULL REFERENCES units(id),
  driver_id        INTEGER NOT NULL REFERENCES employees(id),
  mechanic_id      INTEGER REFERENCES employees(id),
  category_id      INTEGER REFERENCES repair_categories(id),
  problem          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN',
  approval_status  TEXT NOT NULL DEFAULT 'WAITING',
  reject_reason    TEXT,
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
  pic_id        INTEGER REFERENCES employees(id),
  started_at    TEXT,
  finished_at   TEXT,
  remarks       TEXT
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
