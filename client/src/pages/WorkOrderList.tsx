import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Download, Eye, Filter, Pencil, Plus, Printer, RefreshCcw, Search, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApprovalBadge, ChannelBadge, StatusBadge } from '../components/badges';
import { DateRange } from '../components/DateRange';
import { Pagination } from '../components/Pagination';
import { useToast } from '../components/toast';
import { BtnLabel, Button, Card, EmptyState, Field, Input, MetaItem, Modal, PageHeader, Select, Skeleton, Textarea } from '../components/ui';
import { api, download, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatDuration } from '../lib/format';
import { useI18n, type TKey } from '../lib/i18n';
import { useCategories, useEmployees, useUnits, useWorkOrders, type WoListParams } from '../lib/queries';
import type { WorkOrder } from '../lib/types';

const FILTER_KEYS = ['status', 'approval_status', 'channel_source', 'unit_id', 'mechanic_id', 'category_id', 'created_start', 'created_end'] as const;

type Dialog = { kind: 'approve' | 'reject' | 'delete'; wo: WorkOrder } | null;

export function WorkOrderListPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => sp.get(k)));
  const [searchText, setSearchText] = useState(sp.get('search') ?? '');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [exporting, setExporting] = useState(false);

  const params: WoListParams = {
    search: sp.get('search') ?? '',
    page: Number(sp.get('page')) || 1,
    limit: Number(sp.get('limit')) || 10,
    sort_by: sp.get('sort_by') ?? 'created_at',
    sort_order: (sp.get('sort_order') as 'asc' | 'desc') ?? 'desc',
    ...Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ''])),
  };

  const update = (patch: Record<string, string | number | undefined>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (resetPage && !('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };

  // Debounce the free-text search into the URL.
  useEffect(() => {
    const id = setTimeout(() => (searchText !== (sp.get('search') ?? '') ? update({ search: searchText }) : undefined), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const list = useWorkOrders(params);
  const units = useUnits(true);
  const mechanics = useEmployees('mechanic');
  const categories = useCategories(true);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['work-orders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const action = useMutation({
    mutationFn: async (d: NonNullable<Dialog>) => {
      if (d.kind === 'delete') return api(`/work-orders/${d.wo.wo_uuid}`, { method: 'DELETE' });
      return api(`/work-orders/${d.wo.wo_uuid}/approval`, { method: 'POST', body: d.kind === 'approve' ? { action: 'APPROVE', remarks: reason } : { action: 'REJECT', reason } });
    },
    onSuccess: (_, d) => {
      toast('success', t(d.kind === 'delete' ? 'deleted' : d.kind === 'approve' ? 'approved' : 'rejected'), d.wo.wo_number);
      setDialog(null);
      setReason('');
      invalidate();
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { page: _p, limit: _l, ...filters } = params;
      await download(`/work-orders/export${qs({ ...filters })}`, 'work-orders.csv');
      toast('success', t('exported'));
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const sortHeader = (key: string, label: TKey) => {
    const active = params.sort_by === key;
    const Icon = !active ? ArrowUpDown : params.sort_order === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        className={clsx('inline-flex items-center gap-1 whitespace-nowrap', active && 'text-foreground')}
        onClick={() => update({ sort_by: key, sort_order: active && params.sort_order === 'desc' ? 'asc' : 'desc' })}
      >
        {t(label)} <Icon className="size-3" />
      </button>
    );
  };

  const activeFilters = FILTER_KEYS.filter((k) => sp.get(k)).length;
  const rows = list.data?.data ?? [];
  const rowNo = (i: number) => ((params.page ?? 1) - 1) * (params.limit ?? 10) + i + 1;

  const rowActions = (wo: WorkOrder) => (
    <div className="flex justify-end gap-1">
      {can('wo.approve') && wo.approval_status === 'WAITING' && (
        <>
          <Button size="icon" variant="ghost" title={t('approve')} aria-label={t('approve')} onClick={() => setDialog({ kind: 'approve', wo })} className="text-emerald-600">
            <Check className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" title={t('reject')} aria-label={t('reject')} onClick={() => setDialog({ kind: 'reject', wo })} className="text-destructive">
            <X className="size-4" />
          </Button>
        </>
      )}
      <Button size="icon" variant="ghost" title={t('details')} aria-label={t('details')} onClick={() => navigate(`/transaction/work-order/details/${wo.wo_uuid}`)}>
        <Eye className="size-4" />
      </Button>
      {can('wo.update') && wo.status !== 'FINISH' && (
        <Button size="icon" variant="ghost" title={t('edit')} aria-label={t('edit')} onClick={() => navigate(`/transaction/work-order/update/${wo.wo_uuid}`)}>
          <Pencil className="size-4" />
        </Button>
      )}
      {can('wo.delete') && wo.status === 'OPEN' && (
        <Button size="icon" variant="ghost" title={t('delete')} aria-label={t('delete')} onClick={() => setDialog({ kind: 'delete', wo })} className="text-destructive">
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t('work_order')}
        subtitle={t('wo_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button variant="outline" onClick={() => window.print()} title={t('print')}>
              <Printer className="size-4" /> <BtnLabel>{t('print')}</BtnLabel>
            </Button>
            <Button variant="outline" onClick={exportCsv} loading={exporting} title={t('export')}>
              {!exporting && <Download className="size-4" />} <BtnLabel>{t('export')}</BtnLabel>
            </Button>
            {can('wo.create') && (
              <Button className="max-sm:ml-auto" onClick={() => navigate('/transaction/work-order/create')}>
                <Plus className="size-4" /> {t('create')}
              </Button>
            )}
          </>
        }
      />

      <Card className="print-area overflow-hidden">
        <div className="no-print flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={t('search')} className="pl-9" />
          </div>
          <div className="flex gap-3">
            <Select value={params.status} onChange={(e) => update({ status: e.target.value })} className="min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label={t('status')}>
              <option value="">{t('all_status')}</option>
              <option value="OPEN">{t('status_open')}</option>
              <option value="ON_PROGRESS">{t('status_on_progress')}</option>
              <option value="WAITING">{t('status_waiting')}</option>
              <option value="FINISH">{t('status_finish')}</option>
            </Select>
            <Button variant={showFilters ? 'primary' : 'outline'} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
              <Filter className="size-4" /> {t('filters')}
              {activeFilters > 0 && <span className={clsx('rounded-full px-1.5 text-xs', showFilters ? 'bg-white/25' : 'bg-primary text-primary-foreground')}>{activeFilters}</span>}
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="no-print grid gap-3 border-b border-border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('date_range')}>
              <DateRange start={params.created_start ?? ''} end={params.created_end ?? ''} onChange={(a, b) => update({ created_start: a, created_end: b })} />
            </Field>
            <Field label={t('approval_status')}>
              <Select value={params.approval_status} onChange={(e) => update({ approval_status: e.target.value })}>
                <option value="">{t('all')}</option>
                <option value="WAITING">{t('status_waiting')}</option>
                <option value="APPROVE">{t('approved_label')}</option>
                <option value="APPROVE_BY_SYSTEM">{t('approved_system')}</option>
                <option value="REJECT">{t('rejected_label')}</option>
              </Select>
            </Field>
            <Field label={t('channel_source')}>
              <Select value={params.channel_source} onChange={(e) => update({ channel_source: e.target.value })}>
                <option value="">{t('all')}</option>
                <option value="WEB">{t('admin_plant')}</option>
                <option value="MOBILE">{t('mechanic')}</option>
                <option value="WHATSAPP">{t('whatsapp')}</option>
              </Select>
            </Field>
            <Field label={t('unit')}>
              <Select value={params.unit_id} onChange={(e) => update({ unit_id: e.target.value })}>
                <option value="">{t('all')}</option>
                {units.data?.map((u) => <option key={u.id} value={u.id}>{u.unit_number} ({u.unit_code})</option>)}
              </Select>
            </Field>
            <Field label={t('pic_mechanic')}>
              <Select value={params.mechanic_id} onChange={(e) => update({ mechanic_id: e.target.value })}>
                <option value="">{t('all')}</option>
                {mechanics.data?.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            </Field>
            <Field label={t('category')}>
              <Select value={params.category_id} onChange={(e) => update({ category_id: e.target.value })}>
                <option value="">{t('all')}</option>
                {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" className="max-sm:w-full" onClick={() => { setSearchText(''); setSp(new URLSearchParams(), { replace: true }); }}>
                <X className="size-4" /> {t('reset')}
              </Button>
            </div>
          </div>
        )}

        {/* Phones and tablets: one card per work order. The table is kept for desktop and for printing. */}
        <ul className="divide-y divide-border lg:hidden print:hidden">
          {rows.map((wo, i) => (
            <li key={wo.wo_uuid} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/transaction/work-order/details/${wo.wo_uuid}`} className="font-medium text-primary hover:underline">
                    <span className="mr-1.5 text-xs font-normal text-muted-foreground">#{rowNo(i)}</span>
                    {wo.wo_number}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(wo.created_at)}</p>
                </div>
                <StatusBadge status={wo.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 md:grid-cols-6">
                <MetaItem label={t('unit')}>{wo.unit_number}</MetaItem>
                <MetaItem label={t('driver')}>{wo.driver_name}</MetaItem>
                <MetaItem label={t('pic_mechanic')}>{wo.mechanic_name ?? '-'}</MetaItem>
                <MetaItem label={t('category')}>{wo.category ?? '-'}</MetaItem>
                <MetaItem label={t('step_information')}>{wo.step_information}</MetaItem>
                <MetaItem label={t('total_time')}><span className="tabular-nums">{formatDuration(wo.total_time)}</span></MetaItem>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ApprovalBadge status={wo.approval_status} />
                <ChannelBadge channel={wo.channel_source} />
                <div className="-mr-2 ml-auto">{rowActions(wo)}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto lg:block print:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('no')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('wo_number', 'wo_number')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('created_at', 'created_at')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('unit_number', 'unit')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('driver_name', 'driver')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('mechanic_name', 'pic_mechanic')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('category', 'category')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('status', 'status')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('approval_status', 'approval_status')}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{t('step_information')}</th>
                <th className="px-4 py-3 font-medium">{sortHeader('total_time', 'total_time')}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{t('channel_source')}</th>
                <th className="no-print px-4 py-3 text-right font-medium">{t('action')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((wo, i) => (
                <tr key={wo.wo_uuid} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{rowNo(i)}</td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <Link to={`/transaction/work-order/details/${wo.wo_uuid}`} className="text-primary hover:underline">{wo.wo_number}</Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDateTime(wo.created_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.unit_number}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.driver_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.mechanic_name ?? '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.category ?? '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={wo.status} /></td>
                  <td className="px-4 py-3"><ApprovalBadge status={wo.approval_status} /></td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.step_information}</td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{formatDuration(wo.total_time)}</td>
                  <td className="px-4 py-3"><ChannelBadge channel={wo.channel_source} /></td>
                  <td className="no-print px-4 py-2">{rowActions(wo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
        {list.isError && <EmptyState title={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>{t('reload')}</Button>} />}
        {list.data && !rows.length && <EmptyState title={t('no_data')} description={t('no_data_desc')} />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination
            page={list.data.meta.page}
            totalPages={list.data.meta.total_pages}
            total={list.data.meta.total}
            limit={list.data.meta.limit}
            onPage={(p) => update({ page: p }, false)}
            onLimit={(l) => update({ limit: l })}
          />
        )}
      </Card>

      <Modal
        open={!!dialog}
        onClose={() => { setDialog(null); setReason(''); }}
        title={dialog?.kind === 'approve' ? t('approve_title') : dialog?.kind === 'reject' ? t('reject_title') : t('confirm_title')}
        description={`${dialog?.wo.wo_number} · ${dialog?.wo.unit_number} — ${dialog?.kind === 'approve' ? t('approve_subtitle') : dialog?.kind === 'reject' ? t('reject_subtitle') : t('confirm_delete')}`}
        footer={
          <>
            <Button variant="outline" onClick={() => { setDialog(null); setReason(''); }}>{t('cancel')}</Button>
            <Button
              variant={dialog?.kind === 'approve' ? 'success' : 'destructive'}
              loading={action.isPending}
              disabled={dialog?.kind === 'reject' && reason.trim().length < 3}
              onClick={() => dialog && action.mutate(dialog)}
            >
              {dialog?.kind === 'approve' ? t('approve') : dialog?.kind === 'reject' ? t('reject') : t('delete')}
            </Button>
          </>
        }
      >
        {dialog?.kind === 'reject' && (
          <Field label={t('reject_reason')} required>
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        )}
        {dialog && dialog.kind !== 'reject' && <p className="text-sm">{dialog.wo.problem}</p>}
        {dialog?.kind === 'approve' && (
          <Field label={t('approval_remarks')} className="mt-4">
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('approval_remarks_placeholder')} maxLength={500} className="min-h-20" />
            <span className="self-end text-xs text-muted-foreground">{reason.length}/500</span>
          </Field>
        )}
      </Modal>
    </div>
  );
}
