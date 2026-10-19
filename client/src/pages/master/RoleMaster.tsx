import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Lock, Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DeleteDialog, SearchBox, SortHeader, Th, fieldErrors, useListState } from '../../components/master';
import { Pagination } from '../../components/Pagination';
import { useToast } from '../../components/toast';
import { Badge, BtnLabel, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Skeleton, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n, type TKey } from '../../lib/i18n';
import { usePaged, usePermissionDefs } from '../../lib/queries';
import type { MasterRole, Permission, PermissionDef } from '../../lib/types';

const GROUPS: PermissionDef['group'][] = ['work_order', 'assignment', 'master'];
const permLabel = (key: Permission) => `perm_${key}` as TKey;

export function RoleMasterPage() {
  const { t } = useI18n();
  const state = useListState([], 'name');
  const { params, update } = state;
  const list = usePaged<MasterRole>('roles', params);
  const defs = usePermissionDefs();
  const [editing, setEditing] = useState<MasterRole | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MasterRole | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('roles')}
        subtitle={t('role_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_role')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchBox state={state} placeholder={t('search_role')} />
          {params.search && <Button variant="ghost" onClick={state.reset}><X className="size-4" /> {t('reset')}</Button>}
        </div>

        <ul className="divide-y divide-border lg:hidden">
          {rows.map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code}</p>
                </div>
                {!!r.is_system && <Badge variant="gray"><Lock className="mr-1 size-3" />{t('built_in')}</Badge>}
              </div>
              {r.description && <p className="mt-2 text-xs text-muted-foreground">{r.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1">
                {r.permissions.map((p) => <Badge key={p} variant="default" className="font-normal">{t(permLabel(p))}</Badge>)}
              </div>
              <div className="mt-2 -mr-2 flex items-center justify-between gap-1">
                <span className="text-xs text-muted-foreground">{t('employees')}: <span className="font-medium text-foreground tabular-nums">{r.employee_count}</span></span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" title={t('edit')} aria-label={t('edit')} onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" title={t('delete')} aria-label={t('delete')} className="text-destructive" disabled={!!r.is_system || r.employee_count > 0} onClick={() => setDeleting(r)}>
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
                <Th><SortHeader field="code" label="code" state={state} /></Th>
                <Th><SortHeader field="name" label="name" state={state} /></Th>
                <Th>{t('permissions')}</Th>
                <Th><SortHeader field="employee_count" label="employees" state={state} /></Th>
                <Th className="text-right">{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-border align-top hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{(params.page - 1) * params.limit + i + 1}</td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    {r.code}
                    {!!r.is_system && <Badge variant="gray" className="ml-2 font-sans"><Lock className="mr-1 size-3" />{t('built_in')}</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.name}</span>
                    {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-xl flex-wrap gap-1">
                      {r.permissions.map((p) => <Badge key={p} variant="default" className="font-normal">{t(permLabel(p))}</Badge>)}
                      {!r.permissions.length && <span className="text-muted-foreground">-</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.employee_count}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} className="text-destructive" disabled={!!r.is_system || r.employee_count > 0} onClick={() => setDeleting(r)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3].map((n) => <Skeleton key={n} className="h-10" />)}</div>}
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

      {editing && defs.data && <RoleForm role={editing === 'new' ? null : editing} defs={defs.data} onClose={() => setEditing(null)} />}
      <DeleteDialog path="roles" item={deleting && { id: deleting.id, label: deleting.name }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function RoleForm({ role, defs, onClose }: { role: MasterRole | null; defs: PermissionDef[]; onClose: () => void }) {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const isAdmin = role?.code === 'admin';
  // Mirrors the server: admin always keeps every access permission; only assignment flags are optional.
  const locked = (d: PermissionDef) => isAdmin && d.group !== 'assignment';
  const [form, setForm] = useState({ code: role?.code ?? '', name: role?.name ?? '', description: role?.description ?? '' });
  const [perms, setPerms] = useState<Set<Permission>>(() => new Set(role?.permissions ?? []));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api<MasterRole>(role ? `/roles/${role.id}` : '/roles', { method: role ? 'PUT' : 'POST', body: { ...form, permissions: [...perms] } }),
    onSuccess: async (saved) => {
      toast('success', t('data_saved'), saved.name);
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      if (saved.code === user?.role || role?.code === user?.role) await refresh();
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err) ?? {});
      toast('error', (err as Error).message);
    },
  });

  const toggle = (keys: Permission[], on: boolean) =>
    setPerms((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: '' }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[a-z0-9_]{2,30}$/.test(form.code)) next.code = 'Code must be 2-30 characters: a-z, 0-9 or _';
    if (form.name.trim().length < 2) next.name = 'Name is required';
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={role ? `${t('edit_role')} · ${role.name}` : t('add_role')}
      description={role?.is_system ? t('built_in_hint') : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="role-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="role-form" onSubmit={submit} className="space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('code')} required error={errors.code}>
            <Input
              value={form.code}
              onChange={(e) => set('code')({ target: { value: e.target.value.toLowerCase().replace(/[\s-]+/g, '_') } })}
              placeholder="senior_mechanic"
              maxLength={30}
              disabled={!!role?.is_system}
              className="font-mono"
              invalid={!!errors.code}
              autoFocus={!role}
            />
          </Field>
          <Field label={t('name')} required error={errors.name}>
            <Input value={form.name} onChange={set('name')} maxLength={60} invalid={!!errors.name} />
          </Field>
          <Field label={t('description')} className="sm:col-span-2">
            <Textarea value={form.description} onChange={set('description')} maxLength={200} className="min-h-16" />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">{t('permissions')}</p>
          {isAdmin && <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t('admin_locked')}</p>}
          {errors.permissions && <p className="mb-2 text-xs text-destructive">{errors.permissions}</p>}
          <div className="space-y-4">
            {GROUPS.map((group) => {
              const items = defs.filter((d) => d.group === group);
              const editable = items.filter((d) => !locked(d)).map((d) => d.key);
              const allOn = items.every((d) => locked(d) || perms.has(d.key));
              return (
                <fieldset key={group} className="rounded-lg border border-border">
                  <legend className="sr-only">{t(`perm_group_${group}` as TKey)}</legend>
                  <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
                    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(`perm_group_${group}` as TKey)}</span>
                    {editable.length > 0 && (
                      <label className="flex cursor-pointer items-center gap-2 text-xs">
                        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allOn} onChange={(e) => toggle(editable, e.target.checked)} />
                        {t('select_all')}
                      </label>
                    )}
                  </div>
                  <div className="grid gap-1 p-2 sm:grid-cols-2">
                    {items.map((d) => (
                      <label key={d.key} className={clsx('flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm', locked(d) ? 'opacity-70' : 'cursor-pointer hover:bg-muted')}>
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                          checked={locked(d) || perms.has(d.key)}
                          disabled={locked(d)}
                          onChange={(e) => toggle([d.key], e.target.checked)}
                        />
                        <span>{t(permLabel(d.key))}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>
      </form>
    </Modal>
  );
}
