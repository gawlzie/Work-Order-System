import { CalendarDays } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function DateRange({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm" title={t('date_range')}>
      <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      <input type="date" value={start} max={end || undefined} onChange={(e) => onChange(e.target.value, end)} className="bg-transparent outline-none" aria-label="Start date" />
      <span className="text-muted-foreground">–</span>
      <input type="date" value={end} min={start || undefined} onChange={(e) => onChange(start, e.target.value)} className="bg-transparent outline-none" aria-label="End date" />
    </div>
  );
}
