import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Loader, MessageSquareText, Play, Plus, RefreshCcw, Timer, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApprovalBadge, StatusBadge } from '../../components/badges';
import { customerTypeLabel, paymentLabel } from '../../components/CustomerPayment';
import { maintenanceLabel } from '../../components/MaintenanceType';
import { formatMeter } from '../../components/MeterFields';
import { WoJobCodes } from '../../components/WoJobCodes';
import { useConfirm } from '../../components/confirm';
import { useToast } from '../../components/toast';
import { Button, Card, EmptyState, Input, Spinner, Textarea } from '../../components/ui';
import { stepRef, useAct } from '../../lib/act';
import { useAuth } from '../../lib/auth';
import { durationBetween, formatDateTime, formatDuration } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { newRef, useOutbox } from '../../lib/offline';
import { useWorkOrder } from '../../lib/queries';
import type { Step } from '../../lib/types';
import { useTour } from '../../lib/tour';

/** Re-renders every `ms` so running timers stay current. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function StateIcon({ step, className }: { step: Step; className?: string }) {
  if (step.finished_at) return <CheckCircle2 className={clsx('text-emerald-500', className)} />;
  if (step.started_at) return <Loader className={clsx('animate-spin text-yellow-500 [animation-duration:3s]', className)} />;
  return <Circle className={clsx('text-muted-foreground/50', className)} />;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export function JobPage() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data: wo, isLoading, error, refetch, isFetching } = useWorkOrder(id);
  const [remarks, setRemarks] = useState('');
  const [extra, setExtra] = useState('');
  // Every action goes through the outbox, so the steps can be done without signal too.
  const act = useAct();
  const unsent = useOutbox(user?.id).filter((o) => o.wo_uuid === id).length;
  useTick(1_000);
  useTour('m-wo', !!wo);

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  // With an offline copy the job stays usable even when the last refresh failed.
  if (!wo) return <EmptyState title={(error as Error)?.message ?? 'Not found'} action={<Button variant="outline" onClick={() => navigate('/m')}>{t('m_jobs')}</Button>} />;

  // Work can start before approval; a rejected WO cannot be worked on.
  const workable = wo.approval_status !== 'REJECT';
  const canProgress = can('wo.progress') && workable && wo.status !== 'FINISH';
  const allTop = [...wo.steps, ...wo.additional_work];
  const current = allTop.find((s) => !s.finished_at);
  const doneCount = allTop.filter((s) => s.finished_at).length;
  const run = (step: Step, action: 'start' | 'finish') =>
    confirm(
      { message: t(action === 'start' ? 'confirm_start_step' : 'confirm_finish_step', { step: `${step.step_no}. ${step.step_name}` }), tone: action === 'finish' ? 'success' : 'primary' },
      () => {
        act({
          type: action === 'start' ? 'step.start' : 'step.finish',
          wo_uuid: wo.wo_uuid,
          label: t(action === 'start' ? 'op_step_start' : 'op_step_finish', { step: `${step.step_no}. ${step.step_name}` }),
          ...stepRef(step),
          ...(action === 'finish' && remarks.trim() ? { remarks: remarks.trim() } : {}),
        });
        if (action === 'finish') {
          setRemarks('');
          toast('success', `${step.step_name} · ${t('done')}`, navigator.onLine ? undefined : t('m_saved_offline'));
        }
      },
    );
  // The job code step (Step 7) can only be finished when it has job codes and all of them are finished.
  const jobsBlock = current?.allow_add_sub
    ? !wo.job_codes.length ? t('add_job_first') : wo.job_codes.some((j) => !j.finished_at) ? t('finish_jobs_first') : null
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/m')}>
          <ArrowLeft className="size-4" /> {t('m_jobs')}
        </Button>
        <button onClick={() => refetch()} className="rounded-full p-2.5 text-muted-foreground hover:bg-muted" aria-label={t('reload')}>
          <RefreshCcw className={clsx('size-5', isFetching && 'animate-spin')} />
        </button>
      </div>

      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-semibold">{wo.unit_number}</h1>
            <p className="text-sm text-muted-foreground">{wo.wo_number} · {wo.unit_code}</p>
            {unsent > 0 && <p className="mt-1 inline-flex rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">{t('m_not_synced')} · {unsent}</p>}
            {error && !unsent && <p className="mt-1 text-xs text-muted-foreground">{t('m_offline_copy')}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={wo.status} />
            {wo.approval_status !== 'APPROVE' && <ApprovalBadge status={wo.approval_status} />}
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-muted p-3 text-sm whitespace-pre-wrap">{wo.problem}</p>
      </div>

      {wo.approval_status === 'WAITING' && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-yellow-600" />
          <p>{t('must_approve')}</p>
        </div>
      )}
      {wo.approval_status === 'REJECT' && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <p><span className="font-medium">{t('rejected_note')}:</span> {wo.reject_reason}</p>
        </div>
      )}
      {wo.approval_remarks && (
        <div className="rounded-xl flex items-start gap-3 border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <MessageSquareText className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="min-w-0 break-words whitespace-pre-wrap"><span className="font-medium">{t('approval_remarks')}:</span> {wo.approval_remarks}</p>
        </div>
      )}
      {workable && !can('wo.progress') && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{t('m_view_only')}</p>}

      {/* Current step: the one thing the mechanic works on right now. */}
      {workable && (
        <Card tour="m-step" className={clsx('overflow-hidden', current?.started_at && 'border-yellow-500/50')}>
          {current ? (
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {current.started_at ? t('m_current_step') : t('m_next_step')}
                </p>
                <span className="text-xs text-muted-foreground tabular-nums">{doneCount}/{allTop.length}</span>
              </div>
              <p className="mt-1 text-lg font-semibold">
                {current.step_no}. {current.step_name}
              </p>
              {current.started_at && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Timer className="size-4" /> {t('m_elapsed')}: <span className="font-medium text-foreground tabular-nums">{formatDuration(durationBetween(current.started_at, null))}</span>
                  <span className="text-xs">· {current.pic_name}</span>
                </p>
              )}
              {wo.mechanic_name && wo.mechanic_id !== user?.id && (
                <p className="mt-1 text-xs text-muted-foreground">{t('m_assigned_to', { name: wo.mechanic_name })}</p>
              )}

              {!!current.allow_add_sub && current.started_at && <div data-tour="m-jobcodes"><WoJobCodes wo={wo} compact className="mt-4" /></div>}

              {canProgress && (
                current.started_at ? (
                  <div data-tour="m-finish" className="mt-4 space-y-3">
                    {!!current.allow_add_sub && <p className="text-sm font-medium">{t('step_remarks_label', { step: `${current.step_no}. ${current.step_name}` })}</p>}
                    <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={current.allow_add_sub ? t('repair_remarks_placeholder') : t('remarks_placeholder')} maxLength={500} className="min-h-20" />
                    <Button variant="success" className="h-14 w-full text-base" disabled={!!jobsBlock} onClick={() => run(current, 'finish')}>
                      <CheckCircle2 className="size-5" /> {t('m_finish_current')}
                    </Button>
                    {jobsBlock && <p className="text-center text-xs text-muted-foreground">{jobsBlock}</p>}
                  </div>
                ) : (
                  <Button className="mt-4 h-14 w-full text-base" onClick={() => run(current, 'start')}>
                    <Play className="size-5" /> {wo.mechanic_id ? t('m_start') : t('m_take_job')}
                  </Button>
                )
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-7 shrink-0" />
              <div>
                <p className="font-semibold">{t('m_all_done')}</p>
                <p className="text-sm text-muted-foreground">{t('total_time')}: {formatDuration(wo.total_time)}</p>
              </div>
            </div>
          )}
          <div className="h-1.5 bg-muted">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / Math.max(1, allTop.length)) * 100}%` }} />
          </div>
        </Card>
      )}

      {wo.job_codes.length > 0 && !(current?.allow_add_sub && current.started_at) && (
        <Card className="p-4">
          <WoJobCodes wo={wo} compact />
        </Card>
      )}

      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-4">
          <Info label={t('driver')}>{wo.driver_name}</Info>
          <Info label={t('pic_mechanic')}>{wo.mechanic_name ?? '-'}</Info>
          <Info label={t('maintenance_type')}>{maintenanceLabel(wo.maintenance_type, t)}</Info>
          <Info label={t('maintenance_notes')}><span className="break-words">{wo.maintenance_other || '-'}</span></Info>
          <Info label={t('customer_type')}>{customerTypeLabel(wo.customer_type, t)}</Info>
          <Info label={t('payment')}><span className="break-words">{paymentLabel(wo.payment_type, wo.payment_other, t)}</span></Info>
          <Info label={t('site')}>{wo.site ?? '-'}</Info>
          <Info label={t('hm')}><span className="tabular-nums">{formatMeter(wo.hm, lang)}</span></Info>
          <Info label={t('km')}><span className="tabular-nums">{formatMeter(wo.km, lang)}</span></Info>
          <Info label={t('category')}>{wo.category ?? '-'}</Info>
          <Info label={t('created_at')}>{formatDateTime(wo.created_at)}</Info>
        </dl>
      </Card>

      <Card tour="m-steps" className="overflow-hidden">
        <h2 className="border-b border-border p-4 font-semibold">{t('m_all_steps')}</h2>
        <ol className="divide-y divide-border">
          {allTop.map((step) => (
            <li key={step.id} className={clsx('flex items-start gap-3 p-4', step.id === current?.id && step.started_at && 'bg-yellow-500/5')}>
              <StateIcon step={step} className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className={clsx('text-sm font-medium break-words', !step.started_at && 'text-muted-foreground')}>
                  {step.step_no}. {step.step_name}
                  {!!step.is_additional && <span className="ml-1 text-xs font-normal text-primary">+</span>}
                </p>
                {step.started_at && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {step.pic_name ?? '-'} · {formatDateTime(step.started_at)} · <span className="tabular-nums">{formatDuration(durationBetween(step.started_at, step.finished_at))}</span>
                  </p>
                )}
                {step.remarks && <p className="mt-1.5 rounded-md bg-muted px-2 py-1 text-xs">{step.remarks}</p>}
              </div>
            </li>
          ))}
        </ol>
        {canProgress && (
          <form
            className="flex gap-2 border-t border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (extra.trim().length >= 3)
                confirm({ message: t('confirm_add_extra', { name: extra.trim() }) }, () => {
                  act({ type: 'work.add', wo_uuid: wo.wo_uuid, label: t('op_work_add', { name: extra.trim() }), name: extra.trim(), step_ref: newRef() });
                  setExtra('');
                });
            }}
          >
            <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('add_additional_work')} maxLength={120} className="h-11" />
            <Button type="submit" variant="outline" className="h-11" disabled={extra.trim().length < 3} aria-label={t('create')}>
              <Plus className="size-5" />
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
