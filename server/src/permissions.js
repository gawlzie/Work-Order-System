/** Every permission a role can be granted. Keys are stored in roles.permissions. */
export const PERMISSIONS = [
  { key: 'wo.create', group: 'work_order', label: 'Create work order' },
  { key: 'wo.update', group: 'work_order', label: 'Edit work order' },
  { key: 'wo.delete', group: 'work_order', label: 'Delete work order' },
  { key: 'wo.approve', group: 'work_order', label: 'Approve / reject work order (own WOs are auto-approved)' },
  { key: 'wo.progress', group: 'work_order', label: 'Start / finish steps, add additional work' },
  { key: 'wo.as_driver', group: 'assignment', label: 'Can be selected as driver' },
  { key: 'wo.as_mechanic', group: 'assignment', label: 'Can be selected as PIC mechanic' },
  { key: 'master.unit', group: 'master', label: 'Manage units' },
  { key: 'master.employee', group: 'master', label: 'Manage employees and user accounts' },
  { key: 'master.role', group: 'master', label: 'Manage roles' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Access rights the admin role can never lose. Assignment flags only decide who appears in driver / mechanic pickers. */
export const ADMIN_PERMISSIONS = PERMISSIONS.filter((p) => p.group !== 'assignment').map((p) => p.key);

/** Built-in roles. They cannot be deleted or have their code changed; admin always holds ADMIN_PERMISSIONS. */
export const SYSTEM_ROLES = [
  { code: 'admin', name: 'Admin Plant', description: 'Full access to work orders and master data', permissions: ADMIN_PERMISSIONS },
  { code: 'mechanic', name: 'Mechanic', description: 'Raises work orders and progresses repair steps', permissions: ['wo.create', 'wo.progress', 'wo.as_mechanic'] },
  { code: 'driver', name: 'Driver', description: 'Unit operator, view only', permissions: ['wo.as_driver'] },
];
