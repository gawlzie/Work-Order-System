import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ActiveBadge, DeleteDialog, SearchBox, SortHeader, Th, fieldErrors, useListState } from '../../components/master';
import { Pagination } from '../../components/Pagination';
import { useToast } from '../../components/toast';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { usePaged, useUnitTypes } from '../../lib/queries';
import type { MasterUnit } from '../../lib/types';

const FILTERS = ['status', 'unit_type'] as const;

export function UnitMasterPage() {
  const { t } = useI18n();
  const state = useListState(FILTERS, 'unit_code');
  const { params, update } = state;
  const list = usePaged<MasterUnit>('units', params);
  const types = useUnitTypes();
  const [editing, setEditing] = useState<MasterUnit | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MasterUnit | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('units')}
        subtitle={t('unit_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> {t('reload')}
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_unit')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchBox state={state} placeholder={t('search_unit')} />
          <Select value={params.unit_type} onChange={(e) => update({ unit_type: e.target.value })} className="sm:w-44" aria-label={t('unit_type')}>
            <option value="">{t('all_types')}</option>
            {types.data?.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
          </Select>
          <Select value={params.status} onChange={(e) => update({ status: e.target.value })} className="sm:w-40" aria-label={t('status')}>
            <option value="">{t('all_status')}</option>
            <option value="active">{t('active')}</option>
            <option value="inactive">{t('inactive')}</option>
          </Select>
          {(params.search || params.status || params.unit_type) && (
            <Button variant="ghost" onClick={state.reset}><X className="size-4" /> {t('reset')}</Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <Th>{t('no')}</Th>
                <Th><SortHeader field="unit_code" label="unit_code" state={state} /></Th>
                <Th><SortHeader field="unit_number" label="unit_number" state={state} /></Th>
                <Th><SortHeader field="unit_type" label="unit_type" state={state} /></Th>
                <Th><SortHeader field="brand" label="brand" state={state} /></Th>
                <Th>{t('serial_number')}</Th>
                <Th><SortHeader field="year" label="year" state={state} /></Th>
                <Th>{t('active_wo')}</Th>
                <Th>{t('status')}</Th>
                <Th className="text-right">{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{(params.page - 1) * params.limit + i + 1}</td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{u.unit_code}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{u.unit_number}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{u.unit_type}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{[u.brand, u.model].filter(Boolean).join(' ') || '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{u.serial_number ?? '-'}</td>
                  <td className="px-4 py-3 tabular-nums">{u.year ?? '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {u.active_wo ? (
                      <Link to={`/transaction/work-order?search=${encodeURIComponent(u.active_wo)}`} className="text-primary hover:underline">{u.active_wo}</Link>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3"><ActiveBadge active={u.is_active} /></td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => setEditing(u)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} className="text-destructive" disabled={u.wo_count > 0} onClick={() => setDeleting(u)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
          {list.isError && <EmptyState title={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>{t('reload')}</Button>} />}
          {list.data && !rows.length && <EmptyState title={t('no_data')} />}
        </div>
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

      {editing && <UnitForm unit={editing === 'new' ? null : editing} types={types.data ?? []} onClose={() => setEditing(null)} />}
      <DeleteDialog path="units" item={deleting && { id: deleting.id, label: `${deleting.unit_code} · ${deleting.unit_number}` }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function UnitForm({ unit, types, onClose }: { unit: MasterUnit | null; types: string[]; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    unit_code: unit?.unit_code ?? '',
    unit_number: unit?.unit_number ?? '',
    unit_type: unit?.unit_type ?? types[0] ?? 'Dump Truck',
    brand: unit?.brand ?? '',
    model: unit?.model ?? '',
    serial_number: unit?.serial_number ?? '',
    year: unit?.year ? String(unit.year) : '',
    is_active: unit ? !!unit.is_active : true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api<MasterUnit>(unit ? `/units/${unit.id}` : '/units', { method: unit ? 'PUT' : 'POST', body: form }),
    onSuccess: (saved) => {
      toast('success', t('data_saved'), `${saved.unit_code} · ${saved.unit_number}`);
      qc.invalidateQueries({ queryKey: ['units'] });
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err) ?? {});
      toast('error', (err as Error).message);
    },
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: '' }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.unit_code.trim().length < 2) next.unit_code = 'Unit code is required';
    if (!form.unit_number.trim()) next.unit_number = 'Unit number is required';
    if (form.unit_type.trim().length < 2) next.unit_type = 'Unit type is required';
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={unit ? `${t('edit_unit')} · ${unit.unit_code}` : t('add_unit')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="unit-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="unit-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={t('unit_code')} required error={errors.unit_code}>
          <Input value={form.unit_code} onChange={set('unit_code')} placeholder="DT-021" maxLength={20} invalid={!!errors.unit_code} className="uppercase" autoFocus />
        </Field>
        <Field label={t('unit_number')} required error={errors.unit_number}>
          <Input value={form.unit_number} onChange={set('unit_number')} placeholder="DT 121" maxLength={30} invalid={!!errors.unit_number} />
        </Field>
        <Field label={t('unit_type')} required error={errors.unit_type}>
          <Input value={form.unit_type} onChange={set('unit_type')} list="unit-types" maxLength={50} invalid={!!errors.unit_type} />
          <datalist id="unit-types">{types.map((ty) => <option key={ty} value={ty} />)}</datalist>
        </Field>
        <Field label={t('year')} error={errors.year}>
          <Input type="number" inputMode="numeric" value={form.year} onChange={set('year')} min={1950} max={new Date().getFullYear() + 1} invalid={!!errors.year} />
        </Field>
        <Field label={t('brand')} error={errors.brand}>
          <Input value={form.brand} onChange={set('brand')} maxLength={50} />
        </Field>
        <Field label={t('model')} error={errors.model}>
          <Input value={form.model} onChange={set('model')} maxLength={50} />
        </Field>
        <Field label={t('serial_number')} error={errors.serial_number} className="sm:col-span-2">
          <Input value={form.serial_number} onChange={set('serial_number')} maxLength={50} invalid={!!errors.serial_number} className="uppercase" />
        </Field>
        <div className="sm:col-span-2">
          <Switch
            checked={form.is_active}
            onChange={(v) => { setForm((f) => ({ ...f, is_active: v })); setErrors((er) => ({ ...er, is_active: '' })); }}
            label={t('active')}
            description={t('unit_active_hint')}
          />
          {errors.is_active && <p className="mt-1 text-xs text-destructive">{errors.is_active}</p>}
          {unit?.active_wo && <Badge variant="yellow" className="mt-2">{t('active_wo')}: {unit.active_wo}</Badge>}
        </div>
      </form>
    </Modal>
  );
}
