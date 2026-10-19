import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { useToast } from './toast';
import { Badge, Button, Input, Modal } from './ui';

/** Search / sort / paging / filter state kept in the URL, shared by the master-data list pages. */
export function useListState(filterKeys: readonly string[], defaultSort: string) {
  const [sp, setSp] = useSearchParams();
  const [searchText, setSearchText] = useState(sp.get('search') ?? '');

  const params = {
    search: sp.get('search') ?? '',
    page: Number(sp.get('page')) || 1,
    limit: Number(sp.get('limit')) || 10,
    sort_by: sp.get('sort_by') ?? defaultSort,
    sort_order: (sp.get('sort_order') as 'asc' | 'desc') ?? 'asc',
    ...Object.fromEntries(filterKeys.map((k) => [k, sp.get(k) ?? ''])),
  } as Record<string, string | number> & { page: number; limit: number; sort_by: string; sort_order: 'asc' | 'desc' };

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

  const reset = () => {
    setSearchText('');
    setSp(new URLSearchParams(), { replace: true });
  };

  return { params, update, searchText, setSearchText, reset };
}

type ListState = ReturnType<typeof useListState>;

export function SortHeader({ field, label, state }: { field: string; label: TKey; state: ListState }) {
  const { t } = useI18n();
  const { params, update } = state;
  const active = params.sort_by === field;
  const Icon = !active ? ArrowUpDown : params.sort_order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      className={clsx('inline-flex items-center gap-1 whitespace-nowrap', active && 'text-foreground')}
      onClick={() => update({ sort_by: field, sort_order: active && params.sort_order === 'asc' ? 'desc' : 'asc' })}
    >
      {t(label)} <Icon className="size-3" />
    </button>
  );
}

export function SearchBox({ state, placeholder }: { state: ListState; placeholder: string }) {
  return (
    <div className="relative flex-1">
      <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={state.searchText} onChange={(e) => state.setSearchText(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean | number }) {
  const { t } = useI18n();
  return <Badge variant={active ? 'green' : 'gray'}>{t(active ? 'active' : 'inactive')}</Badge>;
}

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={clsx('px-4 py-3 font-medium', className)}>{children}</th>
);

/** Field-level errors from a 422 response, or undefined. */
export const fieldErrors = (err: unknown) => (err instanceof ApiError ? err.errors : undefined);

/** Confirms and deletes one master record; the server refuses records still used by work orders. */
export function DeleteDialog({ path, item, onClose, hint = 'delete_hint' }: { path: 'units' | 'employees' | 'roles' | 'steps'; item: { id: number; label: string } | null; onClose: () => void; hint?: TKey }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: number) => api(`/${path}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', t('data_deleted'), item?.label);
      qc.invalidateQueries({ queryKey: [path] });
      onClose();
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={t('confirm_title')}
      description={t('confirm_delete_master', { name: item?.label ?? '' })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="destructive" loading={remove.isPending} onClick={() => item && remove.mutate(item.id)}>{t('delete')}</Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t(hint)}</p>
    </Modal>
  );
}
