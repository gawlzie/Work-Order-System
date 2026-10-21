import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, qs } from './api';
import { useAuth } from './auth';
import { createdDetail, overlayDetail, overlayList, useOutbox } from './offline';
import type { Category, DashboardStats, JobCodeOption, Employee, Paged, PermissionDef, RoleOption, Unit, WorkOrder, WorkOrderDetail, NotificationList, SiteOption, SparepartOption } from './types';

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
  job_code_id?: string;
  created_by?: string;
  site?: string;
}

export const fetchWorkOrder = (id: string) => api<WorkOrderDetail>(`/work-orders/${id}`);

/**
 * Pass `refetchInterval` (ms) to keep a list fresh, e.g. the mechanic job list.
 * Actions still in this phone's outbox (offline) are shown on top of the server data.
 */
export function useWorkOrders(params: WoListParams, refetchInterval?: number) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queue = useOutbox(user?.id);
  const key = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const select = useCallback((page: Paged<WorkOrder>) => overlayList(page, params, queue, qc), [queue, key, qc]);
  return useQuery({
    queryKey: ['work-orders', params],
    queryFn: () => api<Paged<WorkOrder>>(`/work-orders${qs({ ...params })}`),
    placeholderData: (prev) => prev,
    refetchInterval,
    select,
  });
}

/** One work order, with this phone's unsent actions applied; one raised offline is shown from the outbox. */
export function useWorkOrder(id: string | undefined) {
  const { user } = useAuth();
  const queue = useOutbox(user?.id);
  const created = queue.find((o) => o.type === 'wo.create' && o.wo_uuid === id);
  const select = useCallback((wo: WorkOrderDetail) => overlayDetail(wo, queue), [queue]);
  const query = useQuery({ queryKey: ['work-order', id], queryFn: () => fetchWorkOrder(id!), enabled: !!id && !created, select });
  return created ? { ...query, data: createdDetail(created, queue), isLoading: false, isError: false, error: null } : query;
}

/** Steps a new work order gets (offline copy for work orders raised without signal). */
export const useStepTemplate = () =>
  useQuery({ queryKey: ['step-template'], queryFn: () => api<{ name: string; waiting: boolean; addSub: boolean; subs: string[] }[]>('/master/step-template'), staleTime: 3_600_000 });

/** Every active spare part, compact: the Step 7 picker searches it on the phone, also offline. */
export const useSparepartsAll = (enabled = true) =>
  useQuery({ queryKey: ['spareparts', 'all'], queryFn: () => api<SparepartOption[]>('/master/spareparts/all'), staleTime: 3_600_000, enabled });

export const useDashboard = (start: string, end: string, site = '') =>
  useQuery({
    queryKey: ['dashboard', start, end, site],
    queryFn: () => api<DashboardStats>(`/dashboard${qs({ start_date: start, end_date: end, site })}`),
  });

/** Units for dropdowns. Pass `all` to include inactive units (e.g. list filters). */
export const useUnits = (all = false) =>
  useQuery({ queryKey: ['units', all], queryFn: () => api<Unit[]>(`/master/units${all ? '?all=1' : ''}`), staleTime: 300_000 });

export const useEmployees = (role: 'driver' | 'mechanic') =>
  useQuery({ queryKey: ['employees', role], queryFn: () => api<Employee[]>(`/master/employees?role=${role}`), staleTime: 300_000 });

/** Active spare parts matching `search` (part number, name or brand), for the Step 7 picker; needs 2+ characters. */
export const useSparepartSearch = (search: string) =>
  useQuery({
    queryKey: ['spareparts', 'search', search],
    queryFn: () => api<SparepartOption[]>(`/master/spareparts${qs({ search })}`),
    enabled: search.length >= 2,
    staleTime: 60_000,
  });

/** Own notifications, refreshed every 30 s (also while the tab is in the background). */
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationList>('/notifications?limit=30'), refetchInterval: 30_000, refetchIntervalInBackground: true });

/** Sites for dropdowns. Pass `all` to include inactive ones (e.g. list filters). */
export const useSites = (all = false) =>
  useQuery({ queryKey: ['sites', 'options', all], queryFn: () => api<SiteOption[]>(`/master/sites${all ? '?all=1' : ''}`), staleTime: 300_000 });

/** Categories for dropdowns. Pass `all` to include inactive ones (e.g. list filters). */
export const useCategories = (all = false) =>
  useQuery({ queryKey: ['categories', 'options', all], queryFn: () => api<Category[]>(`/master/repair-categories${all ? '?all=1' : ''}`), staleTime: 300_000 });

/** Job codes for the work order picker. Pass `all` to include inactive ones (e.g. list filters). */
export const useJobCodeOptions = (all = false) =>
  useQuery({ queryKey: ['job-codes', 'options', all], queryFn: () => api<JobCodeOption[]>(`/master/job-codes${all ? '?all=1' : ''}`), staleTime: 300_000 });

export const useRoleOptions = () =>
  useQuery({ queryKey: ['roles', 'options'], queryFn: () => api<RoleOption[]>('/master/roles'), staleTime: 300_000 });

export const usePermissionDefs = () =>
  useQuery({ queryKey: ['roles', 'permissions'], queryFn: () => api<PermissionDef[]>('/roles/permissions'), staleTime: Infinity });

export const useUnitTypes = () => useQuery({ queryKey: ['units', 'types'], queryFn: () => api<string[]>('/units/types') });

/** Brand / model pairs already used on units (suggestions in the unit form). */
export const useUnitModels = () =>
  useQuery({ queryKey: ['units', 'models'], queryFn: () => api<{ brand: string; model: string | null }[]>('/units/models') });

/** Paged master-data list, e.g. usePaged<MasterUnit>('units', params). Query key starts with the path for invalidation. */
export const usePaged = <T,>(path: 'units' | 'employees' | 'roles' | 'categories' | 'job-codes' | 'spareparts' | 'sites', params: Record<string, unknown>) =>
  useQuery({
    queryKey: [path, 'list', params],
    queryFn: () => api<Paged<T>>(`/${path}${qs(params)}`),
    placeholderData: (prev) => prev,
  });
