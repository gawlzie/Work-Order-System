import { clsx } from 'clsx';
import { ChevronRight, RefreshCcw, Search, Timer } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApprovalBadge, StatusBadge } from '../../components/badges';
import { EmptyState, Input, Skeleton } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatDuration } from '../../lib/format';
import { useI18n, type TKey } from '../../lib/i18n';
import { useWorkOrders, type WoListParams } from '../../lib/queries';
import type { Permission, WorkOrder } from '../../lib/types';

const NOT_FINISHED = 'OPEN,ON_PROGRESS,WAITING';
const APPROVED = 'APPROVE';

type TabId = 'active' | 'available' | 'requests' | 'done';

const TABS: { id: TabId; key: TKey; empty: TKey; permission?: Permission; params: (me: string) => WoListParams }[] = [
  { id: 'active', key: 'm_tab_active', empty: 'm_empty_active', params: (me) => ({ mechanic_id: me, status: NOT_FINISHED, approval_status: `${APPROVED},WAITING` }) },
  { id: 'available', key: 'm_tab_available', empty: 'm_empty_available', permission: 'wo.progress', params: () => ({ mechanic_id: 'none', status: NOT_FINISHED, approval_status: APPROVED }) },
  { id: 'requests', key: 'm_tab_requests', empty: 'm_empty_requests', permission: 'wo.create', params: (me) => ({ created_by: me, approval_status: 'WAITING,REJECT' }) },
  { id: 'done', key: 'm_tab_done', empty: 'm_empty_done', params: (me) => ({ mechanic_id: me, status: 'FINISH' }) },
];

function JobCard({ wo }: { wo: WorkOrder }) {
  const { t } = useI18n();
  const approved = wo.approval_status === 'APPROVE';
  return (
    <Link to={`/m/wo/${wo.wo_uuid}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition active:scale-[0.99] hover:border-primary/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg leading-tight font-semibold">{wo.unit_number}</p>
            <p className="text-xs text-muted-foreground">{wo.wo_number} · {wo.unit_code}</p>
          </div>
          {approved ? <StatusBadge status={wo.status} /> : <ApprovalBadge status={wo.approval_status} />}
        </div>
        <p className="mt-2 line-clamp-2 text-sm">{wo.problem}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className={clsx('font-medium', wo.status === 'WAITING' ? 'text-orange-500' : wo.status === 'ON_PROGRESS' ? 'text-yellow-600 dark:text-yellow-400' : '')}>
            {wo.step_information}
          </span>
          {wo.total_time > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums"><Timer className="size-3.5" />{formatDuration(wo.total_time)}</span>
          )}
          <span>{formatDateTime(wo.created_at)}</span>
          {!wo.mechanic_name && <span>{t('m_unassigned')}</span>}
        </div>
        {wo.approval_status === 'REJECT' && wo.reject_reason && (
          <p className="mt-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-destructive">{wo.reject_reason}</p>
        )}
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function JobsPage() {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const me = String(user?.id ?? '');
  const tabs = TABS.filter((tab) => !tab.permission || can(tab.permission));
  const [tabId, setTabId] = useState<TabId>('active');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());

  // One small query per tab so every tab shows its count; lists refresh every 30 s for field use.
  const queries = {
    active: useWorkOrders({ ...TABS[0].params(me), search: term, limit: 50 }, 30_000),
    available: useWorkOrders({ ...TABS[1].params(me), search: term, limit: 50 }, 30_000),
    requests: useWorkOrders({ ...TABS[2].params(me), search: term, limit: 50 }, 30_000),
    done: useWorkOrders({ ...TABS[3].params(me), search: term, limit: 20 }, 30_000),
  };
  const tab = tabs.find((x) => x.id === tabId) ?? tabs[0];
  const current = queries[tab.id];
  const refreshing = Object.values(queries).some((q) => q.isFetching);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{t('m_hello', { name: user?.full_name.split(' ')[0] ?? '' })}</h1>
          <p className="text-sm text-muted-foreground">{t('m_jobs_subtitle')}</p>
        </div>
        <button
          onClick={() => Object.values(queries).forEach((q) => q.refetch())}
          className="rounded-full p-2.5 text-muted-foreground hover:bg-muted"
          aria-label={t('reload')}
        >
          <RefreshCcw className={clsx('size-5', refreshing && 'animate-spin')} />
        </button>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} className="h-11 pl-9" />
      </div>

      <div className="sticky top-14 z-20 -mx-4 mb-3 bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist">
          {tabs.map((x) => {
            const total = queries[x.id].data?.meta.total;
            return (
              <button
                key={x.id}
                role="tab"
                aria-selected={x.id === tab.id}
                onClick={() => setTabId(x.id)}
                className={clsx(
                  'flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-0.5 text-[11px] font-medium tracking-tight transition sm:gap-1.5 sm:text-sm',
                  x.id === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <span className="truncate">{t(x.key)}</span>
                {total !== undefined && x.id !== 'done' && (
                  <span className={clsx('rounded-full px-1.5 text-[10px] tabular-nums', total ? 'bg-primary text-white' : 'bg-border text-muted-foreground')}>{total}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {current.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : current.isError ? (
        <EmptyState title={(current.error as Error).message} />
      ) : current.data?.data.length ? (
        <div className="space-y-3">
          {current.data.data.map((wo) => <JobCard key={wo.wo_uuid} wo={wo} />)}
        </div>
      ) : (
        <EmptyState title={t(tab.empty)} />
      )}
    </div>
  );
}
