/**
 * Gives the example job code entries of Step 7 a crew (helpers next to the lead), only on entries that have none yet;
 * nothing else is changed. The standard (MANHOUR) is in man-hours, so a crew is only added where the man-hours stay
 * within the standard (+10%):
 * - finished entries: as many helpers as fit (at most 2), each with the crew's whole time;
 * - a running entry: one helper; not started big jobs (2 h and more): a planned crew, two from 10 h;
 * - small jobs (standard under 1 h) and entries stopped right after the start (under 5 min) stay with the lead alone.
 * Helpers are mechanics not already on that job code of the work order and not busy on another job code at that
 * time (as lead or helper; for a job not started yet: not on the work order at all), those of the work order's site first.
 *
 * Usage: node src/crew-examples.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

const MARGIN = 1.1;

export function fillCrews() {
  const mechanics = db.prepare(`SELECT e.id, e.full_name, e.site FROM employees e JOIN roles r ON r.id = e.role_id
    WHERE e.is_active = 1 AND EXISTS (SELECT 1 FROM json_each(r.permissions) WHERE value = 'wo.as_mechanic') ORDER BY e.id`).all();
  const entries = db.prepare(`SELECT x.*, w.wo_number, w.site, j.job_code, j.standard_duration FROM wo_job_codes x
    JOIN work_orders w ON w.wo_uuid = x.wo_uuid JOIN job_codes j ON j.id = x.job_code_id
    WHERE NOT EXISTS (SELECT 1 FROM wo_job_crew c WHERE c.wo_job_code_id = x.id) ORDER BY w.wo_number, x.id`).all();
  const onJob = db.prepare(`SELECT 1 FROM wo_job_codes x WHERE x.wo_uuid = ? AND x.job_code_id = ?
    AND (x.mechanic_id = ? OR EXISTS (SELECT 1 FROM wo_job_crew c WHERE c.wo_job_code_id = x.id AND c.employee_id = ?))`);
  // Time a mechanic spends on job codes (as lead or helper), to keep a helper from being in two places at once.
  const busy = db.prepare(`SELECT 1 FROM wo_job_codes x WHERE x.id != ? AND x.started_at IS NOT NULL
    AND (x.mechanic_id = ? AND x.started_at < ? AND COALESCE(x.finished_at, ?) > ?
      OR EXISTS (SELECT 1 FROM wo_job_crew c WHERE c.wo_job_code_id = x.id AND c.employee_id = ? AND x.started_at < ? AND COALESCE(x.finished_at, ?) > ?))`);
  const onWo = db.prepare(`SELECT 1 FROM wo_job_codes x WHERE x.wo_uuid = ?
    AND (x.mechanic_id = ? OR EXISTS (SELECT 1 FROM wo_job_crew c WHERE c.wo_job_code_id = x.id AND c.employee_id = ?))`);
  const now = new Date().toISOString();
  const add = db.prepare('INSERT INTO wo_job_crew (wo_job_code_id, employee_id, joined_at, added_by, added_at) VALUES (?, ?, ?, ?, ?)');
  const lines = [];
  tx(() => {
    for (const e of entries) {
      const std = e.standard_duration ?? 0;
      const minutes = e.started_at && e.finished_at ? (Date.parse(e.finished_at) - Date.parse(e.started_at)) / 60000 : null;
      let whole = 0;
      if (e.finished_at) {
        if (std < 60 || minutes < 5) continue;
        while (whole < 2 && minutes * (whole + 2) <= std * MARGIN) whole++;
      } else if (e.started_at) {
        if (std < 30) continue;
        whole = 1;
      } else {
        if (std < 120) continue;
        whole = std >= 600 ? 2 : 1;
      }
      if (!whole) continue;
      // Same site first, then the others, rotated per entry so the crews vary.
      const free = (m) => {
        if (!e.started_at) return !onWo.get(e.wo_uuid, m.id, m.id);
        const to = e.finished_at ?? now;
        return !busy.get(e.id, m.id, to, now, e.started_at, m.id, to, now, e.started_at);
      };
      const pool = mechanics
        .filter((m) => m.id !== e.mechanic_id && !onJob.get(e.wo_uuid, e.job_code_id, m.id, m.id) && free(m))
        .sort((a, b) => (b.site === e.site) - (a.site === e.site) || ((a.id + e.id) % 7) - ((b.id + e.id) % 7));
      const names = [];
      for (let i = 0; i < whole && pool.length; i++) {
        const m = pool.shift();
        add.run(e.id, m.id, null, e.mechanic_id, e.added_at);
        names.push(m.full_name);
      }
      if (names.length) lines.push(`${e.wo_number} ${e.job_code}: + ${names.join(', ')}`);
    }
  });
  return lines;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-crew-examples-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  const lines = fillCrews();
  console.log(`Job code entries given a crew: ${lines.length}${lines.length ? `\n  ${lines.join('\n  ')}` : ''}`);
}
