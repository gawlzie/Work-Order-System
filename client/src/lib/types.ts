export type Permission =
  | 'wo.create'
  | 'wo.update'
  | 'wo.delete'
  | 'wo.approve'
  | 'wo.progress'
  | 'wo.as_driver'
  | 'wo.as_mechanic'
  | 'master.unit'
  | 'master.employee'
  | 'master.role'
  | 'master.step'
  | 'master.category'
  | 'master.job'
  | 'master.sparepart'
  | 'master.site'
  | 'site.all';
export type WoStatus = 'OPEN' | 'ON_PROGRESS' | 'WAITING' | 'FINISH';
export type MaintenanceType = 'PREVENTIVE' | 'REPAIR' | 'WARRANTY' | 'PDI' | 'OTHERS';
export type CustomerType = 'INTERNAL' | 'EXTERNAL';
export type PaymentType = 'CUSTOMER_PAID' | 'FREE' | 'OTHERS';
export type ApprovalStatus = 'WAITING' | 'APPROVE' | 'REJECT';
export type Channel = 'WEB' | 'MOBILE' | 'WHATSAPP';

export interface User {
  /** Set until the user replaces a shared or admin-set password with their own. */
  must_change_password?: boolean;
  id: number;
  employee_id: string;
  full_name: string;
  username: string;
  /** Role code, e.g. admin / mechanic / driver or a custom role. */
  role: string;
  role_name: string;
  permissions: Permission[];
  company: string;
  site: string;
  phone: string | null;
  email: string | null;
}

export interface Unit {
  id: number;
  unit_code: string;
  unit_number: string;
  unit_type: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  year: number | null;
  /** Site name (site master). */
  site: string | null;
  is_active: number;
  /** Last recorded readings (WO form hint); only on the unit lookup. */
  last_hm?: number | null;
  last_hm_wo?: string | null;
  last_km?: number | null;
  last_km_wo?: string | null;
}

export interface Employee {
  id: number;
  employee_id: string;
  full_name: string;
  role: string;
  /** Site name (driver / mechanic pickers). */
  site?: string | null;
}

export interface RoleOption {
  id: number;
  code: string;
  name: string;
  /** Company-wide role (site.all): its employees have no site of their own. Only on the role picker list. */
  all_sites?: boolean;
}

export interface MasterRole extends RoleOption {
  description: string | null;
  permissions: Permission[];
  is_system: number;
  employee_count: number;
}

export interface PermissionDef {
  key: Permission;
  group: 'work_order' | 'assignment' | 'master' | 'scope';
  label: string;
}

export interface MasterEmployee {
  id: number;
  employee_id: string;
  full_name: string;
  role_id: number;
  role: string;
  role_name: string;
  company: string;
  site: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  has_account: number;
  is_active: number;
}

export interface MasterUnit extends Unit {
  wo_count: number;
  active_wo: string | null;
}

/** Step master entry; work orders copy the active ones when they are created. */
export interface StepTemplate {
  id: number;
  sort_order: number;
  name: string;
  description: string | null;
  is_waiting: number;
  allow_add_sub: number;
  is_active: number;
  sub_steps: { id: number; name: string }[];
}

export interface Category {
  id: number;
  name: string;
  is_active: number;
}

export interface MasterCategory extends Category {
  description: string | null;
  wo_count: number;
  job_count: number;
}

/** Standard repair job within a category. */
export interface MasterJobCode {
  id: number;
  job_code: string;
  job_name: string;
  category_id: number;
  category_name: string;
  category_active: number;
  /** Planned repair time in minutes; null when unknown (shown as "-"). */
  standard_duration: number | null;
  is_active: number;
  wo_count: number;
}

/** Job code entry for the work order picker. */
export interface JobCodeOption {
  id: number;
  job_code: string;
  job_name: string;
  category_id: number;
  category_name: string;
  standard_duration: number | null;
  is_active: number;
}

export interface WorkOrder {
  wo_uuid: string;
  wo_number: string;
  unit_id: number;
  unit_number: string;
  unit_code: string;
  unit_type: string;
  unit_brand: string | null;
  unit_model: string | null;
  /** Unit serial / VIN number. */
  unit_serial: string | null;
  /** Company of the WO's site (site master). */
  site_company: string | null;
  driver_id: number;
  driver_name: string;
  mechanic_id: number | null;
  mechanic_name: string | null;
  category_id: number | null;
  category: string | null;
  /** Job codes done on this WO, comma separated (null when none). */
  job_code_list: string | null;
  /** Spare parts used, e.g. "VG61000070005 x2 PCS; ..." (null when none). */
  part_list: string | null;
  /** Seconds spent in the repair step (Repair Process); null before it starts. */
  repair_time: number | null;
  problem: string;
  maintenance_type: MaintenanceType | null;
  /** Notes on the type of maintenance (any type; for OTHERS they describe it). */
  maintenance_other: string | null;
  /** Customer type and payment (null on work orders from before they were asked); payment_other describes Others. */
  customer_type: CustomerType | null;
  payment_type: PaymentType | null;
  payment_other: string | null;
  /** Site of the unit when the WO was raised. */
  site: string | null;
  /** Hour meter and odometer readings when the WO was raised (null on older WOs). */
  hm: number | null;
  km: number | null;
  status: WoStatus;
  approval_status: ApprovalStatus;
  reject_reason: string | null;
  /** Optional note the approver adds when approving, e.g. instructions for the mechanic. */
  approval_remarks: string | null;
  channel_source: Channel;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  mobile_sync_time: string | null;
  started_at: string | null;
  finished_at: string | null;
  step_information: string;
  total_time: number;
  /** Number of proof-of-completion files. */
  proof_count: number;
}

