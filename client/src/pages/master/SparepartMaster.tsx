import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, Boxes, PackageX, Pencil, Plus, RefreshCcw, Trash2, Wallet, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ActiveBadge, DeleteDialog, SearchBox, SortHeader, Th, fieldErrors, useListState } from '../../components/master';
import { Pagination } from '../../components/Pagination';
import { useConfirm } from '../../components/confirm';
import { useToast } from '../../components/toast';
import { Badge, BtnLabel, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useCategories, usePaged } from '../../lib/queries';
import type { Category, MasterSparepart, SparepartSummary } from '../../lib/types';

const FILTERS = ['status', 'category_id', 'stock'] as const;

/** Units of measure (same list as the server); LTR, KG and MTR may hold decimals. */
const UOMS = ['PCS', 'SET', 'UNIT', 'PAIR', 'BOX', 'ROLL', 'TUBE', 'CAN', 'PAIL', 'DRUM', 'LTR', 'KG', 'MTR'];
const DECIMAL_UOMS = ['LTR', 'KG', 'MTR'];

const qty = (value: number, lang: string) => new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-GB', { maximumFractionDigits: 2 }).format(value);
const rupiah = (value: number | null) => (value == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value));

function StockBadge({ status }: { status: MasterSparepart['stock_status'] }) {
  const { t } = useI18n();
  if (status === 'out') return <Badge variant="destructive">{t('stock_out')}</Badge>;
  if (status === 'low') return <Badge variant="yellow">{t('stock_low')}</Badge>;
  return <Badge variant="green">{t('stock_ok')}</Badge>;
}

