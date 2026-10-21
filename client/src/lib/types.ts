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
  | 'master.site';
export type WoStatus = 'OPEN' | 'ON_PROGRESS' | 'WAITING' | 'FINISH';
export type MaintenanceType = 'PREVENTIVE' | 'REPAIR' | 'WARRANTY' | 'PDI' | 'OTHERS';
export type ApprovalStatus = 'WAITING' | 'APPROVE' | 'REJECT';
export type Channel = 'WEB' | 'MOBILE' | 'WHATSAPP';

export interface User {
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
}

export interface RoleOption {
  id: number;
  code: string;
  name: string;
}

export interface MasterRole extends RoleOption {
  description: string | null;
  permissions: Permission[];
  is_system: number;
  employee_count: number;
}

export interface PermissionDef {
  key: Permission;
  group: 'work_order' | 'assignment' | 'master';
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
  /** Sum of the standard durations of the WO's job codes in minutes, null when none is known. */
  job_standard_duration: number | null;
  /** Seconds spent in the repair step (Repair Process); null before it starts. Compared with the job standard. */
  repair_time: number | null;
  problem: string;
  maintenance_type: MaintenanceType | null;
  /** Description when maintenance_type is OTHERS. */
  maintenance_other: string | null;
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
}

/** One spare part line of a job code entry; uom is the part's unit when it was added. */
export interface WoJobPart {
  id: number;
  wo_job_code_id: number;
  sparepart_id: number;
  part_number: string;
  part_name: string;
  qty: number;
  uom: string;
  added_by_name: string | null;
  added_at: string;
  updated_at: string | null;
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
  job_codes: WoJobCode[];
}

export interface MasterSite {
  id: number;
  site_code: string;
  site_name: string;
  company: string;
  location: string | null;
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
