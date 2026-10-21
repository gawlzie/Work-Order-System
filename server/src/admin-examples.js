/**
 * Example admin accounts for the Admin Company / Admin Site roles: one Admin Company account and an Admin Site account
 * for every active site that has none yet. The former "Admin Plant" account (username admin) is renamed after its site.
 * Accounts that exist already (by username) are left alone, so running it twice changes nothing.
 * Password of new accounts: password123.
 *
 * Usage: node src/admin-examples.js   (stop the server first; a backup is written to data/backups/)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashPassword } from './auth.js';
import { DB_PATH, db, tx } from './db.js';

const PASSWORD = 'password123';

/** Short name of a site for account names: "Site Kalimantan - BIB" -> "BIB", "Workshop Balikpapan" -> "Balikpapan". */
const shortName = (site) => (site.includes(' - ') ? site.split(' - ').pop() : site.split(' ').pop()).trim();

export function ensureAdminExamples() {
  const roleId = (code) => db.prepare('SELECT id FROM roles WHERE code = ?').get(code).id;
  const sites = db.prepare('SELECT site_name, company FROM sites WHERE is_active = 1 ORDER BY id').all();
  const company = sites[0]?.company ?? 'Inline Technology International';
  const byUsername = db.prepare('SELECT id FROM employees WHERE username = ?');
  const ins = db.prepare(`INSERT INTO employees (employee_id, full_name, role_id, company, site, username, password_hash, is_active)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
  // Next free ITI-00nn id.
  const nextId = () => {
    let n = 0;
    while (db.prepare('SELECT 1 FROM employees WHERE employee_id = ?').get(`ITI-${String(n).padStart(4, '0')}`)) n++;
    return `ITI-${String(n).padStart(4, '0')}`;
  };
  const added = [];
  tx(() => {
    if (!byUsername.get('admincompany')) {
      ins.run(nextId(), 'Admin Company', roleId('admin_company'), company, sites[0]?.site_name ?? null, 'admincompany', hashPassword(PASSWORD));
      added.push(`admincompany  Admin Company (all sites of ${company})`);
    }
    // The old Admin Plant account keeps its username and site, now as Admin Site.
    const plant = db.prepare("SELECT id, site FROM employees WHERE username = 'admin' AND full_name = 'Admin Plant'").get();
    if (plant?.site) {
      db.prepare('UPDATE employees SET full_name = ? WHERE id = ?').run(`Admin Site ${shortName(plant.site)}`, plant.id);
      added.push(`admin  renamed to Admin Site ${shortName(plant.site)}`);
    }
    for (const { site_name: site, company: siteCompany } of sites) {
      const hasAdmin = db.prepare("SELECT 1 FROM employees e JOIN roles r ON r.id = e.role_id WHERE r.code = 'admin' AND e.is_active = 1 AND e.site = ? COLLATE NOCASE").get(site);
      if (hasAdmin) continue;
      const username = `admin${shortName(site).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (byUsername.get(username)) continue;
      ins.run(nextId(), `Admin Site ${shortName(site)}`, roleId('admin'), siteCompany ?? company, site, username, hashPassword(PASSWORD));
      added.push(`${username}  Admin Site ${shortName(site)} (${site})`);
    }
  });
  return added;
}

export function backupDatabase() {
  const dir = join(dirname(DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wos-before-admin-roles-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Backup: ${backupDatabase()}`);
  const added = ensureAdminExamples();
  console.log(added.length ? `Accounts:\n  ${added.join('\n  ')}` : 'Nothing to add');
}
