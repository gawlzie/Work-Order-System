import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Bell, CheckCheck, CheckCircle2, Clock, PlusCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { useNotifications } from '../lib/queries';
import type { AppNotification, NotificationList } from '../lib/types';
import { useToast } from './toast';

const TYPES: Record<AppNotification['type'], { title: TKey; icon: typeof Bell; color: string }> = {
  WO_CREATED: { title: 'notif_created', icon: PlusCircle, color: 'text-blue-500 bg-blue-500/10' },
  WO_FINISHED: { title: 'notif_finished', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-500/10' },
  WO_OVERDUE: { title: 'notif_overdue', icon: Clock, color: 'text-orange-500 bg-orange-500/10' },
};

/** "5 minutes ago" in the user's language. */
function timeAgo(iso: string, lang: string) {
  const rtf = new Intl.RelativeTimeFormat(lang === 'id' ? 'id-ID' : 'en-GB', { numeric: 'auto' });
  const sec = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of steps) if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit);
  return rtf.format(sec, 'second');
}

/**
 * Bell with the unread count; the panel lists the latest notifications (WO created / finished / open > 1 day).
 * Clicking one marks it read and opens the work order at `woLink(uuid)`. New ones that arrive while the app is open
 * also pop up as a toast. Polled every 30 s.
 */
export function NotificationBell({ woLink, className }: { woLink: (woUuid: string) => string; className?: string }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);
  const items = list.data?.data ?? [];
  const unread = list.data?.unread ?? 0;

  const text = (n: AppNotification) => ({
    title: t(TYPES[n.type].title, { wo: n.data.wo_number, hours: n.data.hours }),
    body: [n.data.unit_number, n.data.site].filter(Boolean).join(' · '),
  });

  // Toast for notifications that arrive after the first load.
  useEffect(() => {
    if (!list.data) return;
    const newest = items[0]?.id ?? 0;
    if (seen.current !== null) {
      const fresh = items.filter((n) => n.id > (seen.current ?? 0) && !n.read_at);
      for (const n of fresh.slice(0, 3).reverse()) toast('info', text(n).title, text(n).body);
    }
    seen.current = Math.max(seen.current ?? 0, newest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = (data: NotificationList) => qc.setQueryData(['notifications'], data);
  const read = useMutation({ mutationFn: (id: number) => api<NotificationList>(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: save });
  const readAll = useMutation({ mutationFn: () => api<NotificationList>('/notifications/read-all', { method: 'POST' }), onSuccess: save });

  return (
    <div className={clsx('relative', className)} ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 hover:bg-muted" aria-label={t('notifications')} title={t('notifications')}>
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="font-semibold">{t('notifications')}</p>
            {unread > 0 && (
              <button onClick={() => readAll.mutate()} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline" disabled={readAll.isPending}>
                <CheckCheck className="size-3.5" /> {t('mark_all_read')}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('no_notifications')}</p>
          ) : (
            <ul className="max-h-[min(70vh,28rem)] divide-y divide-border overflow-y-auto">
              {items.map((n) => {
                const kind = TYPES[n.type];
                const { title, body } = text(n);
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        if (!n.read_at) read.mutate(n.id);
                        setOpen(false);
                        if (n.wo_uuid) navigate(woLink(n.wo_uuid));
                      }}
                      className={clsx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60', !n.read_at && 'bg-primary/5')}
                    >
                      <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', kind.color)}>
                        <kind.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={clsx('block text-sm', !n.read_at && 'font-semibold')}>{title}</span>
                        {body && <span className="block text-xs text-muted-foreground">{body}</span>}
                        {n.data.problem && <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{n.data.problem}</span>}
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {timeAgo(n.created_at, lang)}
                          {n.actor_name && ` · ${n.actor_name}`}
                        </span>
                      </span>
                      {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label={t('unread')} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
