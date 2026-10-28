/**
 * Converts work orders that still carry the legacy 6-step flow to the 9-step DEFAULT_STEPS flow, then re-applies
 * the status rules. Work orders, approvals, mechanics, remarks and additional work are kept; only the step rows
 * are rebuilt. A step that maps to two new steps has its time window split in half, so every work order keeps
 * the same start, finish and total time. Work orders that do not have the legacy steps are left alone, so running
 * it twice changes nothing.
 *
 * Usage: node src/sync-steps.js [--dry-run]   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';
import { DEFAULT_STEPS, deriveStatus } from './workorders.js';

const LEGACY_NAMES = ['Unit Check-In', 'Troubleshooting', 'Waiting Part', 'Repair Execution', 'Test & Commissioning', 'Unit Release'];

/** For each new step: [legacy step index, half of a split legacy step (0 / 1) or null]. */
const MAPPING = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, null], [4, null], [5, null]];
/** Legacy step whose sub-steps move to Repair Process. */
const SUB_SOURCE = 3;

if (MAPPING.length !== DEFAULT_STEPS.length) throw new Error('MAPPING does not match DEFAULT_STEPS');

const iso = (ms) => new Date(ms).toISOString();

/** Start / finish / PIC / remarks of a new step derived from its legacy step. */
function mapTimes(old, part) {
  if (!old.started_at) return { started_at: null, finished_at: null, pic_id: null, remarks: null };
  const keep = { pic_id: old.pic_id, remarks: part === 0 ? null : old.remarks };
  if (part === null) return { ...keep, started_at: old.started_at, finished_at: old.finished_at };
  if (!old.finished_at) {
    // Legacy step still running: the first half is the step being worked on now, the second has not started.
    return part === 0 ? { ...keep, started_at: old.started_at, finished_at: null } : { started_at: null, finished_at: null, pic_id: null, remarks: null };
  }
  const start = Date.parse(old.started_at);
  const mid = iso(start + (Date.parse(old.finished_at) - start) / 2);
  return part === 0 ? { ...keep, started_at: old.started_at, finished_at: mid } : { ...keep, started_at: mid, finished_at: old.finished_at };
}

export function syncSteps({ dryRun = false } = {}) {
  const statusCount = () => Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM work_orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const before = statusCount();
  const top = db.prepare('SELECT * FROM wo_steps WHERE wo_uuid = ? AND parent_id IS NULL ORDER BY step_no');
  const children = db.prepare('SELECT * FROM wo_steps WHERE parent_id = ? ORDER BY step_no');
  const del = db.prepare('DELETE FROM wo_steps WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO wo_steps (wo_uuid, parent_id, step_no, step_name, is_waiting, is_additional, allow_add_sub, pic_id, started_at, finished_at, remarks)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  );
  const renumber = db.prepare('UPDATE wo_steps SET step_no = ? WHERE id = ?');
  const setStatus = db.prepare('UPDATE work_orders SET status = ? WHERE wo_uuid = ?');

  let converted = 0;
  let skipped = 0;
  let statusChanged = 0;
  const run = () => {
    for (const { wo_uuid, status } of db.prepare('SELECT wo_uuid, status FROM work_orders ORDER BY created_at').all()) {
      const steps = top.all(wo_uuid);
      const legacy = steps.filter((s) => !s.is_additional);
      const extra = steps.filter((s) => s.is_additional);
      if (legacy.map((s) => s.step_name).join('|') !== LEGACY_NAMES.join('|')) {
        skipped++;
      } else {
        const subs = children.all(legacy[SUB_SOURCE].id);
        legacy.forEach((s) => del.run(s.id)); // sub-steps go with them (ON DELETE CASCADE)
        DEFAULT_STEPS.forEach((def, i) => {
          const [from, part] = MAPPING[i];
          const t = mapTimes(legacy[from], part);
          const { lastInsertRowid } = insert.run(wo_uuid, null, i + 1, def.name, 0, def.addSub ? 1 : 0, t.pic_id, t.started_at, t.finished_at, t.remarks);
          if (from === SUB_SOURCE) {
            subs.forEach((sub, j) => insert.run(wo_uuid, lastInsertRowid, j + 1, sub.step_name, sub.is_additional, 0, sub.pic_id, sub.started_at, sub.finished_at, sub.remarks));
          }
        });
        extra.forEach((s, k) => renumber.run(DEFAULT_STEPS.length + k + 1, s.id));
        converted++;
      }
      // Status only: start / finish times are unchanged by the mapping, and updated_at is left as it was.
      const next = deriveStatus(top.all(wo_uuid));
      if (next !== status) {
        setStatus.run(next, wo_uuid);
        statusChanged++;
      }
    }
  };

  let after;
  try {
    tx(() => {
      run();
      after = statusCount();
      // Roll the transaction back so a dry run saves nothing.
      if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }
  return { converted, skipped, statusChanged, before, after, dryRun };
}

/** Consistent copy of the database (works while it is in WAL mode). */
export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-sync-steps-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) console.log(`Backup: ${backupDatabase()}`);
  const r = syncSteps({ dryRun });
  console.log(`${dryRun ? '[dry run, nothing saved] ' : ''}Converted ${r.converted} work order(s) to the ${DEFAULT_STEPS.length}-step flow, ${r.skipped} already up to date; status changed on ${r.statusChanged}.`);
  console.log(`Status before: ${JSON.stringify(r.before)}`);
  console.log(`Status after:  ${JSON.stringify(r.after)}`);
}
