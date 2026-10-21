/**
 * Offline mode of the mechanic app.
 *
 * 1. Outbox: every mechanic action (start / finish a step, job codes, spare parts, new work order, ...) is stored on the
 *    phone first, with the time it was done, and sent to POST /api/sync one by one, in order, whenever there is
 *    signal. A failed send because of no signal is simply tried again later; an action the server refuses (e.g. the
 *    step was taken by someone else meanwhile) stays in the outbox as "failed" with the reason, for the mechanic to
 *    discard. Things made offline get a reference (client_ref) the server keeps, so later actions can point at them.
 * 2. Overlay: until an action is synchronized, the job lists and job screens show it on top of the last data from
 *    the server, with the same status rules as the server.
 * 3. Offline copy: the data the app has loaded (jobs, job details, units, drivers, job codes, spare parts, ...) is
 *    saved on the phone and loaded again on start, so the app opens and works without signal.
 */
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api, ApiError } from './api';
import { idbDel, idbGet, idbSet } from './idb';
import type { Paged, Step, User, WoJobCode, WoJobPart, WorkOrder, WorkOrderDetail } from './types';

/* ---------- Outbox ---------- */

export type OpType =
  | 'wo.create'
  | 'step.start'
  | 'step.finish'
  | 'work.add'
  | 'category.set'
  | 'job.add'
  | 'job.start'
  | 'job.finish'
  | 'job.remove'
  | 'part.add'
  | 'part.update'
  | 'part.remove';

/** Fields sent to the server for an action; `view` only feeds the screen until it is synchronized. */
export interface OpInput {
  type: OpType;
  wo_uuid: string;
  /** Short text for the outbox list, e.g. "Start 3. Inspection Activity". */
  label: string;
  step_id?: number;
  step_no?: number;
  step_ref?: string;
  remarks?: string;
  name?: string;
  category_id?: number;
  job_code_id?: number;
  mechanic_id?: number;
  entry_id?: number;
  entry_ref?: string;
  /** Older app versions sent a picked master part instead of a typed name. */
  sparepart_id?: number;
  part_name?: string;
  uom?: string;
  qty?: number | string;
  line_id?: number;
  line_ref?: string;
  body?: Record<string, unknown>;
  view?: Record<string, unknown>;
}

export interface OutboxOp extends OpInput {
  op_id: string;
  at: string;
  user_id: number;
  user_name: string;
  state: 'pending' | 'failed';
  error?: string;
}

