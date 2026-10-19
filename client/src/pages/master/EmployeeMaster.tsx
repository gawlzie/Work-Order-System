import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { KeyRound, Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ActiveBadge, DeleteDialog, SearchBox, SortHeader, Th, fieldErrors, useListState } from '../../components/master';
import { Pagination } from '../../components/Pagination';
import { useToast } from '../../components/toast';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { usePaged, useRoleOptions } from '../../lib/queries';
import type { MasterEmployee, RoleOption } from '../../lib/types';

const FILTERS = ['role_id', 'status', 'account'] as const;

export function EmployeeMasterPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const state = useListState(FILTERS, 'full_name');
  const { params, update } = state;
  const list = usePaged<MasterEmployee>('employees', params);
  const roles = useRoleOptions();
  const [editing, setEditing] = useState<MasterEmployee | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MasterEmployee | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('employees')}
        subtitle={t('employee_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> {t('reload')}
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_employee')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <SearchBox state={state} placeholder={t('search_employee')} />
          <div className="grid gap-3 sm:grid-cols-3 lg:flex">
            <Select value={params.role_id} onChange={(e) => update({ role_id: e.target.value })} className="lg:w-44" aria-label={t('role')}>
              <option value="">{t('all_roles')}</option>
              {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Select value={params.account} onChange={(e) => update({ account: e.target.value })} className="lg:w-40" aria-label={t('account')}>
              <option value="">{t('account')}: {t('all')}</option>
              <option value="yes">{t('with_account')}</option>
              <option value="no">{t('without_account')}</option>
            </Select>
            <Select value={params.status} onChange={(e) => update({ status: e.target.value })} className="lg:w-36" aria-label={t('status')}>
              <option value="">{t('all_status')}</option>
              <option value="active">{t('active')}</option>
              <option value="inactive">{t('inactive')}</option>
            </Select>
          </div>
          {(params.search || params.role_id || params.account || params.status) && (
            <Button variant="ghost" onClick={state.reset}><X className="size-4" /> {t('reset')}</Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <Th>{t('no')}</Th>
                <Th><SortHeader field="employee_id" label="employee_id" state={state} /></Th>
                <Th><SortHeader field="full_name" label="full_name" state={state} /></Th>
                <Th><SortHeader field="role" label="role" state={state} /></Th>
                <Th><SortHeader field="username" label="user_account" state={state} /></Th>
                <Th>{t('phone')}</Th>
                <Th>{t('site')}</Th>
                <Th>{t('status')}</Th>
                <Th className="text-right">{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{(params.page - 1) * params.limit + i + 1}</td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{e.employee_id}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {e.full_name}
                    {e.email && <span className="block text-xs text-muted-foreground">{e.email}</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap"><Badge variant="default">{e.role_name}</Badge></td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {e.has_account ? (
                      <span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5 text-emerald-600" /> {e.username}</span>
                    ) : (
                      <span className="text-muted-foreground">{t('no_account')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{e.phone ?? '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{e.site}</td>
                  <td className="px-4 py-3"><ActiveBadge active={e.is_active} /></td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => setEditing(e)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} className="text-destructive" disabled={e.id === user?.id} onClick={() => setDeleting(e)}>
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

      {editing && <EmployeeForm employee={editing === 'new' ? null : editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
      <DeleteDialog path="employees" item={deleting && { id: deleting.id, label: `${deleting.employee_id} · ${deleting.full_name}` }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function EmployeeForm({ employee, roles, onClose }: { employee: MasterEmployee | null; roles: RoleOption[]; onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const isSelf = !!employee && employee.id === user?.id;
  const [form, setForm] = useState({
    employee_id: employee?.employee_id ?? '',
    full_name: employee?.full_name ?? '',
    role_id: employee ? String(employee.role_id) : '',
    company: employee?.company ?? user?.company ?? '',
    site: employee?.site ?? user?.site ?? '',
    phone: employee?.phone ?? '',
    email: employee?.email ?? '',
    is_active: employee ? !!employee.is_active : true,
    has_account: !!employee?.has_account,
    username: employee?.username ?? '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hadAccount = !!employee?.has_account;

  const save = useMutation({
    mutationFn: () => api<MasterEmployee>(employee ? `/employees/${employee.id}` : '/employees', { method: employee ? 'PUT' : 'POST', body: form }),
    onSuccess: (saved) => {
      toast('success', t('data_saved'), `${saved.employee_id} · ${saved.full_name}`);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err) ?? {});
      toast('error', (err as Error).message);
    },
  });

  const patch = (p: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...p }));
    setErrors((er) => ({ ...er, ...Object.fromEntries(Object.keys(p).map((k) => [k, ''])) }));
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => patch({ [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.employee_id.trim().length < 2) next.employee_id = 'Employee ID is required';
    if (form.full_name.trim().length < 2) next.full_name = 'Full name is required';
    if (!form.role_id) next.role_id = 'Role is required';
    if (form.has_account) {
      if (form.username.trim().length < 3) next.username = 'Username must be at least 3 characters';
      if (!hadAccount && !form.password) next.password = 'Password is required for a new user account';
      if (form.password && form.password.length < 8) next.password = 'Password must be at least 8 characters';
    }
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={employee ? `${t('edit_employee')} · ${employee.employee_id}` : t('add_employee')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="employee-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} className="space-y-6" noValidate>
        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase sm:col-span-2">{t('employment')}</h3>
          <Field label={t('employee_id')} required error={errors.employee_id}>
            <Input value={form.employee_id} onChange={set('employee_id')} placeholder="ITI-1005" maxLength={30} className="uppercase" invalid={!!errors.employee_id} autoFocus />
          </Field>
          <Field label={t('full_name')} required error={errors.full_name}>
            <Input value={form.full_name} onChange={set('full_name')} maxLength={100} invalid={!!errors.full_name} />
          </Field>
          <Field label={t('role')} required error={errors.role_id}>
            <Select value={form.role_id} onChange={set('role_id')} disabled={isSelf} invalid={!!errors.role_id}>
              <option value="">{t('select_role')}</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label={t('phone')} error={errors.phone}>
            <Input type="tel" value={form.phone} onChange={set('phone')} placeholder="0812 3456 7890" maxLength={20} invalid={!!errors.phone} />
          </Field>
          <Field label={t('email')} error={errors.email}>
            <Input type="email" value={form.email} onChange={set('email')} maxLength={100} invalid={!!errors.email} />
          </Field>
          <Field label={t('company')} error={errors.company}>
            <Input value={form.company} onChange={set('company')} maxLength={100} />
          </Field>
          <Field label={t('site')} error={errors.site} className="sm:col-span-2">
            <Input value={form.site} onChange={set('site')} maxLength={100} />
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={form.is_active} disabled={isSelf} onChange={(v) => patch({ is_active: v })} label={t('active')} description={t('employee_active_hint')} />
            {errors.is_active && <p className="mt-1 text-xs text-destructive">{errors.is_active}</p>}
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Switch
              checked={form.has_account}
              disabled={isSelf}
              onChange={(v) => patch({ has_account: v, username: v && !form.username ? suggestUsername(form.full_name) : form.username })}
              label={t('account_switch')}
              description={t('account_switch_hint')}
            />
            {errors.has_account && <p className="mt-1 text-xs text-destructive">{errors.has_account}</p>}
          </div>
          {form.has_account && (
            <>
              <Field label={t('username')} required error={errors.username}>
                <Input value={form.username} onChange={set('username')} autoComplete="off" maxLength={30} className="lowercase" invalid={!!errors.username} />
              </Field>
              <Field label={hadAccount ? t('new_password') : t('password')} required={!hadAccount} error={errors.password}>
                <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" invalid={!!errors.password} />
                {hadAccount && !errors.password && <span className="text-xs text-muted-foreground">{t('password_keep_hint')}</span>}
              </Field>
            </>
          )}
        </section>
      </form>
    </Modal>
  );
}

/** "Budi Santoso" -> "budi.santoso" */
const suggestUsername = (name: string) =>
  name.trim().toLowerCase().split(/\s+/).slice(0, 2).join('.').replace(/[^a-z0-9._]/g, '').slice(0, 30);
