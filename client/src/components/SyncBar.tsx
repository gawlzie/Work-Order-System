import { clsx } from 'clsx';
import { AlertTriangle, CloudUpload, Loader2, Trash2, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { discard, flush, useOutbox, useSyncState } from '../lib/offline';
import { useOnline } from '../lib/pwa';
import { useConfirm } from './confirm';

/**
 * Mechanic app status under the header: no signal, changes waiting to be sent (with "send now") and changes the
 * server refused, each with its reason and a button to discard it.
 */
export function SyncBar() {
  const { t } = useI18n();
  const { user } = useAuth();
  const confirm = useConfirm();
  const online = useOnline();
  const sync = useSyncState();
  const queue = useOutbox(user?.id);
  const [open, setOpen] = useState(false);
  const pending = queue.filter((o) => o.state === 'pending');
  const failed = queue.filter((o) => o.state === 'failed');
  const noSignal = !online || sync.offline;
  if (!noSignal && !pending.length && !failed.length) return null;

  return (
    <div className="space-y-px text-xs">
      {noSignal && (
        <p className="flex items-center gap-2 bg-orange-500 px-4 py-1.5 text-white">
          <WifiOff className="size-3.5 shrink-0" /> {t('m_offline_bar')}
        </p>
      )}
      {pending.length > 0 && (
        <div className="flex items-center gap-2 bg-blue-600 px-4 py-1.5 text-white">
          {sync.running ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <CloudUpload className="size-3.5 shrink-0" />}
          <span className="flex-1">{sync.running ? t('m_sending') : t('m_pending', { n: pending.length })}</span>
          {!sync.running && online && (
            <button onClick={() => void flush()} className="rounded-md bg-white/20 px-2 py-0.5 font-medium">{t('m_send_now')}</button>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div className="bg-red-600 text-white">
          <div className="flex items-center gap-2 px-4 py-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="flex-1">{t('m_failed', { n: failed.length })}</span>
            <button onClick={() => setOpen((o) => !o)} className="rounded-md bg-white/20 px-2 py-0.5 font-medium">{open ? t('m_hide') : t('m_show')}</button>
          </div>
          {open && (
            <ul className="space-y-1 px-4 pb-2">
              {failed.map((o) => (
                <li key={o.op_id} className="flex items-start gap-2 rounded-md bg-white/10 p-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{o.label}</span>
                    <span className={clsx('block break-words opacity-90')}>{o.error}</span>
                  </span>
                  <button
                    onClick={() => confirm({ message: t('confirm_discard', { label: o.label }), tone: 'destructive', confirmLabel: t('m_discard') }, () => discard(o.op_id))}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-white/20 px-2 py-1 font-medium"
                  >
                    <Trash2 className="size-3.5" /> {t('m_discard')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
