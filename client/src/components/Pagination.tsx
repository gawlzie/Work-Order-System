import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Select } from './ui';
import { useI18n } from '../lib/i18n';

interface Props {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
  onLimit: (l: number) => void;
}

export function Pagination({ page, totalPages, total, limit, onPage, onLimit }: Props) {
  const { t } = useI18n();
  return (
    <div className="no-print flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Select value={limit} onChange={(e) => onLimit(Number(e.target.value))} className="h-8 w-20" aria-label="Rows per page">
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </Select>
        <span className="whitespace-nowrap">{t('rows', { n: total })}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t('page_of', { page, total: totalPages })}</span>
        <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