const OUTBOX_KEY = 'outbox';
let ops: OutboxOp[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const save = () => idbSet(OUTBOX_KEY, ops);

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
/** Reference for something made offline (job code entry, spare part line, additional work). */
export const newRef = () => newId().replace(/-/g, '').slice(0, 20);
/** Stable negative id for an item that only exists on the phone yet. */
const tempId = (ref: string) => -parseInt(ref.slice(0, 8), 16) - 1;

export async function loadOutbox() {
  if (loaded) return;
  ops = (await idbGet<OutboxOp[]>(OUTBOX_KEY)) ?? [];
  loaded = true;
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The current user's outbox (pending and failed actions), re-rendering on every change. */
export function useOutbox(userId: number | undefined) {
  const all = useSyncExternalStore(subscribe, () => ops);
  return userId == null ? [] : all.filter((o) => o.user_id === userId);
}

export const outboxOf = (userId: number | undefined) => (userId == null ? [] : ops.filter((o) => o.user_id === userId));

/** Stores an action and tries to send it right away. Returns the stored op. */
export function enqueue(input: OpInput, user: User) {
  const op: OutboxOp = { ...input, op_id: newId(), at: new Date().toISOString(), user_id: user.id, user_name: user.full_name, state: 'pending' };
  ops = [...ops, op];
  void save();
  emit();
  void flush();
  return op;
}

/** Drops an action (e.g. one the server refused); later actions on the same job are sent again. */
export function discard(opId: string) {
  ops = ops.filter((o) => o.op_id !== opId);
  void save();
  emit();
  void flush();
}

/* ---------- Sending ---------- */

interface SyncState {
  running: boolean;
  /** No signal / server not reachable on the last try. */
  offline: boolean;
  lastSync: string | null;
}
let sync: SyncState = { running: false, offline: false, lastSync: null };
const setSync = (patch: Partial<SyncState>) => {
  sync = { ...sync, ...patch };
  emit();
};
export const useSyncState = () => useSyncExternalStore(subscribe, () => sync);

let client: QueryClient | null = null;
let currentUser: () => User | null = () => null;

/** Starts sending the outbox: now, when the signal comes back and every 20 s. */
export function startSync(qc: QueryClient, getUser: () => User | null) {
  client = qc;
  currentUser = getUser;
  window.addEventListener('online', () => void flush());
  setInterval(() => void flush(), 20_000);
  void flush();
}

let flushing: Promise<void> | null = null;
export function flush(): Promise<void> {
  flushing ??= doFlush().finally(() => (flushing = null));
  return flushing;
}

async function doFlush() {
  const user = currentUser();
  if (!loaded || !user || !client) return;
  const mine = () => ops.filter((o) => o.user_id === user.id);
  if (!mine().some((o) => o.state === 'pending')) return;
  setSync({ running: true });
  const touched = new Set<string>();
  try {
    for (;;) {
      // Oldest pending action of a job that has no failed action before it.
      const blocked = new Set(mine().filter((o) => o.state === 'failed').map((o) => o.wo_uuid));
      const op = mine().find((o) => o.state === 'pending' && !blocked.has(o.wo_uuid));
      if (!op) break;
      const { view: _view, label: _label, state: _state, error: _error, user_name: _name, user_id: _uid, ...payload } = op;
      try {
        const res = await api<{ work_order: WorkOrderDetail }>('/sync', { method: 'POST', body: payload });
        ops = ops.filter((o) => o.op_id !== op.op_id);
        client.setQueryData(['work-order', op.wo_uuid], res.work_order);
        touched.add(op.wo_uuid);
        setSync({ offline: false, lastSync: new Date().toISOString() });
      } catch (err) {
        const refused = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429;
        if (!refused) {
          // No signal, server down or login expired: keep everything and try again later.
          setSync({ offline: !(err instanceof ApiError) || err.status >= 500 });
          break;
        }
        ops = ops.map((o) => (o.op_id === op.op_id ? { ...o, state: 'failed', error: (err as Error).message } : o));
      }
      await save();
      emit();
    }
  } finally {
    setSync({ running: false });
    if (touched.size) {
      void client.invalidateQueries({ queryKey: ['work-orders'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
      for (const id of touched) void client.invalidateQueries({ queryKey: ['work-order', id], refetchType: 'none' });
    }
  }
}

/* ---------- Overlay: show unsent actions on top of the server data ---------- */

/** Same rule as the server: all steps done = FINISH, one running = ON_PROGRESS, started before = WAITING, else OPEN. */
function deriveStatus(steps: Step[]): WorkOrder['status'] {
  if (steps.length && steps.every((s) => s.finished_at)) return 'FINISH';
  if (steps.some((s) => s.started_at && !s.finished_at)) return 'ON_PROGRESS';
  if (steps.some((s) => s.started_at)) return 'WAITING';
  return 'OPEN';
}

const findStep = (steps: Step[], op: OutboxOp) =>
  steps.find((s) => (op.step_ref ? s.client_ref === op.step_ref : op.step_no != null && !s.is_additional ? s.step_no === op.step_no : s.id === op.step_id));
const findEntry = (wo: WorkOrderDetail, op: OutboxOp) =>
  wo.job_codes.find((j) => (op.entry_ref && j.client_ref === op.entry_ref) || (op.entry_id != null && j.id === op.entry_id));
const findLine = (entry: WoJobCode, op: OutboxOp) =>
  entry.parts.find((p) => (op.line_ref && p.client_ref === op.line_ref) || (op.line_id != null && p.id === op.line_id));

function applyOp(wo: WorkOrderDetail, op: OutboxOp): WorkOrderDetail {
  const v = (op.view ?? {}) as Record<string, never>;
  const steps = wo.steps.map((s) => ({ ...s }));
  const extra = wo.additional_work.map((s) => ({ ...s }));
  const jobs = wo.job_codes.map((j) => ({ ...j, parts: [...(j.parts ?? [])] }));
  let next: WorkOrderDetail = { ...wo, steps, additional_work: extra, job_codes: jobs };
  switch (op.type) {
    case 'step.start': {
      const s = findStep([...steps, ...extra], op);
      if (s && !s.started_at) {
        s.started_at = op.at;
        s.pic_name = op.user_name;
        if (!next.mechanic_id) next = { ...next, mechanic_id: op.user_id, mechanic_name: op.user_name };
      }
      break;
    }
    case 'step.finish': {
      const s = findStep([...steps, ...extra], op);
      if (s && s.started_at && !s.finished_at) {
        s.finished_at = op.at < s.started_at ? s.started_at : op.at;
        if (op.remarks) s.remarks = op.remarks;
      }
      break;
    }
    case 'work.add': {
      if (!extra.some((s) => s.client_ref === op.step_ref)) {
        const max = Math.max(0, ...[...steps, ...extra].map((s) => s.step_no));
        extra.push({
          id: tempId(op.step_ref!), parent_id: null, step_no: max + 1, step_name: op.name ?? '', is_waiting: 0, is_additional: 1, allow_add_sub: 0,
          pic_name: null, started_at: null, finished_at: null, remarks: null, sub_steps: [], client_ref: op.step_ref,
        });
      }
      break;
    }
    case 'category.set':
      next = { ...next, category_id: op.category_id ?? null, category: (v.category_name as string) ?? next.category };
      break;
    case 'job.add':
      if (!jobs.some((j) => j.client_ref === op.entry_ref)) {
        jobs.push({
          id: tempId(op.entry_ref!), client_ref: op.entry_ref, job_code_id: op.job_code_id!, job_code: v.job_code, job_name: v.job_name, category_name: v.category_name,
          standard_duration: v.standard_duration ?? null, mechanic_id: op.mechanic_id!, mechanic_name: v.mechanic_name, added_by_name: op.user_name, added_at: op.at,
          started_at: null, finished_at: null, parts: [],
        });
      }
      break;
    case 'job.start':
    case 'job.finish': {
      const e = findEntry(next, op);
      if (e && op.type === 'job.start' && !e.started_at) e.started_at = op.at;
      if (e && op.type === 'job.finish' && e.started_at && !e.finished_at) e.finished_at = op.at < e.started_at ? e.started_at : op.at;
      break;
    }
    case 'job.remove':
      next = { ...next, job_codes: jobs.filter((j) => j !== findEntry(next, op)) };
      break;
    case 'part.add': {
      const e = findEntry(next, op);
      if (e && !e.parts.some((p) => p.client_ref === op.line_ref)) {
        e.parts.push({
          id: tempId(op.line_ref!), client_ref: op.line_ref, wo_job_code_id: e.id, sparepart_id: op.sparepart_id ?? null, part_number: op.part_name ? null : v.part_number ?? null,
          part_name: op.part_name ?? v.part_name, qty: Number(String(op.qty).replace(',', '.')), uom: op.uom ?? v.uom, added_by_name: op.user_name, added_at: op.at, updated_at: null,
        } as WoJobPart);
      }
      break;
    }
    case 'part.update': {
      const e = findEntry(next, op);
      const line = e && findLine(e, op);
      if (line) {
        if (op.part_name && op.part_name !== line.part_name) Object.assign(line, { part_name: op.part_name, part_number: null, sparepart_id: null });
        Object.assign(line, { qty: Number(String(op.qty).replace(',', '.')), uom: op.uom ?? line.uom, updated_at: op.at });
      }
      break;
    }
    case 'part.remove': {
      const e = findEntry(next, op);
      if (e) e.parts = e.parts.filter((p) => p !== findLine(e, op));
      break;
    }
    default:
      break;
  }
  return summarize(next);
}

/** Status and the list fields that follow from the steps and job codes. */
function summarize(wo: WorkOrderDetail): WorkOrderDetail {
  const all = [...wo.steps, ...wo.additional_work];
  const status = deriveStatus(all);
  const running = all.find((s) => s.started_at && !s.finished_at);
  const next = all.find((s) => !s.started_at);
  const started = all.map((s) => s.started_at).filter(Boolean).sort()[0] ?? null;
  const finished = status === 'FINISH' ? (all.map((s) => s.finished_at).filter(Boolean).sort().at(-1) ?? null) : null;
  const end = finished ? Date.parse(finished) : Date.now();
  return {
    ...wo,
    status,
    started_at: started,
    finished_at: finished,
    total_time: started ? Math.max(0, Math.round((end - Date.parse(started)) / 1000)) : 0,
    step_information: running
      ? `Step ${running.step_no} · ${running.step_name}`
      : status === 'FINISH' ? 'Completed' : status === 'WAITING' ? `Next: ${next ? `Step ${next.step_no} · ${next.step_name}` : '-'}` : 'Not started',
    job_code_list: wo.job_codes.length ? wo.job_codes.map((j) => j.job_code).join(', ') : null,
  };
}

/** `wo` with the unsent actions of `queue` for it applied. */
export function overlayDetail(wo: WorkOrderDetail, queue: OutboxOp[]) {
  const mine = queue.filter((o) => o.wo_uuid === wo.wo_uuid && o.type !== 'wo.create');
  return mine.length ? mine.reduce(applyOp, wo) : wo;
}

/** The job screen of a work order raised offline, from what the mechanic filled in. */
export function createdDetail(op: OutboxOp, queue: OutboxOp[]) {
  return overlayDetail(op.view as unknown as WorkOrderDetail, queue);
}

const inList = (value: string | number | null | undefined, filter?: string) => {
  if (!filter) return true;
  return filter.split(',').some((f) => (f === 'none' ? value == null : String(value) === f));
};

/** A job list with the unsent actions applied, plus work orders raised offline that match its filters. */
export function overlayList(page: Paged<WorkOrder>, params: object, queue: OutboxOp[], qc: QueryClient): Paged<WorkOrder> {
  if (!queue.length) return page;
  const detail = (id: string) => qc.getQueryData<WorkOrderDetail>(['work-order', id]);
  const data = page.data.map((wo) => {
    if (!queue.some((o) => o.wo_uuid === wo.wo_uuid)) return wo;
    const d = detail(wo.wo_uuid);
    if (!d) return wo;
    const o = overlayDetail(d, queue);
    return { ...wo, status: o.status, step_information: o.step_information, mechanic_id: o.mechanic_id, mechanic_name: o.mechanic_name, category: o.category, job_code_list: o.job_code_list, total_time: o.total_time };
  });
  const p = params as Record<string, string | undefined>;
  const created = queue
    .filter((o) => o.type === 'wo.create' && !page.data.some((w) => w.wo_uuid === o.wo_uuid))
    .map((o) => createdDetail(o, queue) as WorkOrder)
    .filter((w) => inList(w.mechanic_id, p.mechanic_id) && inList(w.created_by, p.created_by) && inList(w.status, p.status) && inList(w.approval_status, p.approval_status))
    .filter((w) => !p.site || w.site === p.site)
    .filter((w) => !p.search || `${w.wo_number} ${w.unit_number} ${w.problem}`.toLowerCase().includes(String(p.search).toLowerCase()));
  // Statuses may have changed offline: keep the list's own status filter.
  const shown = data.filter((w) => inList(w.status, p.status));
  return { ...page, data: [...created, ...shown], meta: { ...page.meta, total: page.meta.total - (data.length - shown.length) + created.length } };
}

/* ---------- Offline copy of loaded data ---------- */

const CACHE_KEY = 'query-cache';
/** Queries kept on the phone for offline use. */
const KEEP = new Set(['work-orders', 'work-order', 'units', 'employees', 'categories', 'job-codes', 'sites', 'step-template', 'notifications']);

export async function restoreCache(qc: QueryClient, userId: number | undefined) {
  if (userId == null) return;
  const saved = await idbGet<{ user_id: number; state: unknown }>(CACHE_KEY);
  if (saved && saved.user_id === userId) hydrate(qc, saved.state);
}

/** Saves the kept queries (debounced) whenever their data changes. */
export function startPersist(qc: QueryClient, getUserId: () => number | undefined) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || !KEEP.has(String(event.query.queryKey[0]))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const userId = getUserId();
      if (userId == null) return;
      const state = dehydrate(qc, { shouldDehydrateQuery: (q) => q.state.status === 'success' && KEEP.has(String(q.queryKey[0])) });
      void idbSet(CACHE_KEY, { user_id: userId, state });
    }, 1000);
  });
}

/** Removes the offline copy (on log out); the outbox stays, so unsent work is never lost. */
export const clearCache = () => idbDel(CACHE_KEY);
