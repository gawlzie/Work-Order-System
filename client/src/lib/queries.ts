import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import type { Category, DashboardStats, Employee, Paged, Unit, WorkOrder, WorkOrderDetail } from './types';

export interface WoListParams {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  created_start?: string;
  created_end?: string;
  status?: string;
  approval_status?: string;
  channel_source?: string;
  unit_id?: string;
  mechanic_id?: string;
  category_id?: string;
}

export const useWorkOrders = (params: WoListParams) =>
  useQuery({
    queryKey: ['work-orders', params],
    queryFn: () => api<Paged<WorkOrder>>(`/work-orders${qs({ ...params })}`),
    placeholderData: (prev) => prev,
  });

export const useWorkOrder = (id: string | undefined) =>
  useQuery({
    queryKey: ['work-order', id],
    queryFn: () => api<WorkOrderDetail>(`/work-orders/${id}`),
    enabled: !!id,
  });

export const useDashboard = (start: string, end: string) =>
  useQuery({
    queryKey: ['dashboard', start, end],
    queryFn: () => api<DashboardStats>(`/dashboard${qs({ start_date: start, end_date: end })}`),
  });

export const useUnits = () => useQuery({ queryKey: ['units'], queryFn: () => api<Unit[]>('/master/units'), staleTime: 300_000 });

export const useEmployees = (role: 'driver' | 'mechanic') =>
  useQuery({ queryKey: ['employees', role], queryFn: () => api<Employee[]>(`/master/employees?role=${role}`), staleTime: 300_000 });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/master/repair-categories'), staleTime: 300_000 });
