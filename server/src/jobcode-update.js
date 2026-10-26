/**
 * Brings the job code master in line with the job code list of 26 Oct 2026 (data/jobcodes-2026-10-26.json, taken
 * from "JOBCODE 26 OCT 2026.xlsx", sheet JOBCODE DATABASE):
 * - COMPONENT is the repair category; categories that do not exist yet are added (spelling variants such as
 *   "Gardan Tengah Belakang" or "Hose Hyd" use the existing category).
 * - MANHOUR (hours) becomes the standard duration in minutes; 0 or empty means not known ("-").
 * - Job codes that are new are added, their name without the Chinese translation.
 * - Existing job codes keep their name unless the list marks it as revised (REVISE / DOUBLE) with a different text.
 * - A code listed twice keeps its first row; job codes no longer in the list are deactivated (not deleted).
 * - Work orders follow: when a job code on a work order moves to another category, that category is added to the
 *   work order, and a category left without job codes by the move is taken off.
 * Running it again changes nothing.
 *
 * Usage: node src/jobcode-update.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DB_PATH, db, tx } from './db.js';

const LIST = join(dirname(fileURLToPath(import.meta.url)), 'data', 'jobcodes-2026-10-26.json');

/** COMPONENT spellings that mean an existing category, and names for the new categories. */
const COMPONENT_ALIASES = { hosehyd: 'hosehydraulic', commisioning: 'commissioning' };
const NEW_CATEGORY_NAMES = { commissioning: 'Commissioning', training: 'Training' };
/** Words kept in capitals when an all-capitals name is written in title case. */
const ACRONYMS = new Set(['AC', 'ADAS', 'APAR', 'BCM', 'BTMS', 'DCU', 'DMS', 'DT', 'ECM', 'ECU', 'HM', 'KM', 'LH', 'PDI', 'PM', 'PTO', 'QC', 'RH', 'TRL']);