export interface Step {
  id: number;
  parent_id: number | null;
  step_no: number;
  step_name: string;
  is_waiting: number;
  is_additional: number;
  /** Mechanics may add their own sub-steps to this step in the app (e.g. Repair Process). */
  allow_add_sub: number;
  pic_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  remarks: string | null;
  sub_steps: Step[];
  /** Reference of additional work added offline in the mechanic app. */
  client_ref?: string | null;
}

/** Proof-of-completion file (PDF or image) of a finished work order. */
export interface Proof {
  id: number;
  file_name: string;
  mime_type: string;
  size: number;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

/** A job code done on a work order and the mechanic who did it (added in Step 7). */
export interface WoJobCode {
  id: number;
  job_code_id: number;
  job_code: string;
  job_name: string;
  /** Missing on copies saved by the older app. */
  category_id?: number;
  category_name: string;
  standard_duration: number | null;
  mechanic_id: number;
  mechanic_name: string;
  added_by_name: string | null;
  added_at: string;
  /** Each job code has its own timer, run during Step 7. */
  started_at: string | null;
  finished_at: string | null;
  /** Spare parts used for this job code entry. */
  parts: WoJobPart[];
  /** Helpers working with the lead (mechanic_id); the lead's timer counts for them. Missing on copies of the older app. */
  crew?: WoJobCrew[];
  /** Reference when it was added offline in the mechanic app. */
  client_ref?: string | null;
}

/** A helper on a job code entry: gets the same time as the lead (the crew's start to finish). */
export interface WoJobCrew {
  employee_id: number;
  full_name: string;
  /** No longer used (always null). */
  joined_at: string | null;
  added_at: string;
}

/** Lead and helpers of a job code entry, e.g. "Budi, Andi, Rudi". */
export const crewNames = (j: WoJobCode) => [j.mechanic_name, ...(j.crew ?? []).map((c) => c.full_name)].join(', ');

/** One spare part line of a job code entry, typed freely; part_number / sparepart_id only on lines from the former spare part master. */
export interface WoJobPart {
  id: number;
  wo_job_code_id: number;
  sparepart_id: number | null;
  part_number: string | null;
  part_name: string;
  qty: number;
  uom: string;
  added_by_name: string | null;
  added_at: string;
  updated_at: string | null;
  /** Reference when it was added offline in the mechanic app. */
  client_ref?: string | null;
}

/** Spare part in the Step 7 picker. */
export interface SparepartOption {
  id: number;
  part_number: string;
  part_name: string;
  uom: string;
  brand: string | null;
  stock: number;
}

export interface WorkOrderDetail extends WorkOrder {
  steps: Step[];
  additional_work: Step[];
  proofs: Proof[];
  /** Repair categories chosen in Step 7 (one or more); missing on copies saved by the older app, see woCategories(). */
  categories?: WoCategory[];
  job_codes: WoJobCode[];
}

/** A repair category on a work order, with how many of its job codes the work order holds. */
export interface WoCategory {
  id: number;
  name: string;
  is_active: number;
  added_at: string;
  job_count: number;
}

/** Categories of a work order; from the single category of copies saved by the older app. */
export const woCategories = (wo: WorkOrderDetail): WoCategory[] =>
  wo.categories ?? (wo.category_id ? [{ id: wo.category_id, name: wo.category ?? '', is_active: 1, added_at: wo.created_at, job_count: wo.job_codes.length }] : []);

export interface MasterSite {
  id: number;
  site_code: string;
  site_name: string;
  company: string;
  location: string | null;
  /** Optional short names, e.g. BIB / KUKAR. */
  site_alias: string | null;
  location_alias: string | null;
  is_active: number;
  employee_count: number;
  unit_count: number;
  wo_count: number;
}

/** Site for dropdowns (employee form, filters). */
export interface SiteOption {
  id: number;
  site_code: string;
  site_name: string;
  company: string;
  is_active: number;
}

export interface MasterSparepart {
  id: number;
  part_number: string;
  part_name: string;
  category_id: number | null;
  category_name: string | null;
  category_active: number | null;
  brand: string | null;
  uom: string;
  stock: number;
  min_stock: number;
  location: string | null;
  /** Price per unit in rupiah; null when unknown. */
  unit_price: number | null;
  is_active: number;
  /** out: no stock, low: at or below the minimum, ok: above it. */
  stock_status: 'ok' | 'low' | 'out';
}

/** Stock alerts over all active spare parts, returned next to the paged list. */
export interface SparepartSummary {
  total: number;
  low: number;
  out: number;
  stock_value: number;
}

/** In-app notification (own); the text is built from type and data in the reader's language. */
export interface AppNotification {
  id: number;
  type: 'WO_CREATED' | 'WO_FINISHED' | 'WO_OVERDUE';
  wo_uuid: string | null;
  data: { wo_number: string; unit_number: string; site: string | null; problem: string; hours: number };
  created_at: string;
  read_at: string | null;
  /** Who caused it, e.g. the mechanic who raised the WO. */
  actor_name: string | null;
}

export interface NotificationList {
  data: AppNotification[];
  unread: number;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; total_pages: number };
}

export interface DashboardStats {
  total: number;
  open: number;
  on_progress: number;
  waiting: number;
  finish: number;
  total_time: number;
  average_time: number;
  pending_approval: number;
  by_category: { name: string; count: number }[];
}
