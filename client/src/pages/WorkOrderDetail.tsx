import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Circle, Loader, MessageSquareText, Pencil, Play, Plus, Printer, RefreshCcw, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApprovalDialog } from '../components/ApprovalDialog';
import { ApprovalBadge, ChannelBadge, StatusBadge } from '../components/badges';
import { jobDuration } from '../components/JobCodePicker';
import { ProofSection } from '../components/ProofSection';
import { WoJobCodes } from '../components/WoJobCodes';
import { useToast } from '../components/toast';
import { BtnLabel, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationBetween, formatDateTime, formatDuration } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useWorkOrder } from '../lib/queries';
import type { Step, WorkOrderDetail } from '../lib/types';

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{children}</dd>
    </div>
  );
}

function StandardCompare({ wo }: { wo: WorkOrderDetail }) {
  const { t } = useI18n();
  // Judged once the repair step is done: repair time against the job code's standard duration.
  const repairDone = wo.steps.concat(wo.additional_work).some((s) => s.allow_add_sub && s.finished_at);
  if (!wo.job_standard_duration || wo.repair_time == null || !repairDone) return null;
  const diff = wo.repair_time - wo.job_standard_duration * 60;
  return diff > 0 ? (
    <span className="ml-2 rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">{t('over_standard', { d: formatDuration(diff) })}</span>
  ) : (
    <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">{t('within_standard')}</span>
  );
}

