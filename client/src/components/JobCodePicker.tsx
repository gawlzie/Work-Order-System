import { clsx } from 'clsx';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import type { JobCodeOption } from '../lib/types';

const MAX_RESULTS = 50;

/**
 * Searchable job code picker (the list has hundreds of codes, too many for a plain select).
 * Matches code, job name or category; keyboard: arrows, Enter, Escape.
 */
export function JobCodePicker({ options, value, onChange, invalid, className }: {
  options: JobCodeOption[];
  value: string;
  onChange: (job: JobCodeOption | null) => void;
  invalid?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const selected = options.find((o) => String(o.id) === value) ?? null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (o: JobCodeOption) => {
      const text = `${o.job_code} ${o.job_name} ${o.category_name}`.toLowerCase();
      return words.every((w) => text.includes(w));
    };
    return (words.length ? options.filter(match) : options).slice(0, MAX_RESULTS);
  }, [options, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (o: JobCodeOption | null) => {
    onChange(o);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={box} className={clsx('relative', className)}>
      <div className={clsx('flex h-10 items-center rounded-lg border bg-card transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20', invalid ? 'border-destructive' : 'border-border')}>
        <Search className="ml-3 size-4 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-label={t('job_code')}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          value={open ? query : selected ? `${selected.job_code} · ${selected.job_name}` : ''}
          placeholder={selected ? `${selected.job_code} · ${selected.job_name}` : t('search_job_code')}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && open) { e.preventDefault(); if (results[active]) pick(results[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {selected && (
          <button type="button" onClick={() => pick(null)} className="mr-1.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label={t('clear_job_code')} title={t('clear_job_code')}>
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <ul ref={list} role="listbox" className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
          {results.map((o, i) => (
            <li
              key={o.id}
              data-index={i}
              role="option"
              aria-selected={String(o.id) === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              className={clsx('cursor-pointer rounded-md px-3 py-2 text-sm', i === active && 'bg-muted', String(o.id) === value && 'font-medium text-primary')}
            >
              <div className="min-w-0"><span className="font-mono text-xs">{o.job_code}</span> · {o.job_name}</div>
              <p className="text-xs text-muted-foreground">{o.category_name}</p>
            </li>
          ))}
          {!results.length && <li className="px-3 py-2 text-sm text-muted-foreground">{t('no_data')}</li>}
          {results.length === MAX_RESULTS && <li className="px-3 py-1.5 text-xs text-muted-foreground">{t('job_code_more')}</li>}
        </ul>
      )}
    </div>
  );
}