const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Name without the Chinese translation that follows it ("PENGGANTIAN RADIATOR AC·更换空调散热器"). */
export function cleanName(text) {
  const cut = text.search(/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u);
  return (cut < 0 ? text : text.slice(0, cut)).replace(/[\s·.(]+$/u, '').replace(/\s+/g, ' ').trim();
}

/** "PEMASANGAN BRACKET APAR" -> "Pemasangan Bracket APAR"; names already in mixed case stay as written. */
export function titleCase(name) {
  if (name !== name.toUpperCase()) return name;
  return name.replace(/[A-Z]+/g, (word, at, all) => {
    if (ACRONYMS.has(word) || /\d/.test(all[at - 1] ?? '') || /\d/.test(all[at + word.length] ?? '')) return word;
    if (word === 'DAN') return 'dan';
    return word[0] + word.slice(1).toLowerCase();
  });
}

const minutes = (manhour) => (manhour ? Math.round(manhour * 60) : null);

export function updateJobCodes(list = JSON.parse(readFileSync(LIST, 'utf8'))) {
  const report = { categoriesAdded: [], added: [], categoryChanged: [], durationChanged: [], renamed: [], deactivated: [], duplicates: [], woCategories: [] };
  tx(() => {
    const categories = new Map(db.prepare('SELECT id, name FROM repair_categories').all().map((c) => [key(c.name), c]));
    const categoryOf = (component) => {
      const k = COMPONENT_ALIASES[key(component)] ?? key(component);
      if (!categories.has(k)) {
        const name = NEW_CATEGORY_NAMES[k] ?? component;
        const { lastInsertRowid } = db.prepare('INSERT INTO repair_categories (name, is_active) VALUES (?, 1)').run(name);
        categories.set(k, { id: Number(lastInsertRowid), name });
        report.categoriesAdded.push(name);
      }
      return categories.get(k);
    };

    // Categories that each work order's job codes are in before the update.
    const woJobCategories = () => db.prepare(`SELECT x.wo_uuid, j.category_id, COUNT(*) AS n FROM wo_job_codes x
      JOIN job_codes j ON j.id = x.job_code_id GROUP BY x.wo_uuid, j.category_id`).all();
    const before = woJobCategories();

    const existing = new Map(db.prepare('SELECT * FROM job_codes').all().map((j) => [j.job_code.toUpperCase(), j]));
    const names = new Map([...categories.values()].map((c) => [c.id, c.name]));
    const seen = new Set();
    const update = db.prepare('UPDATE job_codes SET job_name = ?, category_id = ?, standard_duration = ? WHERE id = ?');
    const insert = db.prepare('INSERT INTO job_codes (job_code, job_name, category_id, standard_duration, is_active) VALUES (?, ?, ?, ?, 1)');
    for (const row of list) {
      const code = row.code.toUpperCase();
      if (seen.has(code)) {
        report.duplicates.push(`${code} "${cleanName(row.description)}" (only the first row of this code is used)`);
        continue;
      }
      seen.add(code);
      const category = categoryOf(row.component);
      names.set(category.id, category.name);
      const duration = minutes(row.manhour);
      const name = titleCase(cleanName(row.description));
      const job = existing.get(code);
      if (!job) {
        insert.run(code, name, category.id, duration);
        report.added.push(`${code} ${name} · ${category.name} · ${duration ?? '-'} min`);
        continue;
      }
      const revised = /revise|double/i.test(row.note ?? '') && key(name) !== key(job.job_name);
      const jobName = revised ? name : job.job_name;
      if (revised) report.renamed.push(`${code}: "${job.job_name}" -> "${jobName}"`);
      if (category.id !== job.category_id) report.categoryChanged.push(`${code} ${jobName}: ${names.get(job.category_id)} -> ${category.name}`);
      if (duration !== job.standard_duration) report.durationChanged.push(`${code}: ${job.standard_duration ?? '-'} -> ${duration ?? '-'} min`);
      if (revised || category.id !== job.category_id || duration !== job.standard_duration) update.run(jobName, category.id, duration, job.id);
    }
    for (const [code, job] of existing)
      if (!seen.has(code) && job.is_active) {
        db.prepare('UPDATE job_codes SET is_active = 0 WHERE id = ?').run(job.id);
        report.deactivated.push(`${code} ${job.job_name}`);
      }

    // Work orders: the categories of their job codes are on the work order; a category emptied by the move goes.
    const after = woJobCategories();
    const has = (rows, wo, cat) => rows.some((r) => r.wo_uuid === wo && r.category_id === cat);
    const woNumber = db.prepare('SELECT wo_number FROM work_orders WHERE wo_uuid = ?');
    for (const r of after) {
      if (has(before, r.wo_uuid, r.category_id)) continue;
      // Keeps the place in the list of the category the job codes came from.
      const from = before.find((b) => b.wo_uuid === r.wo_uuid && !has(after, b.wo_uuid, b.category_id));
      const origin = from && db.prepare('SELECT added_by, added_at FROM wo_categories WHERE wo_uuid = ? AND category_id = ?').get(r.wo_uuid, from.category_id);
      const first = origin ?? db.prepare('SELECT added_by, added_at FROM wo_categories WHERE wo_uuid = ? ORDER BY added_at LIMIT 1').get(r.wo_uuid);
      const added = db.prepare('INSERT OR IGNORE INTO wo_categories (wo_uuid, category_id, added_by, added_at) VALUES (?, ?, ?, ?)')
        .run(r.wo_uuid, r.category_id, first?.added_by ?? null, first?.added_at ?? new Date().toISOString());
      if (added.changes) report.woCategories.push(`${woNumber.get(r.wo_uuid).wo_number}: + ${names.get(r.category_id)}`);
    }
    for (const b of before) {
      if (has(after, b.wo_uuid, b.category_id)) continue;
      db.prepare('DELETE FROM wo_categories WHERE wo_uuid = ? AND category_id = ?').run(b.wo_uuid, b.category_id);
      report.woCategories.push(`${woNumber.get(b.wo_uuid).wo_number}: - ${names.get(b.category_id)}`);
      // work_orders.category_id follows the first category of the list.
      db.prepare(`UPDATE work_orders SET category_id = (SELECT wc.category_id FROM wo_categories wc JOIN repair_categories c ON c.id = wc.category_id
                    WHERE wc.wo_uuid = work_orders.wo_uuid ORDER BY wc.added_at, c.name LIMIT 1) WHERE wo_uuid = ?`).run(b.wo_uuid);
    }
  });
  return report;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-jobcode-update-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  const report = updateJobCodes();
  for (const [what, lines] of Object.entries(report)) console.log(`${what}: ${lines.length}${lines.length ? `\n  ${lines.join('\n  ')}` : ''}`);
}