/** Re-renders every second while something is running, so live durations show their seconds. */
function useSecondTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [active]);
}

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: wo, isLoading, isError, error, refetch, isFetching } = useWorkOrder(id);
  const [finishing, setFinishing] = useState<Step | null>(null);
  const [remarks, setRemarks] = useState('');
  const [extra, setExtra] = useState('');
  const [approval, setApproval] = useState<'approve' | 'reject' | null>(null);

  const onDone = (data: WorkOrderDetail) => {
    qc.setQueryData(['work-order', id], data);
    qc.invalidateQueries({ queryKey: ['work-orders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const progress = useMutation({
    mutationFn: ({ step, action }: { step: Step; action: 'start' | 'finish' }) =>
      api<WorkOrderDetail>(`/work-orders/${id}/steps/${step.id}/${action}`, { method: 'POST', body: { remarks } }),
    onSuccess: (data) => {
      onDone(data);
      setFinishing(null);
      setRemarks('');
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  const addExtra = useMutation({
    mutationFn: () => api<WorkOrderDetail>(`/work-orders/${id}/additional-work`, { method: 'POST', body: { name: extra } }),
    onSuccess: (data) => {
      onDone(data);
      setExtra('');
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  useSecondTick(!!wo && wo.status !== 'FINISH' && !!wo.started_at);

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (isError || !wo) return <EmptyState title={(error as Error)?.message ?? 'Not found'} action={<Button variant="outline" onClick={() => navigate('/transaction/work-order')}>{t('work_order')}</Button>} />;

  // Work can start before approval; a rejected WO cannot be worked on.
  const canProgress = can('wo.progress') && wo.approval_status !== 'REJECT';
  const allTop = [...wo.steps, ...wo.additional_work];
  const nextTop = allTop.find((s) => !s.finished_at);

  const stepActions = (step: Step, parent?: Step) => {
    if (!canProgress || step.finished_at) return null;
    const startable = parent ? !!parent.started_at && !parent.finished_at : nextTop?.id === step.id;
    if (!step.started_at) {
      return startable ? (
        <Button size="sm" variant="outline" loading={progress.isPending && progress.variables?.step.id === step.id} onClick={() => progress.mutate({ step, action: 'start' })}>
          <Play className="size-3.5" /> {t('start')}
        </Button>
      ) : null;
    }
    return (
      <Button size="sm" variant="success" onClick={() => (parent ? progress.mutate({ step, action: 'finish' }) : setFinishing(step))}>
        <Check className="size-3.5" /> {t('finish')}
      </Button>
    );
  };

  const stateIcon = (s: Step) =>
    s.finished_at ? <CheckCircle2 className="size-5 text-emerald-500" /> : s.started_at ? <Loader className="size-5 animate-spin text-yellow-500 [animation-duration:3s]" /> : <Circle className="size-5 text-muted-foreground/50" />;

  const renderSteps = (steps: Step[]) => (
    <ol className="divide-y divide-border">
      {steps.map((step) => (
        <li key={step.id} className={clsx('p-3 sm:p-4', step.started_at && !step.finished_at && 'bg-yellow-500/5')}>
          <div className="flex items-start gap-3">
            <div className="pt-0.5">{stateIcon(step)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium break-words">
                  {step.step_no}. {step.step_name}
                </p>
                <div className="no-print shrink-0">{stepActions(step)}</div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                <div><span className="block">{t('pic')}</span><span className="text-foreground">{step.pic_name ?? '-'}</span></div>
                <div><span className="block">{t('start')}</span><span className="text-foreground">{formatDateTime(step.started_at)}</span></div>
                <div><span className="block">{t('finish')}</span><span className="text-foreground">{formatDateTime(step.finished_at)}</span></div>
                <div><span className="block">{t('duration')}</span><span className="text-foreground tabular-nums">{formatDuration(durationBetween(step.started_at, step.finished_at))}</span></div>
              </dl>
              {step.remarks && <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs"><span className="text-muted-foreground">{t('remarks')}: </span>{step.remarks}</p>}
              {step.sub_steps.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-l-2 border-border pl-4">
                  {step.sub_steps.map((sub) => (
                    <li key={sub.id} className="flex flex-wrap items-center gap-2 text-sm">
                      {sub.finished_at ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : sub.started_at ? <Loader className="size-4 shrink-0 text-yellow-500" /> : <Circle className="size-4 shrink-0 text-muted-foreground/50" />}
                      <span className="min-w-0 flex-1 break-words">
                        {step.step_no}.{sub.step_no} {sub.step_name}
                        {!!sub.is_additional && <span className="ml-1.5 text-xs text-primary">· {t('added_in_app')}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(durationBetween(sub.started_at, sub.finished_at))}</span>
                      <span className="no-print">{stepActions(sub, step)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );

  const doneCount = allTop.filter((s) => s.finished_at).length;

  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" className="no-print mb-3 -ml-2" onClick={() => navigate('/transaction/work-order')}>
        <ArrowLeft className="size-4" /> {t('work_order')}
      </Button>
      <PageHeader
        title={`${t('detail_title')} · ${wo.wo_number}`}
        subtitle={t('detail_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button variant="outline" onClick={() => window.print()} title={t('print')}>
              <Printer className="size-4" /> <BtnLabel>{t('print')}</BtnLabel>
            </Button>
            {can('wo.update') && wo.status !== 'FINISH' && (
              <Button className="max-sm:ml-auto" onClick={() => navigate(`/transaction/work-order/update/${wo.wo_uuid}`)}>
                <Pencil className="size-4" /> {t('edit')}
              </Button>
            )}
          </>
        }
      />

      {wo.approval_status === 'WAITING' && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm sm:flex-row sm:items-center">
          <div className="flex flex-1 items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-yellow-600" />
            <p>{t('must_approve')}</p>
          </div>
          {can('wo.approve') && (
            <div className="no-print flex gap-2 *:flex-1 sm:*:flex-none">
              <Button variant="destructive" onClick={() => setApproval('reject')}><XCircle className="size-4" /> {t('reject')}</Button>
              <Button variant="success" onClick={() => setApproval('approve')}><Check className="size-4" /> {t('approve')}</Button>
            </div>
          )}
        </div>
      )}
      {wo.approval_status === 'REJECT' && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <p><span className="font-medium">{t('rejected_note')}:</span> {wo.reject_reason}</p>
        </div>
      )}

      {wo.approval_remarks && (
        <div className="mb-4 rounded-lg flex items-start gap-3 border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <MessageSquareText className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="min-w-0 break-words whitespace-pre-wrap"><span className="font-medium">{t('approval_remarks')}:</span> {wo.approval_remarks}</p>
        </div>
      )}

      <Card className="print-area p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={wo.status} />
          <ApprovalBadge status={wo.approval_status} />
          <ChannelBadge channel={wo.channel_source} />
        </div>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Info label={t('unit')}>{wo.unit_number} <span className="text-muted-foreground">({wo.unit_code})</span></Info>
          <Info label={t('driver')}>{wo.driver_name}</Info>
          <Info label={t('pic_mechanic')}>{wo.mechanic_name ?? '-'}</Info>
          <Info label={t('category')}>{wo.category ?? '-'}</Info>
          <Info label={t('created_at')}>{formatDateTime(wo.created_at)}</Info>
          <Info label={t('created_by')}>{wo.created_by_name ?? '-'}</Info>
          <Info label={t('mobile_sync_time')}>{formatDateTime(wo.mobile_sync_time)}</Info>
          <Info label={t('total_time')}><span className="tabular-nums">{formatDuration(wo.total_time)}</span></Info>
          {wo.job_codes.length > 0 && (
            <Info label={t('standard_total')}><span className="tabular-nums">{jobDuration(wo.job_standard_duration)}</span></Info>
          )}
          {wo.job_codes.length > 0 && (
            <Info label={t('repair_time')}><span className="tabular-nums">{wo.repair_time == null ? '-' : formatDuration(wo.repair_time)}</span><StandardCompare wo={wo} /></Info>
          )}
        </dl>
        <div className="mt-4 rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">{t('problem')}</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{wo.problem}</p>
        </div>
      </Card>

      <Card className="print-area mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold">{t('steps')}</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{doneCount}/{allTop.length}</span>
        </div>
        <div className="h-1.5 bg-muted">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / Math.max(1, allTop.length)) * 100}%` }} />
        </div>
        {renderSteps(wo.steps)}
      </Card>

      <Card className="print-area mt-4 overflow-hidden">
        <WoJobCodes wo={wo} />
      </Card>

      <Card className="print-area mt-4 overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="font-semibold">{t('additional_work')}</h2>
        </div>
        {wo.additional_work.length ? renderSteps(wo.additional_work) : <p className="p-4 text-sm text-muted-foreground">-</p>}
        {canProgress && (
          <form
            className="no-print flex gap-2 border-t border-border p-4"
            onSubmit={(e) => { e.preventDefault(); if (extra.trim().length >= 3) addExtra.mutate(); }}
          >
            <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('add_additional_work')} maxLength={120} />
            <Button type="submit" variant="outline" loading={addExtra.isPending} disabled={extra.trim().length < 3} title={t('create')}>
              <Plus className="size-4" /> <BtnLabel>{t('create')}</BtnLabel>
            </Button>
          </form>
        )}
      </Card>

      <ProofSection wo={wo} />

      {approval && <ApprovalDialog kind={approval} wo={wo} onClose={() => setApproval(null)} />}

      <Modal
        open={!!finishing}
        onClose={() => setFinishing(null)}
        title={`${t('finish_step')}: ${finishing?.step_name ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setFinishing(null)}>{t('cancel')}</Button>
            <Button variant="success" loading={progress.isPending} onClick={() => finishing && progress.mutate({ step: finishing, action: 'finish' })}>
              {t('finish')}
            </Button>
          </>
        }
      >
        <Field label={t('remarks')}>
          <Textarea autoFocus value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t('remarks_placeholder')} maxLength={500} />
        </Field>
      </Modal>
    </div>
  );
}
