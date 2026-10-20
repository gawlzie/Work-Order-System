import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Hash, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useOnline } from '../lib/pwa';
import { useEmployees, useJobCodeOptions } from '../lib/queries';
import type { WorkOrderDetail } from '../lib/types';
import { JobCodePicker, jobDuration } from './JobCodePicker';
import { useToast } from './toast';
import { Button, Select } from './ui';

/**
 * Job codes of a work order. They are added in the repair step (Step 7): mechanics while it runs (pre-filled with
 * themselves, but they can pick the colleague they help), approvers (admin) once it has started and must pick the mechanic.
 */
export function WoJobCodes({ wo, className, compact }: { wo: WorkOrderDetail; className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const online = useOnline();
  const repair = [...wo.steps, ...wo.additional_work].find((s) => s.allow_add_sub);
  const approved = wo.approval_status === 'APPROVE';
  const admin = can('wo.approve');
  const editable = approved && !!repair?.started_at && (admin || (can('wo.progress') && !repair.finished_at));
  const jobs = useJobCodeOptions();
  const mechanics = useEmployees('mechanic');
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
  const remove = useMutation({
    mutationFn: (id: number) => api<WorkOrderDetail>(`/work-orders/${wo.wo_uuid}/job-codes/${id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (err) => toast('error', (err as Error).message),
  });

  const totalStd = wo.job_codes.reduce((sum, j) => sum + (j.standard_duration ?? 0), 0);
  const submit = () => {
    const next: Record<string, string> = {};
    if (!jobId) next.job_code_id = t('choose_job_code');
    if (!mechanicId) next.mechanic_id = t('choose_job_mechanic');
    setErrors(next);
    if (!Object.keys(next).length) add.mutate();
  };

  return (
    <div className={className}>
      {!compact && (
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-semibold"><Hash className="size-4" /> {t('job_codes')}</h2>
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
      {compact && <p className="mb-2 text-sm font-medium">{t('job_codes')}</p>}

      {wo.job_codes.length > 0 ? (
        <ul className={clsx('divide-y divide-border', compact && 'rounded-xl border border-border')}>
          {wo.job_codes.map((j) => (
            <li key={j.id} className={clsx('flex items-start gap-3', compact ? 'px-3 py-2' : 'px-4 py-3')}>
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words"><span className="font-mono text-xs">{j.job_code}</span> · {j.job_name}</p>
                <p className="text-xs text-muted-foreground">
                  {j.mechanic_name} · {jobDuration(j.standard_duration)} · {j.category_name}
                  {!compact && <> · {t('added_by')} {j.added_by_name ?? '-'} {formatDateTime(j.added_at)}</>}
                </p>
              </div>
              {editable && (
                <Button size="icon" variant="ghost" className="no-print shrink-0 text-destructive" title={t('delete')} aria-label={t('delete')} disabled={!online} loading={remove.isPending && remove.variables === j.id} onClick={() => remove.mutate(j.id)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={clsx('text-sm text-muted-foreground', !compact && 'px-4 py-3')}>{t('job_codes_none')}</p>
      )}

      {editable && (
        <div className={clsx('no-print grid gap-2 sm:grid-cols-[1fr_14rem_auto]', compact ? 'mt-2' : 'border-t border-border p-4')}>
          <div>
            <JobCodePicker
              options={jobs.data ?? []}
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
