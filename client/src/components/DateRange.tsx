import { clsx } from 'clsx';
import { CalendarDays } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function DateRange({ start, end, onChange, className }: { start: string; end: string; onChange: (start: string, end: string) => void; className?: string }) {
  const { t } = useI18n();
  const input = 'min-w-0 flex-1 bg-transparent text-base outline-none sm:flex-none sm:text-sm';
  return (
    <div className={clsx('flex h-10 min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm', className)} title={t('date_range')}>
      <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      <input type="date" value={start} max={end || undefined} onChange={(e) => onChange(e.target.value, end)} className={input} aria-label="Start date" />
      <span className="text-muted-foreground">–</span>
      <input type="date" value={end} min={start || undefined} onChange={(e) => onChange(start, e.target.value)} className={input} aria-label="End date" />
    </div>
  );
}
