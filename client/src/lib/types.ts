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
  | 'master.category';
export type WoStatus = 'OPEN' | 'ON_PROGRESS' | 'WAITING' | 'FINISH';
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
  is_active: number;
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
}

export interface WorkOrder {
  wo_uuid: string;
  wo_number: string;
  unit_id: number;
  unit_number: string;
  unit_code: string;
  unit_type: string;
  driver_id: number;
  driver_name: string;
  mechanic_id: number | null;
  mechanic_name: string | null;
  category_id: number | null;
  category: string | null;
  problem: string;
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

export interface WorkOrderDetail extends WorkOrder {
  steps: Step[];
  additional_work: Step[];
  proofs: Proof[];
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
