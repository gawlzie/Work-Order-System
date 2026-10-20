import { Badge, type BadgeVariant } from './ui';
import { useI18n, type TKey } from '../lib/i18n';
import type { ApprovalStatus, Channel, WoStatus } from '../lib/types';

export const STATUS_META: Record<WoStatus, { variant: BadgeVariant; key: TKey; desc: TKey }> = {
  OPEN: { variant: 'default', key: 'status_open', desc: 'status_open_desc' },
  ON_PROGRESS: { variant: 'yellow', key: 'status_on_progress', desc: 'status_on_progress_desc' },
  WAITING: { variant: 'orange', key: 'status_waiting', desc: 'status_waiting_desc' },
  FINISH: { variant: 'green', key: 'status_finish', desc: 'status_finish_desc' },
};

export const APPROVAL_META: Record<ApprovalStatus, { variant: BadgeVariant; key: TKey }> = {
  WAITING: { variant: 'yellow', key: 'approval_waiting' },
  APPROVE: { variant: 'green', key: 'approved_label' },
  REJECT: { variant: 'destructive', key: 'rejected_label' },
};

export const CHANNEL_META: Record<Channel, TKey> = {
  WEB: 'admin_plant',
  MOBILE: 'mechanic',
  WHATSAPP: 'whatsapp',
};

export function StatusBadge({ status }: { status: WoStatus }) {
  const { t } = useI18n();
  const m = STATUS_META[status];
  if (!m) return <Badge variant="gray" className="min-w-24 justify-center">{status}</Badge>;
  return <Badge variant={m.variant} className="min-w-24 justify-center" title={t(m.desc)}>{t(m.key)}</Badge>;
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const { t } = useI18n();
  const m = APPROVAL_META[status];
  return <Badge variant={m?.variant ?? 'gray'} className="min-w-20 justify-center">{m ? t(m.key) : status}</Badge>;
}

export function ChannelBadge({ channel }: { channel: Channel }) {
  const { t } = useI18n();
  return <Badge variant="gray">{t(CHANNEL_META[channel] ?? 'admin_plant')}</Badge>;
}
