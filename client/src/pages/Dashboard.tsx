import { clsx } from 'clsx';
import { CircleCheck, CircleDot, Clock, Hourglass, ListChecks, RefreshCcw, ShieldAlert, Timer, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../components/badges';
import { DateRange } from '../components/DateRange';
import { Pagination } from '../components/Pagination';
import { BtnLabel, Button, Card, EmptyState, MetaItem, PageHeader, Skeleton } from '../components/ui';
import { formatDateTime, formatDuration, toDateInput } from '../lib/format';
import { useI18n, type TKey } from '../lib/i18n';
import { useDashboard, useWorkOrders } from '../lib/queries';

const defaultStart = () => toDateInput(new Date(Date.now() - 29 * 86_400_000));

const TABS: { value: string; key: TKey }[] = [
  { value: '', key: 'all_status' },
  { value: 'OPEN', key: 'status_open' },
  { value: 'ON_PROGRESS', key: 'status_on_progress' },
  { value: 'WAITING', key: 'status_waiting' },
  { value: 'FINISH', key: 'status_finish' },
];

export function DashboardPage() {
  const { t } = useI18n();
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(() => toDateInput(new Date()));
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const stats = useDashboard(start, end);
  const list = useWorkOrders({ created_start: start, created_end: end, status, page, limit, sort_by: 'created_at', sort_order: 'desc' });
  const s = stats.data;

  const statusCards = [
    { key: 'status_open' as TKey, desc: 'status_open_desc' as TKey, value: s?.open, icon: CircleDot, color: 'text-blue-500 bg-blue-500/10', filter: 'OPEN' },
    { key: 'status_on_progress' as TKey, desc: 'status_on_progress_desc' as TKey, value: s?.on_progress, icon: Wrench, color: 'text-yellow-600 bg-yellow-500/10', filter: 'ON_PROGRESS' },
    { key: 'status_waiting' as TKey, desc: 'status_waiting_desc' as TKey, value: s?.waiting, icon: Hourglass, color: 'text-orange-500 bg-orange-500/10', filter: 'WAITING' },
    { key: 'status_finish' as TKey, desc: 'status_finish_desc' as TKey, value: s?.finish, icon: CircleCheck, color: 'text-emerald-600 bg-emerald-500/10', filter: 'FINISH' },
  ];
  const maxCat = Math.max(1, ...(s?.by_category.map((c) => c.count) ?? [1]));

  return (
    <div>
      <PageHeader
        title={t('dashboard')}
        subtitle={t('dashboard_subtitle')}
        actions={
          <>
            <DateRange start={start} end={end} onChange={(a, b) => { setStart(a); setEnd(b); setPage(1); }} className="flex-1 sm:flex-none" />
            <Button variant="outline" onClick={() => { stats.refetch(); list.refetch(); }} title={t('reload')}>
              <RefreshCcw className="size-4" /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {statusCards.map((c) => (
          <button key={c.key} onClick={() => { setStatus(status === c.filter ? '' : c.filter); setPage(1); }} className="h-full text-left">
            <Card className={clsx('h-full p-4 transition hover:border-primary/50 sm:p-5', status === c.filter && 'ring-2 ring-primary')}>
              <div className="flex items-center justify-between">
                <p className="min-w-0 truncate text-sm text-muted-foreground">{t(c.key)}</p>
                <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-lg', c.color)}>
                  <c.icon className="size-5" />
                </span>
              </div>
              {stats.isLoading ? <Skeleton className="mt-3 h-8 w-16" /> : <p className="mt-2 text-3xl font-semibold tabular-nums">{c.value ?? 0}</p>}
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{t(c.desc)}</p>
            </Card>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="grid auto-rows-fr grid-cols-2 gap-px overflow-hidden bg-border lg:col-span-1">
          {[
            { key: 'total_wo' as TKey, value: s?.total ?? 0, icon: ListChecks },
            { key: 'pending_approval' as TKey, value: s?.pending_approval ?? 0, icon: ShieldAlert },
            { key: 'average_time' as TKey, value: formatDuration(s?.average_time), icon: Timer },
            { key: 'total_time' as TKey, value: formatDuration(s?.total_time), icon: Clock },
          ].map((m) => (
            <div key={m.key} className="bg-card p-4">
              <m.icon className="size-4 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">{t(m.key)}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{stats.isLoading ? '…' : m.value}</p>
            </div>
          ))}
        </Card>
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <h2 className="font-semibold">{t('by_category')}</h2>
          <div className="mt-4 space-y-2.5">
            {s?.by_category.length ? (
              s.by_category.map((c) => (
                <div key={c.name} className="grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,9rem)_1fr_2rem]">
                  <span className="truncate text-muted-foreground">{c.name}</span>
                  <div className="h-2.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-sidebar-accent" style={{ width: `${(c.count / maxCat) * 100}%` }} />
                  </div>
                  <span className="text-right font-medium tabular-nums">{c.count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{stats.isLoading ? '…' : t('no_data')}</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{t('list_work_order')}</h2>
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => { setStatus(tab.value); setPage(1); }}
                className={clsx('rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap', status === tab.value ? 'bg-card shadow-sm' : 'text-muted-foreground')}
              >
                {t(tab.key)}
              </button>
            ))}
          </div>
        </div>
        <ul className="divide-y divide-border lg:hidden">
          {list.data?.data.map((wo) => (
            <li key={wo.wo_uuid}>
              <Link to={`/transaction/work-order/details/${wo.wo_uuid}`} className="block p-4 active:bg-muted/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-primary">{wo.wo_number}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(wo.created_at)}</p>
                  </div>
                  <StatusBadge status={wo.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                  <MetaItem label={t('unit')}>{wo.unit_number}</MetaItem>
                  <MetaItem label={t('pic_mechanic')}>{wo.mechanic_name ?? '-'}</MetaItem>
                  <MetaItem label={t('step_information')}>{wo.step_information}</MetaItem>
                  <MetaItem label={t('total_time')}><span className="tabular-nums">{formatDuration(wo.total_time)}</span></MetaItem>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {(['no', 'wo_number', 'unit', 'pic_mechanic', 'status', 'step_information', 'total_time', 'created_at'] as TKey[]).map((k) => (
                  <th key={k} className="px-4 py-3 font-medium whitespace-nowrap">{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data?.data.map((wo, i) => (
                <tr key={wo.wo_uuid} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{(page - 1) * limit + i + 1}</td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <Link to={`/transaction/work-order/details/${wo.wo_uuid}`} className="text-primary hover:underline">{wo.wo_number}</Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.unit_number}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.mechanic_name ?? '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={wo.status} /></td>
                  <td className="px-4 py-3 whitespace-nowrap">{wo.step_information}</td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{formatDuration(wo.total_time)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDateTime(wo.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
        {list.data && !list.data.data.length && <EmptyState title={t('no_data')} description={t('no_data_desc')} />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination page={page} totalPages={list.data.meta.total_pages} total={list.data.meta.total} limit={limit} onPage={setPage} onLimit={(l) => { setLimit(l); setPage(1); }} />
        )}
      </Card>
    </div>
  );
}
