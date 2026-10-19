export type Role = 'admin' | 'mechanic' | 'driver';
export type WoStatus = 'OPEN' | 'ON_PROGRESS' | 'WAITING' | 'FINISH';
export type ApprovalStatus = 'WAITING' | 'APPROVE' | 'APPROVE_BY_SYSTEM' | 'REJECT';
export type Channel = 'WEB' | 'MOBILE' | 'WHATSAPP';

export interface User {
  id: number;
  employee_id: string;
  full_name: string;
  username: string;
  role: Role;
  company: string;
  site: string;
}

export interface Unit {
  id: number;
  unit_code: string;
  unit_number: string;
  unit_type: string;
  brand: string;
  model: string;
}

export interface Employee {
  id: number;
  employee_id: string;
  full_name: string;
  role: Role;
}

export interface Category {
  id: number;
  name: string;
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
  channel_source: Channel;
  created_by_name: string | null;
  created_at: string;
  mobile_sync_time: string | null;
  started_at: string | null;
  finished_at: string | null;
  step_information: string;
  total_time: number;
}

export interface Step {
  id: number;
  parent_id: number | null;
  step_no: number;
  step_name: string;
  is_waiting: number;
  is_additional: number;
  pic_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  remarks: string | null;
  sub_steps: Step[];
}

export interface WorkOrderDetail extends WorkOrder {
  steps: Step[];
  additional_work: Step[];
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
