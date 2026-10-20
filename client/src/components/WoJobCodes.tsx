import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Check, CheckCircle2, Circle, Hash, Loader, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationBetween, formatDateTime, formatDuration } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useOnline } from '../lib/pwa';
import { useCategories, useEmployees, useJobCodeOptions } from '../lib/queries';
import type { WoJobCode, WorkOrderDetail } from '../lib/types';
import { JobCodePicker, jobDuration } from './JobCodePicker';
import { useConfirm } from './confirm';
import { useToast } from './toast';
import { Button, Select } from './ui';

/**
 * Repair category and job codes of a work order, filled in during the repair step (Step 7), never at creation:
 * mechanics while it runs (mechanic pre-filled with themselves, or the colleague they help), approvers (admin) once it
 * has started, to correct. The category comes first and the job code list only offers job codes of that category.
 */
export function WoJobCodes({ wo, className, compact }: { wo: WorkOrderDetail; className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const online = useOnline();
  const repair = [...wo.steps, ...wo.additional_work].find((s) => s.allow_add_sub);
  const workable = wo.approval_status !== 'REJECT';
  const admin = can('wo.approve');
  const editable = workable && !!repair?.started_at && (admin || (can('wo.progress') && !repair.finished_at));
  // Job code timers run while the job code step (Step 7) is in progress.
  const canTime = workable && can('wo.progress') && !!repair?.started_at && !repair.finished_at;
  const running = wo.job_codes.some((j) => j.started_at && !j.finished_at);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [running]);
  const jobs = useJobCodeOptions();
  const mechanics = useEmployees('mechanic');
  const categories = useCategories();
  const jobOptions = (jobs.data ?? []).filter((j) => j.category_id === wo.category_id);
  const [jobId, setJobId] = useState('');
  const [mechanicId, setMechanicId] = useState(() => (!admin && can('wo.as_mechanic') && user ? String(user.id) : ''));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const done = (data: WorkOrderDetail) => {
    qc.setQueryData(['work-order', wo.wo_uuid], data);
    qc.invalidateQueries({ queryKey: ['work-orders'] });
  };
  const add = useMutation({
    mutationFn: () => api<WorkOrderDetail>(`/work-orders/${wo.wo_uuid}/job-codes`, { method: 'POST', body: { job_code_id: jobId, mechanic_id: mechanicId } }),
    onSuccess: (data) => {
      done(data);
      setJobId('');
      setErrors({});
    },
    onError: (err) => {
      setErrors(err instanceof ApiError && err.errors ? err.errors : {});
      toast('error', (err as Error).message);
    },
  });
  const setCategory = useMutation({
    mutationFn: (categoryId: string) => api<WorkOrderDetail>(`/work-orders/${wo.wo_uuid}/category`, { method: 'PUT', body: { category_id: categoryId } }),
    onSuccess: (data) => {
      done(data);
      setJobId('');
      setErrors({});
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  const timer = useMutation({
    mutationFn: ({ entry, action }: { entry: WoJobCode; action: 'start' | 'finish' }) =>
      api<WorkOrderDetail>(`/work-orders/${wo.wo_uuid}/job-codes/${entry.id}/${action}`, { method: 'POST' }),
    onSuccess: done,
    onError: (err) => toast('error', (err as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<WorkOrderDetail>(`/work-orders/${wo.wo_uuid}/job-codes/${id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (err) => toast('error', (err as Error).message),
  });

  const totalStd = wo.job_codes.reduce((sum, j) => sum + (j.standard_duration ?? 0), 0);
  const finishedJobs = wo.job_codes.filter((j) => j.finished_at).length;
  const busy = (j: WoJobCode, action: 'start' | 'finish') => timer.isPending && timer.variables?.entry.id === j.id && timer.variables.action === action;
  const submit = () => {
    const next: Record<string, string> = {};
    if (!jobId) next.job_code_id = t('choose_job_code');
    if (!mechanicId) next.mechanic_id = t('choose_job_mechanic');
    setErrors(next);
    if (Object.keys(next).length) return;
    const job = jobOptions.find((j) => String(j.id) === jobId);
    const mechanic = mechanics.data?.find((m) => String(m.id) === mechanicId);
    confirm({ message: t('confirm_add_job', { job: job ? `${job.job_code} · ${job.job_name}` : '', mechanic: mechanic?.full_name ?? '' }) }, () => add.mutate());
  };

  return (
    <div className={className}>
      {!compact && (
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-semibold"><Hash className="size-4" /> {t('category_job_codes')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {repair ? t('job_codes_when', { step: `${repair.step_no} · ${repair.step_name}` }) : t('job_codes_no_step')}
            </p>
          </div>
          {wo.job_codes.length > 0 && (
            <span className="shrink-0 text-right text-xs text-muted-foreground">
              {t('standard_total')}<br /><span className="text-sm font-medium text-foreground tabular-nums">{jobDuration(totalStd || null)}</span>
            </span>
          )}
        </div>
      )}
      {compact && (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">{t('category_job_codes')}</p>
          {wo.job_codes.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{t('jobs_done', { done: finishedJobs, total: wo.job_codes.length })}</span>}
        </div>
      )}

      <div className={clsx(compact ? 'mb-3' : 'border-b border-border px-4 py-3')}>
        <p className="mb-1 text-xs text-muted-foreground">{t('category')}</p>
        {editable ? (
          <Select
            value={wo.category_id ? String(wo.category_id) : ''}
            onChange={(e) => {
              const id = e.target.value;
              const name = categories.data?.find((c) => String(c.id) === id)?.name ?? '';
              if (id) confirm({ message: t('confirm_category', { name }) }, () => setCategory.mutate(id));
            }}
            disabled={!online || setCategory.isPending}
            aria-label={t('category')}
          >
            <option value="">{t('choose_category_first')}</option>
            {wo.category_id && categories.data && !categories.data.some((c) => c.id === wo.category_id) && <option value={wo.category_id}>{wo.category}</option>}
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : (
          <p className="text-sm font-medium">{wo.category ?? '-'}</p>
        )}
      </div>

      {wo.job_codes.length > 0 ? (
        <ul className={clsx('divide-y divide-border', compact && 'rounded-xl border border-border')}>
          {wo.job_codes.map((j) => (
            <li key={j.id} className={clsx('flex items-start gap-3', compact ? 'px-3 py-2.5' : 'px-4 py-3', j.started_at && !j.finished_at && 'bg-yellow-500/5')}>
              <span className="pt-0.5">
                {j.finished_at ? <CheckCircle2 className="size-5 text-emerald-500" /> : j.started_at ? <Loader className="size-5 animate-spin text-yellow-500 [animation-duration:3s]" /> : <Circle className="size-5 text-muted-foreground/50" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words"><span className="font-mono text-xs">{j.job_code}</span> · {j.job_name}</p>
                <p className="text-xs text-muted-foreground">
                  {j.mechanic_name} · {t('standard_short')} {jobDuration(j.standard_duration)}
                  {!compact && <> · {j.category_name} · {t('added_by')} {j.added_by_name ?? '-'} {formatDateTime(j.added_at)}</>}
                </p>
                {j.started_at && (
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-medium tabular-nums">{formatDuration(durationBetween(j.started_at, j.finished_at))}</span>
                    {!compact && <span className="text-muted-foreground">{formatDateTime(j.started_at)} – {j.finished_at ? formatDateTime(j.finished_at) : '…'}</span>}
                    {j.finished_at && j.standard_duration ? (
                      (durationBetween(j.started_at, j.finished_at) ?? 0) > j.standard_duration * 60
                        ? <span className="rounded-full bg-orange-500/10 px-1.5 text-orange-600 dark:text-orange-400">{t('over_standard', { d: formatDuration((durationBetween(j.started_at, j.finished_at) ?? 0) - j.standard_duration * 60) })}</span>
                        : <span className="rounded-full bg-emerald-500/10 px-1.5 text-emerald-700 dark:text-emerald-400">{t('within_standard')}</span>
                    ) : null}
                  </p>
                )}
              </div>
              {canTime && !j.finished_at && (
                j.started_at ? (
                  <Button variant="success" size="sm" className="no-print h-9 shrink-0" disabled={!online} loading={busy(j, 'finish')} onClick={() => confirm({ message: t('confirm_job_finish', { job: j.job_code, mechanic: j.mechanic_name }), tone: 'success' }, () => timer.mutate({ entry: j, action: 'finish' }))}>
                    <Check className="size-4" /> {t('finish')}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="no-print h-9 shrink-0" disabled={!online} loading={busy(j, 'start')} onClick={() => confirm({ message: t('confirm_job_start', { job: j.job_code, mechanic: j.mechanic_name }) }, () => timer.mutate({ entry: j, action: 'start' }))}>
                    <Play className="size-4" /> {t('start')}
                  </Button>
                )
              )}
              {editable && (
                <Button size="icon" variant="ghost" className="no-print shrink-0 text-destructive" title={t('delete')} aria-label={t('delete')} disabled={!online} loading={remove.isPending && remove.variables === j.id} onClick={() => confirm({ message: t('confirm_remove_job', { job: j.job_code, mechanic: j.mechanic_name }), tone: 'destructive', confirmLabel: t('delete') }, () => remove.mutate(j.id))}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={clsx('text-sm text-muted-foreground', !compact && 'px-4 py-3')}>{t('job_codes_none')}</p>
      )}

      {editable && !wo.category_id && <p className={clsx('no-print text-xs text-muted-foreground', compact ? 'mt-2' : 'border-t border-border px-4 py-3')}>{t('job_codes_need_category')}</p>}
      {editable && !!wo.category_id && (
        <div className={clsx('no-print grid gap-2 sm:grid-cols-[1fr_14rem_auto]', compact ? 'mt-2' : 'border-t border-border p-4')}>
          <div>
            <JobCodePicker
              options={jobOptions}
              value={jobId}
              invalid={!!errors.job_code_id}
              onChange={(j) => {
                setJobId(j ? String(j.id) : '');
                setErrors((e) => ({ ...e, job_code_id: '' }));
              }}
            />
            {errors.job_code_id && <p className="mt-1 text-xs text-destructive">{errors.job_code_id}</p>}
          </div>
          <div>
            <Select value={mechanicId} onChange={(e) => { setMechanicId(e.target.value); setErrors((er) => ({ ...er, mechanic_id: '' })); }} invalid={!!errors.mechanic_id} aria-label={t('mechanic')}>
              <option value="">{t('choose_job_mechanic')}</option>
              {mechanics.data?.map((m) => <option key={m.id} value={m.id}>{m.id === user?.id ? t('m_me', { name: m.full_name }) : m.full_name}</option>)}
            </Select>
            {errors.mechanic_id && <p className="mt-1 text-xs text-destructive">{errors.mechanic_id}</p>}
          </div>
          <Button variant="outline" onClick={submit} loading={add.isPending} disabled={!online}>
            <Plus className="size-4" /> {t('add_job_code_short')}
          </Button>
        </div>
      )}
    </div>
  );
}
