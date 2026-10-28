/** Every permission a role can be granted. Keys are stored in roles.permissions. */
export const PERMISSIONS = [
  { key: 'wo.create', group: 'work_order', label: 'Create work order' },
  { key: 'wo.update', group: 'work_order', label: 'Edit work order' },
  { key: 'wo.delete', group: 'work_order', label: 'Delete work order' },
  { key: 'wo.approve', group: 'work_order', label: 'Approve / reject work order' },
  { key: 'wo.progress', group: 'work_order', label: 'Start / finish steps, add additional work' },
  { key: 'wo.as_driver', group: 'assignment', label: 'Can be selected as driver' },
  { key: 'wo.as_mechanic', group: 'assignment', label: 'Can be selected as PIC mechanic' },
  { key: 'master.unit', group: 'master', label: 'Manage units' },
  { key: 'master.employee', group: 'master', label: 'Manage employees and user accounts' },
  { key: 'master.role', group: 'master', label: 'Manage roles' },
  { key: 'master.step', group: 'master', label: 'Manage repair steps' },
  { key: 'master.category', group: 'master', label: 'Manage repair categories' },
  { key: 'master.job', group: 'master', label: 'Manage job codes' },
  { key: 'master.sparepart', group: 'master', label: 'Manage spare part inventory' },
  { key: 'master.site', group: 'master', label: 'Manage sites' },
  { key: 'site.all', group: 'scope', label: 'All sites of the company (without it: own site only)' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Access rights the Admin Company role can never lose. Assignment flags only decide who appears in driver / mechanic pickers. */
export const ADMIN_PERMISSIONS = PERMISSIONS.filter((p) => p.group !== 'assignment').map((p) => p.key);

/** Admin Site: work orders, units and employees of the own site; company-wide settings stay with Admin Company. */
export const SITE_ADMIN_PERMISSIONS = ['wo.create', 'wo.update', 'wo.delete', 'wo.approve', 'wo.progress', 'master.unit', 'master.employee'];

/**
 * Built-in roles. They cannot be deleted or have their code changed; admin_company always holds ADMIN_PERMISSIONS.
 * The code `admin` stays for Admin Site (it was Admin Plant before Admin Company existed).
 */
export const SYSTEM_ROLES = [
  { code: 'admin_company', name: 'Admin Company', description: 'Highest authority: every site of the company, all master data and roles', permissions: ADMIN_PERMISSIONS },
  { code: 'admin', name: 'Admin Site', description: 'Handles and monitors work orders, units and employees of the own site', permissions: SITE_ADMIN_PERMISSIONS },
  { code: 'mechanic', name: 'Mechanic', description: 'Raises work orders and progresses repair steps', permissions: ['wo.create', 'wo.progress', 'wo.as_mechanic'] },
  { code: 'driver', name: 'Driver', description: 'Unit operator, view only', permissions: ['wo.as_driver'] },
];
