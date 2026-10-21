/**
 * Site scope. Users whose role holds `site.all` (Admin Company) work across every site of their company; everyone
 * else (Admin Site, mechanics) only sees and handles their own site. Work orders a mechanic is assigned to (PIC
 * mechanic, a job code on Step 7) stay visible to them wherever they are.
 * Data stores the site as its name (units.site, employees.site, work_orders.site).
 */
import { db } from './db.js';
import { PERMISSIONS } from './permissions.js';

export const ALL_SITES = 'site.all';

export const allSites = (user) => user.permissions.includes(ALL_SITES);

/**
 * SQL condition limiting the site-name column `col` to the user's sites, with its params.
 * Company scope only leaves out sites that belong to another company (rows without a site stay visible).
 */
export function siteCondition(user, col) {
  if (allSites(user)) {
    if (!user.company) return { sql: '1', params: [] };
    return {
      sql: `NOT EXISTS (SELECT 1 FROM sites sc WHERE sc.site_name = ${col} COLLATE NOCASE AND sc.company IS NOT NULL AND sc.company != ? COLLATE NOCASE)`,
      params: [user.company],
    };
  }
  return user.site ? { sql: `${col} = ? COLLATE NOCASE`, params: [user.site] } : { sql: '0', params: [] };
}

/** True when the site name is within the user's scope. */
export function inScope(user, site) {
  if (allSites(user)) {
    if (!user.company || !site) return true;
    const row = db.prepare('SELECT company FROM sites WHERE site_name = ? COLLATE NOCASE').get(site);
    return !row?.company || row.company.toLowerCase() === user.company.toLowerCase();
  }
  return !!site && !!user.site && site.toLowerCase() === user.site.toLowerCase();
}

/** SQL condition for work orders (aliased `wo`) the user may see. */
export function woCondition(user, alias = 'wo') {
  const site = siteCondition(user, `${alias}.site`);
  if (allSites(user)) return site;
  return {
    sql: `(${site.sql} OR ${alias}.mechanic_id = ?
           OR EXISTS (SELECT 1 FROM wo_job_codes sx WHERE sx.wo_uuid = ${alias}.wo_uuid AND sx.mechanic_id = ?))`,
    params: [...site.params, user.id, user.id],
  };
}

/** True when the work order exists and the user may see it. */
export function canSeeWo(user, woUuid) {
  const { sql, params } = woCondition(user, 'wo');
  return !!db.prepare(`SELECT 1 FROM work_orders wo WHERE wo.wo_uuid = ? AND ${sql}`).get(woUuid, ...params);
}

// Assignment flags (can be picked as driver / mechanic) are no access rights, so they never block handing out a role.
const FLAGS = new Set(PERMISSIONS.filter((p) => p.group === 'assignment').map((p) => p.key));

/** Roles may only be handed out (or edited) by people who hold every access permission of that role themselves. */
export const coversRole = (user, permissions) => permissions.every((p) => FLAGS.has(p) || user.permissions.includes(p));