/** Counter above the list; the low / out ones also filter the list. */
function Counter({ icon, label, value, tone, active, onClick }: { icon: ReactNode; label: string; value: ReactNode; tone?: 'yellow' | 'red'; active?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-xl border bg-card p-3 text-left',
        onClick && 'transition-colors hover:bg-muted/60',
        active ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <span className={clsx('grid size-9 shrink-0 place-items-center rounded-lg', tone === 'red' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : tone === 'yellow' ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' : 'bg-primary/10 text-primary')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block text-sm font-semibold tabular-nums sm:text-base">{value}</span>
      </span>
    </Tag>
  );
}

export function SparepartMasterPage() {
  const { t, lang } = useI18n();
  const state = useListState(FILTERS, 'part_number');
  const { params, update } = state;
  const list = usePaged<MasterSparepart>('spareparts', params);
  const categories = useCategories(true);
  const [editing, setEditing] = useState<MasterSparepart | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MasterSparepart | null>(null);
  const rows = list.data?.data ?? [];
  const summary = (list.data as { summary?: SparepartSummary } | undefined)?.summary;
  const toggleStock = (v: 'low' | 'out') => update({ stock: params.stock === v ? '' : v });

  return (
    <div>
      <PageHeader
        title={t('spareparts')}
        subtitle={t('sparepart_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_sparepart')}
            </Button>
          </>
        }
      />

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Counter icon={<Boxes className="size-5" />} label={t('parts_active')} value={summary.total} />
          <Counter icon={<AlertTriangle className="size-5" />} label={t('stock_low')} value={summary.low} tone="yellow" active={params.stock === 'low'} onClick={() => toggleStock('low')} />
          <Counter icon={<PackageX className="size-5" />} label={t('stock_out')} value={summary.out} tone="red" active={params.stock === 'out'} onClick={() => toggleStock('out')} />
          <Counter icon={<Wallet className="size-5" />} label={t('stock_value')} value={rupiah(summary.stock_value)} />
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchBox state={state} placeholder={t('search_sparepart')} />
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <Select value={params.category_id} onChange={(e) => update({ category_id: e.target.value })} className="sm:w-44" aria-label={t('category')}>
              <option value="">{t('all_categories')}</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={params.stock} onChange={(e) => update({ stock: e.target.value })} className="sm:w-40" aria-label={t('stock')}>
              <option value="">{t('all_stock')}</option>
              <option value="ok">{t('stock_ok')}</option>
              <option value="low">{t('stock_low')}</option>
              <option value="out">{t('stock_out')}</option>
            </Select>
            <Select value={params.status} onChange={(e) => update({ status: e.target.value })} className="col-span-2 sm:w-36" aria-label={t('status')}>
              <option value="">{t('all_status')}</option>
              <option value="active">{t('active')}</option>
              <option value="inactive">{t('inactive')}</option>
            </Select>
          </div>
          {(params.search || params.status || params.category_id || params.stock) && (
            <Button variant="ghost" onClick={state.reset}><X className="size-4" /> {t('reset')}</Button>
          )}
        </div>

        <ul className="divide-y divide-border lg:hidden">
          {rows.map((p) => (
            <li key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{p.part_number}</p>
                  <p className="font-medium">{p.part_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{[p.category_name ?? t('no_category'), p.brand, p.location].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StockBadge status={p.stock_status} />
                  {!p.is_active && <ActiveBadge active={false} />}
                </div>
              </div>
              <div className="mt-2 -mr-2 flex items-center justify-between gap-1">
                <span className="text-xs text-muted-foreground">
                  {t('stock')}: <span className="font-medium text-foreground tabular-nums">{qty(p.stock, lang)} {p.uom}</span> · {t('min_stock_short')} {qty(p.min_stock, lang)} · {rupiah(p.unit_price)}
                </span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" title={t('edit')} aria-label={t('edit')} onClick={() => setEditing(p)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" title={t('delete')} aria-label={t('delete')} className="text-destructive" onClick={() => setDeleting(p)}><Trash2 className="size-4" /></Button>
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
                <Th><SortHeader field="part_number" label="part_number" state={state} /></Th>
                <Th><SortHeader field="part_name" label="part_name" state={state} /></Th>
                <Th><SortHeader field="category" label="category" state={state} /></Th>
                <Th className="text-right"><SortHeader field="stock" label="stock" state={state} /></Th>
                <Th className="text-right"><SortHeader field="unit_price" label="unit_price" state={state} /></Th>
                <Th>{t('status')}</Th>
                <Th className="text-right">{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.id} className={clsx('border-t border-border hover:bg-muted/40', !p.is_active && 'text-muted-foreground')}>
                  <td className="px-4 py-3 text-muted-foreground">{(params.page - 1) * params.limit + i + 1}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-mono text-xs">{p.part_number}</span>
                    {p.location && <span className="block text-xs text-muted-foreground" title={t('rack_location')}>{t('rack_short')} <span className="font-mono">{p.location}</span></span>}
                  </td>
                  <td className="min-w-56 px-4 py-3">
                    <span className="font-medium">{p.part_name}</span>
                    {p.brand && <span className="block text-xs text-muted-foreground">{p.brand}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {p.category_name ?? <span className="text-muted-foreground">-</span>}
                    {p.category_name && !p.category_active && <span className="ml-1.5 text-xs text-muted-foreground">({t('inactive')})</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    <span className="font-medium">{qty(p.stock, lang)}</span> <span className="text-xs text-muted-foreground">{p.uom}</span>
                    <span className="block text-xs text-muted-foreground">{t('min_stock_short')} {qty(p.min_stock, lang)}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{rupiah(p.unit_price)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <StockBadge status={p.stock_status} />
                      {!p.is_active && <ActiveBadge active={false} />}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => setEditing(p)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} className="text-destructive" onClick={() => setDeleting(p)}><Trash2 className="size-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
        {list.isError && <EmptyState title={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>{t('reload')}</Button>} />}
        {list.data && !rows.length && <EmptyState title={t('no_data')} action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> {t('add_sparepart')}</Button>} />}
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
        <SparepartForm
          part={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          defaultCategory={params.category_id ? String(params.category_id) : ''}
          onClose={() => setEditing(null)}
        />
      )}
      <DeleteDialog path="spareparts" hint="sparepart_delete_hint" item={deleting && { id: deleting.id, label: `${deleting.part_number} · ${deleting.part_name}` }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function SparepartForm({ part, categories, defaultCategory, onClose }: { part: MasterSparepart | null; categories: Category[]; defaultCategory: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    part_number: part?.part_number ?? '',
    part_name: part?.part_name ?? '',
    category_id: part?.category_id ? String(part.category_id) : defaultCategory,
    brand: part?.brand ?? '',
    uom: part?.uom ?? 'PCS',
    stock: part ? String(part.stock) : '0',
    min_stock: part ? String(part.min_stock) : '0',
    location: part?.location ?? '',
    unit_price: part?.unit_price != null ? String(part.unit_price) : '',
    is_active: part ? !!part.is_active : true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const decimals = DECIMAL_UOMS.includes(form.uom);
  // New parts go into active categories; an existing one keeps its (possibly inactive) category.
  const options = categories.filter((c) => c.is_active || String(c.id) === String(part?.category_id ?? ''));

  const save = useMutation({
    mutationFn: () =>
      api<MasterSparepart>(part ? `/spareparts/${part.id}` : '/spareparts', {
        method: part ? 'PUT' : 'POST',
        body: { ...form, category_id: form.category_id || null },
      }),
    onSuccess: (saved) => {
      toast('success', t('data_saved'), `${saved.part_number} · ${saved.part_name}`);
      qc.invalidateQueries({ queryKey: ['spareparts'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
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

  const qtyError = (raw: string, label: string) => {
    const v = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(v) || v < 0 || v > 9999999) return `${label} must be a number from 0 to 9,999,999`;
    if (!decimals && !Number.isInteger(v)) return `${label} must be a whole number for ${form.uom}`;
    if (decimals && Math.round(v * 100) !== v * 100) return `${label} can have at most 2 decimals`;
    return '';
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._\-/*()+#]{1,59}$/.test(form.part_number.trim().replace(/\s+/g, ' '))) next.part_number = 'Part number must be 2-60 characters: A-Z, 0-9, space . _ - / * ( ) + #';
    if (form.part_name.trim().length < 2) next.part_name = 'Part name must be 2-300 characters';
    const stockError = qtyError(form.stock, 'Stock');
    if (stockError) next.stock = stockError;
    const minError = qtyError(form.min_stock, 'Minimum stock');
    if (minError) next.min_stock = minError;
    if (form.unit_price.trim() !== '' && !(Number.isInteger(Number(form.unit_price)) && Number(form.unit_price) >= 0)) next.unit_price = 'Unit price must be a whole number of rupiah from 0';
    setErrors(next);
    if (!Object.keys(next).length) confirm({ message: t(part ? 'confirm_save_edit' : 'confirm_save_new', { name: form.part_number.trim().toUpperCase() }) }, () => save.mutate());
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={part ? `${t('edit_sparepart')} · ${part.part_number}` : t('add_sparepart')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="part-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="part-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={t('part_number')} required error={errors.part_number}>
          <Input
            value={form.part_number}
            onChange={(e) => set('part_number')({ target: { value: e.target.value.toUpperCase() } })}
            placeholder="VG61000070005"
            maxLength={60}
            invalid={!!errors.part_number}
            className="font-mono uppercase"
            autoFocus
          />
        </Field>
        <Field label={t('brand')} error={errors.brand}>
          <Input value={form.brand} onChange={set('brand')} placeholder="Weichai" maxLength={60} invalid={!!errors.brand} />
        </Field>
        <Field label={t('part_name')} required error={errors.part_name} className="sm:col-span-2">
          <Input value={form.part_name} onChange={set('part_name')} placeholder="Filter Oli Engine" maxLength={300} invalid={!!errors.part_name} />
        </Field>
        <Field label={t('category')} error={errors.category_id}>
          <Select value={form.category_id} onChange={set('category_id')} invalid={!!errors.category_id}>
            <option value="">{t('no_category')}</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ` (${t('inactive')})`}</option>)}
          </Select>
        </Field>
        <Field label={t('uom')} required error={errors.uom}>
          <Select value={form.uom} onChange={set('uom')} invalid={!!errors.uom}>
            {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label={`${t('stock')} (${form.uom})`} required error={errors.stock}>
          <Input type="number" inputMode="decimal" min={0} step={decimals ? 0.01 : 1} value={form.stock} onChange={set('stock')} invalid={!!errors.stock} />
        </Field>
        <Field label={`${t('min_stock')} (${form.uom})`} required error={errors.min_stock}>
          <Input type="number" inputMode="decimal" min={0} step={decimals ? 0.01 : 1} value={form.min_stock} onChange={set('min_stock')} invalid={!!errors.min_stock} />
        </Field>
        <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">{t('min_stock_hint')} {t('qty_decimal_hint')}</p>
        <Field label={t('rack_location')} error={errors.location}>
          <Input value={form.location} onChange={(e) => set('location')({ target: { value: e.target.value.toUpperCase() } })} placeholder="A-01-01" maxLength={30} invalid={!!errors.location} className="font-mono uppercase" />
        </Field>
        <Field label={t('unit_price')} error={errors.unit_price}>
          <Input type="number" inputMode="numeric" min={0} step={1} value={form.unit_price} onChange={set('unit_price')} placeholder="185000" invalid={!!errors.unit_price} />
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} label={t('active')} description={t('sparepart_active_hint')} />
        </div>
      </form>
    </Modal>
  );
}
