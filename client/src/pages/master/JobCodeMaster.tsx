import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ActiveBadge, DeleteDialog, SearchBox, SortHeader, Th, fieldErrors, useListState } from '../../components/master';
import { Pagination } from '../../components/Pagination';
import { useConfirm } from '../../components/confirm';
import { useToast } from '../../components/toast';
import { BtnLabel, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useCategories, usePaged } from '../../lib/queries';
import type { Category, MasterJobCode } from '../../lib/types';

const FILTERS = ['status', 'category_id'] as const;

const duration = (minutes: number | null) => (minutes ? formatDuration(minutes * 60) : '-');

export function JobCodeMasterPage() {
  const { t } = useI18n();
  const state = useListState(FILTERS, 'job_code');
  const { params, update } = state;
  const list = usePaged<MasterJobCode>('job-codes', params);
  const categories = useCategories(true);
  const [editing, setEditing] = useState<MasterJobCode | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MasterJobCode | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('job_codes')}
        subtitle={t('job_code_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_job_code')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchBox state={state} placeholder={t('search_job_code')} />
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <Select value={params.category_id} onChange={(e) => update({ category_id: e.target.value })} className="sm:w-48" aria-label={t('category')}>
              <option value="">{t('all_categories')}</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={params.status} onChange={(e) => update({ status: e.target.value })} className="sm:w-40" aria-label={t('status')}>
              <option value="">{t('all_status')}</option>
              <option value="active">{t('active')}</option>
              <option value="inactive">{t('inactive')}</option>
            </Select>
          </div>
          {(params.search || params.status || params.category_id) && (
            <Button variant="ghost" onClick={state.reset}><X className="size-4" /> {t('reset')}</Button>
          )}
        </div>

        <ul className="divide-y divide-border lg:hidden">
          {rows.map((j) => (
            <li key={j.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{j.job_code}</p>
                  <p className="font-medium">{j.job_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{j.category_name}</p>
                </div>
                <ActiveBadge active={j.is_active} />
              </div>
              <div className="mt-2 -mr-2 flex items-center justify-between gap-1">
                <span className="text-xs text-muted-foreground">{t('standard_duration')}: <span className="font-medium text-foreground tabular-nums">{duration(j.standard_duration)}</span></span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" title={t('edit')} aria-label={t('edit')} onClick={() => setEditing(j)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" title={t('delete')} aria-label={t('delete')} className="text-destructive" disabled={j.wo_count > 0} onClick={() => setDeleting(j)}><Trash2 className="size-4" /></Button>
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
                <Th><SortHeader field="job_code" label="job_code" state={state} /></Th>
                <Th><SortHeader field="job_name" label="job_name" state={state} /></Th>
                <Th><SortHeader field="category" label="category" state={state} /></Th>
                <Th><SortHeader field="standard_duration" label="standard_duration" state={state} /></Th>
                <Th>{t('wo_used')}</Th>
                <Th>{t('status')}</Th>
                <Th className="text-right">{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j, i) => (
                <tr key={j.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{(params.page - 1) * params.limit + i + 1}</td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{j.job_code}</td>
                  <td className="px-4 py-3 font-medium">{j.job_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {j.category_name}
                    {!j.category_active && <span className="ml-1.5 text-xs text-muted-foreground">({t('inactive')})</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{duration(j.standard_duration)}</td>
                  <td className="px-4 py-3 tabular-nums">{j.wo_count}</td>
                  <td className="px-4 py-3"><ActiveBadge active={j.is_active} /></td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => setEditing(j)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} className="text-destructive" disabled={j.wo_count > 0} onClick={() => setDeleting(j)}><Trash2 className="size-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
        {list.isError && <EmptyState title={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>{t('reload')}</Button>} />}
        {list.data && !rows.length && <EmptyState title={t('no_data')} action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> {t('add_job_code')}</Button>} />}
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

      {editing && (
        <JobCodeForm
          job={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          defaultCategory={params.category_id ? String(params.category_id) : ''}
          onClose={() => setEditing(null)}
        />
      )}
      <DeleteDialog path="job-codes" hint="job_delete_hint" item={deleting && { id: deleting.id, label: `${deleting.job_code} · ${deleting.job_name}` }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function JobCodeForm({ job, categories, defaultCategory, onClose }: { job: MasterJobCode | null; categories: Category[]; defaultCategory: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    job_code: job?.job_code ?? '',
    job_name: job?.job_name ?? '',
    category_id: job ? String(job.category_id) : defaultCategory,
    hours: job?.standard_duration ? String(Math.floor(job.standard_duration / 60)) : '',
    minutes: job?.standard_duration ? String(job.standard_duration % 60) : '',
    is_active: job ? !!job.is_active : true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const totalMinutes = (Number(form.hours) || 0) * 60 + (Number(form.minutes) || 0);
  // New job codes go into active categories; an existing one keeps its (possibly inactive) category.
  const options = categories.filter((c) => c.is_active || String(c.id) === String(job?.category_id ?? ''));

  const save = useMutation({
    mutationFn: () =>
      api<MasterJobCode>(job ? `/job-codes/${job.id}` : '/job-codes', {
        method: job ? 'PUT' : 'POST',
        body: { job_code: form.job_code, job_name: form.job_name, category_id: form.category_id, standard_duration: totalMinutes || '', is_active: form.is_active },
      }),
    onSuccess: (saved) => {
      toast('success', t('data_saved'), `${saved.job_code} · ${saved.job_name}`);
      qc.invalidateQueries({ queryKey: ['job-codes'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err) ?? {});
      toast('error', (err as Error).message);
    },
  });

  const set = (k: keyof typeof form, errorKey: string = k) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [errorKey]: '' }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,19}$/.test(form.job_code.trim())) next.job_code = 'Job code must be 2-20 characters: A-Z, 0-9, . _ -';
    if (form.job_name.trim().length < 2) next.job_name = 'Job name must be 2-200 characters';
    if (!form.category_id) next.category_id = 'Category is required';
    if (Number(form.minutes) > 59) next.standard_duration = 'Minutes must be 0-59';
    else if (totalMinutes > 60000) next.standard_duration = 'Standard duration must be at most 1000 hours';
    setErrors(next);
    if (!Object.keys(next).length) confirm({ message: t(job ? 'confirm_save_edit' : 'confirm_save_new', { name: form.job_code.trim() }) }, () => save.mutate());
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={job ? `${t('edit_job_code')} · ${job.job_code}` : t('add_job_code')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="job-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="job-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('job_code')} required error={errors.job_code}>
          <Input
            value={form.job_code}
            onChange={(e) => set('job_code')({ target: { value: e.target.value.toUpperCase().replace(/\s+/g, '-') } })}
            placeholder="HYD-01"
            maxLength={20}
            invalid={!!errors.job_code}
            className="font-mono uppercase"
            autoFocus
          />
        </Field>
        <Field label={t('job_name')} required error={errors.job_name}>
          <Input value={form.job_name} onChange={set('job_name')} placeholder="Replace hydraulic hose" maxLength={200} invalid={!!errors.job_name} />
        </Field>
        <Field label={t('category')} required error={errors.category_id}>
          <Select value={form.category_id} onChange={set('category_id')} invalid={!!errors.category_id}>
            <option value="">{t('select_category_required')}</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ` (${t('inactive')})`}</option>)}
          </Select>
        </Field>
        <div>
          <p className="text-sm font-medium">{t('standard_duration')}</p>
          <p className="mb-1.5 text-xs text-muted-foreground">{t('job_duration_hint')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hours')}>
              <Input type="number" inputMode="numeric" min={0} max={1000} value={form.hours} onChange={set('hours', 'standard_duration')} invalid={!!errors.standard_duration} placeholder="0" />
            </Field>
            <Field label={t('minutes')}>
              <Input type="number" inputMode="numeric" min={0} max={59} value={form.minutes} onChange={set('minutes', 'standard_duration')} invalid={!!errors.standard_duration} placeholder="0" />
            </Field>
          </div>
          {errors.standard_duration && <p className="mt-1 text-xs text-destructive">{errors.standard_duration}</p>}
        </div>
        <Switch checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} label={t('active')} description={t('job_active_hint')} />
      </form>
    </Modal>
  );
}
