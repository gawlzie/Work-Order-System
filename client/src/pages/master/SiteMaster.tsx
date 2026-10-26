import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { MapPin, Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ActiveBadge, DeleteDialog, SearchBox, SortHeader, Th, fieldErrors, useListState } from '../../components/master';
import { Pagination } from '../../components/Pagination';
import { useConfirm } from '../../components/confirm';
import { useToast } from '../../components/toast';
import { BtnLabel, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { usePaged } from '../../lib/queries';
import type { MasterSite } from '../../lib/types';

const FILTERS = ['status'] as const;

export function SiteMasterPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const state = useListState(FILTERS, 'site_code');
  const { params, update } = state;
  const list = usePaged<MasterSite>('sites', params);
  const [editing, setEditing] = useState<MasterSite | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MasterSite | null>(null);
  const rows = list.data?.data ?? [];
  // The employee count links to the employee list of that site when the user may see it.
  const count = (n: number, to: string, allowed: boolean) => (allowed && n ? <Link to={to} className="text-primary hover:underline">{n}</Link> : n);
  const q = (s: MasterSite) => `site=${encodeURIComponent(s.site_name)}`;
  const employees = (s: MasterSite) => count(s.employee_count, `/master/employee?${q(s)}`, can('master.employee'));
  const units = (s: MasterSite) => count(s.unit_count, `/master/unit?${q(s)}`, can('master.unit'));
  const wos = (s: MasterSite) => count(s.wo_count, `/transaction/work-order?${q(s)}`, true);
  const used = (s: MasterSite) => s.employee_count + s.unit_count + s.wo_count > 0;

  return (
    <div>
      <PageHeader
        title={t('sites')}
        subtitle={t('site_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_site')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchBox state={state} placeholder={t('search_site')} />
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
          {rows.map((s) => (
            <li key={s.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{s.site_code}</p>
                  <p className="font-medium">{s.site_name}{s.site_alias && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({s.site_alias})</span>}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.company}</p>
                  {(s.location || s.location_alias) && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" /> {[s.location, s.location_alias && `(${s.location_alias})`].filter(Boolean).join(' ')}</p>}
                </div>
                <ActiveBadge active={s.is_active} />
              </div>
              <div className="mt-2 -mr-2 flex items-center justify-between gap-1">
                <span className="text-xs text-muted-foreground">
                  {t('employees')}: <span className="font-medium text-foreground tabular-nums">{employees(s)}</span> · {t('units')}: <span className="font-medium text-foreground tabular-nums">{units(s)}</span> · {t('work_order')}: <span className="font-medium text-foreground tabular-nums">{wos(s)}</span>
                </span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" title={t('edit')} aria-label={t('edit')} onClick={() => setEditing(s)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" title={t('delete')} aria-label={t('delete')} className="text-destructive" disabled={used(s)} onClick={() => setDeleting(s)}><Trash2 className="size-4" /></Button>
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
                <Th><SortHeader field="site_code" label="site_code" state={state} /></Th>
                <Th><SortHeader field="site_name" label="site_name" state={state} /></Th>
                <Th><SortHeader field="company" label="company" state={state} /></Th>
                <Th>{t('location')}</Th>
                <Th><SortHeader field="employee_count" label="employees" state={state} /></Th>
                <Th><SortHeader field="unit_count" label="units" state={state} /></Th>
                <Th><SortHeader field="wo_count" label="work_order" state={state} /></Th>
                <Th>{t('status')}</Th>
                <Th className="text-right">{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{(params.page - 1) * params.limit + i + 1}</td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{s.site_code}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{s.site_name}</span>
                    {s.site_alias && <span className="block text-xs text-muted-foreground">{t('alias')}: {s.site_alias}</span>}
                  </td>
                  <td className="px-4 py-3">{s.company}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.location ?? '-'}
                    {s.location_alias && <span className="block text-xs">{t('alias')}: {s.location_alias}</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{employees(s)}</td>
                  <td className="px-4 py-3 tabular-nums">{units(s)}</td>
                  <td className="px-4 py-3 tabular-nums">{wos(s)}</td>
                  <td className="px-4 py-3"><ActiveBadge active={s.is_active} /></td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => setEditing(s)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} className="text-destructive" disabled={used(s)} onClick={() => setDeleting(s)}><Trash2 className="size-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
        {list.isError && <EmptyState title={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>{t('reload')}</Button>} />}
        {list.data && !rows.length && <EmptyState title={t('no_data')} action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> {t('add_site')}</Button>} />}
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

      {editing && <SiteForm site={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <DeleteDialog path="sites" hint="site_delete_hint" item={deleting && { id: deleting.id, label: `${deleting.site_code} · ${deleting.site_name}` }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function SiteForm({ site, onClose }: { site: MasterSite | null; onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    site_code: site?.site_code ?? '',
    site_name: site?.site_name ?? '',
    company: site?.company ?? user?.company ?? '',
    location: site?.location ?? '',
    site_alias: site?.site_alias ?? '',
    location_alias: site?.location_alias ?? '',
    is_active: site ? !!site.is_active : true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api<MasterSite>(site ? `/sites/${site.id}` : '/sites', { method: site ? 'PUT' : 'POST', body: form }),
    onSuccess: (saved) => {
      toast('success', t('data_saved'), `${saved.site_code} · ${saved.site_name}`);
      qc.invalidateQueries({ queryKey: ['sites'] });
      // A renamed site is renamed on its employees too.
      qc.invalidateQueries({ queryKey: ['employees'] });
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
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,19}$/.test(form.site_code.trim())) next.site_code = 'Site code must be 2-20 characters: A-Z, 0-9, _ -';
    if (form.site_name.trim().length < 2) next.site_name = 'Site name must be 2-100 characters';
    if (form.company.trim().length < 2) next.company = 'Company must be 2-100 characters';
    setErrors(next);
    if (Object.keys(next).length) return;
    // Renaming a site with employees renames it on them too: say so in the confirmation.
    const renamed = site && site.employee_count > 0 && form.site_name.trim() !== site.site_name;
    confirm(
      { message: renamed ? t('confirm_site_rename', { from: site.site_name, to: form.site_name.trim(), n: site.employee_count }) : t(site ? 'confirm_save_edit' : 'confirm_save_new', { name: form.site_name.trim() }) },
      () => save.mutate(),
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={site ? `${t('edit_site')} · ${site.site_code}` : t('add_site')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="site-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="site-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('site_code')} required error={errors.site_code}>
          <Input
            value={form.site_code}
            onChange={(e) => set('site_code')({ target: { value: e.target.value.toUpperCase().replace(/\s+/g, '-') } })}
            placeholder="SITE-05"
            maxLength={20}
            invalid={!!errors.site_code}
            className="font-mono uppercase"
            autoFocus
          />
        </Field>
        <Field label={t('site_name')} required error={errors.site_name}>
          <Input value={form.site_name} onChange={set('site_name')} placeholder="Site Kalimantan - Pit C" maxLength={100} invalid={!!errors.site_name} />
        </Field>
        <Field label={t('site_alias')} error={errors.site_alias}>
          <Input value={form.site_alias} onChange={set('site_alias')} placeholder="PIT-C" maxLength={50} invalid={!!errors.site_alias} />
        </Field>
        <Field label={t('company')} required error={errors.company}>
          <Input value={form.company} onChange={set('company')} maxLength={100} invalid={!!errors.company} />
        </Field>
        <Field label={t('location')} error={errors.location}>
          <Input value={form.location} onChange={set('location')} placeholder="Kutai Kartanegara, Kalimantan Timur" maxLength={200} invalid={!!errors.location} />
        </Field>
        <Field label={t('location_alias')} error={errors.location_alias}>
          <Input value={form.location_alias} onChange={set('location_alias')} placeholder="KUKAR" maxLength={50} invalid={!!errors.location_alias} />
        </Field>
        <Switch checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} label={t('active')} description={t('site_active_hint')} />
      </form>
    </Modal>
  );
}
