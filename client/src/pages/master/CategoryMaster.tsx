import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ActiveBadge, DeleteDialog, SearchBox, SortHeader, Th, fieldErrors, useListState } from '../../components/master';
import { Pagination } from '../../components/Pagination';
import { useToast } from '../../components/toast';
import { BtnLabel, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { usePaged } from '../../lib/queries';
import type { MasterCategory } from '../../lib/types';

const FILTERS = ['status'] as const;

/** Link to the work order list filtered on one category. */
function WoCount({ c }: { c: MasterCategory }) {
  if (!c.wo_count) return <span className="text-muted-foreground tabular-nums">0</span>;
  return (
    <Link to={`/transaction/work-order?category_id=${c.id}`} className="text-primary tabular-nums hover:underline">
      {c.wo_count}
    </Link>
  );
}

export function CategoryMasterPage() {
  const { t } = useI18n();
  const state = useListState(FILTERS, 'name');
  const { params, update } = state;
  const list = usePaged<MasterCategory>('categories', params);
  const [editing, setEditing] = useState<MasterCategory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MasterCategory | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('repair_categories')}
        subtitle={t('category_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_category')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchBox state={state} placeholder={t('search_category')} />
          <Select value={params.status} onChange={(e) => update({ status: e.target.value })} className="sm:w-40" aria-label={t('status')}>
            <option value="">{t('all_status')}</option>
            <option value="active">{t('active')}</option>
            <option value="inactive">{t('inactive')}</option>
          </Select>
          {(params.search || params.status) && (
            <Button variant="ghost" onClick={state.reset}><X className="size-4" /> {t('reset')}</Button>
          )}
        </div>

        <ul className="divide-y divide-border lg:hidden">
          {rows.map((c) => (
            <li key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  {c.description && <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>}
                </div>
                <ActiveBadge active={c.is_active} />
              </div>
              <div className="mt-2 -mr-2 flex items-center justify-between gap-1">
                <span className="text-xs text-muted-foreground">{t('wo_used')}: <WoCount c={c} /></span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" title={t('edit')} aria-label={t('edit')} onClick={() => setEditing(c)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" title={t('delete')} aria-label={t('delete')} className="text-destructive" disabled={c.wo_count > 0} onClick={() => setDeleting(c)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <Th>{t('no')}</Th>
                <Th><SortHeader field="name" label="category_name" state={state} /></Th>
                <Th>{t('description')}</Th>
                <Th><SortHeader field="wo_count" label="wo_used" state={state} /></Th>
                <Th>{t('status')}</Th>
                <Th className="text-right">{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{(params.page - 1) * params.limit + i + 1}</td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{c.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.description ?? '-'}</td>
                  <td className="px-4 py-3"><WoCount c={c} /></td>
                  <td className="px-4 py-3"><ActiveBadge active={c.is_active} /></td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => setEditing(c)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} className="text-destructive" disabled={c.wo_count > 0} onClick={() => setDeleting(c)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
        {list.isError && <EmptyState title={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>{t('reload')}</Button>} />}
        {list.data && !rows.length && <EmptyState title={t('no_data')} />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination
            page={list.data.meta.page}
            totalPages={list.data.meta.total_pages}
            total={list.data.meta.total}
            limit={list.data.meta.limit}
            onPage={(p) => update({ page: p }, false)}
            onLimit={(l) => update({ limit: l })}
          />
        )}
      </Card>

      {editing && <CategoryForm category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <DeleteDialog path="categories" item={deleting && { id: deleting.id, label: deleting.name }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function CategoryForm({ category, onClose }: { category: MasterCategory | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: category?.name ?? '',
    description: category?.description ?? '',
    is_active: category ? !!category.is_active : true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api<MasterCategory>(category ? `/categories/${category.id}` : '/categories', { method: category ? 'PUT' : 'POST', body: form }),
    onSuccess: (saved) => {
      toast('success', t('data_saved'), saved.name);
      qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err) ?? {});
      toast('error', (err as Error).message);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Category name must be 2-50 characters';
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={category ? `${t('edit_category')} · ${category.name}` : t('add_category')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="category-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('category_name')} required error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
              setErrors((er) => ({ ...er, name: '' }));
            }}
            placeholder="Hydraulic"
            maxLength={50}
            invalid={!!errors.name}
            autoFocus
          />
        </Field>
        <Field label={t('description')} error={errors.description}>
          <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={200} className="min-h-20" />
        </Field>
        <Switch checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} label={t('active')} description={t('category_active_hint')} />
        {!!category?.wo_count && <p className="text-xs text-muted-foreground">{t('wo_used')}: {category.wo_count}</p>}
      </form>
    </Modal>
  );
}
