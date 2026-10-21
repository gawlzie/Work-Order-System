import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MaintenanceTypeField, maintenanceErrors } from '../components/MaintenanceType';
import { MeterFields, meterErrors } from '../components/MeterFields';
import { SiteSelect } from '../components/SiteSelect';
import { UnitSite } from '../components/UnitSite';
import { useToast } from '../components/toast';
import { Button, Card, Field, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useEmployees, useUnits, useWorkOrder } from '../lib/queries';
import type { Employee, WorkOrderDetail } from '../lib/types';

const EMPTY = { site: '', unit_id: '', driver_id: '', mechanic_id: '', hm: '', km: '', maintenance_type: '', maintenance_other: '', problem: '' };
type Form = typeof EMPTY;

const sameSite = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
/** People at `site`; everyone when nobody is placed there (a site without its own drivers / mechanics). */
const atSite = (people: Employee[] | undefined, site: string) => {
  if (!people || !site) return people;
  const here = people.filter((p) => sameSite(p.site, site));
  return here.length ? here : people;
};

export function WorkOrderFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useWorkOrder(id);
  const units = useUnits();
  const drivers = useEmployees('driver');
  const mechanics = useEmployees('mechanic');
  const { can } = useAuth();
  // Admin Company picks the site of a new work order; everyone else raises it for their own site (set by the server).
  const pickSite = !isEdit && can('site.all');

  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const wo = existing.data;
    if (wo) {
      setForm({
        site: wo.site ?? '',
        unit_id: String(wo.unit_id),
        driver_id: String(wo.driver_id),
        mechanic_id: wo.mechanic_id ? String(wo.mechanic_id) : '',
        hm: wo.hm == null ? '' : String(wo.hm),
        km: wo.km == null ? '' : String(wo.km),
        maintenance_type: wo.maintenance_type ?? '',
        maintenance_other: wo.maintenance_other ?? '',
        problem: wo.problem,
      });
    }
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () =>
      api<WorkOrderDetail>(isEdit ? `/work-orders/${id}` : '/work-orders', { method: isEdit ? 'PUT' : 'POST', body: form }),
    onSuccess: (wo) => {
      toast('success', t('saved'), wo.approval_status === 'WAITING' ? `${wo.wo_number} · ${t('wo_created_waiting')}` : wo.wo_number);
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['work-order', wo.wo_uuid] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/transaction/work-order/details/${wo.wo_uuid}`, { replace: true });
    },
    onError: (err) => {
      setConfirm(false);
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast('error', (err as Error).message);
    },
  });

  // Picking a site narrows the lists to it and clears choices from another site.
  const unitOptions = pickSite && form.site ? units.data?.filter((u) => sameSite(u.site, form.site)) : units.data;
  const driverOptions = pickSite ? atSite(drivers.data, form.site) : drivers.data;
  const mechanicOptions = pickSite ? atSite(mechanics.data, form.site) : mechanics.data;
  const chooseSite = (site: string) => {
    setForm((f) => ({
      ...f,
      site,
      unit_id: units.data?.some((u) => String(u.id) === f.unit_id && sameSite(u.site, site)) ? f.unit_id : '',
      driver_id: atSite(drivers.data, site)?.some((d) => String(d.id) === f.driver_id) ? f.driver_id : '',
      mechanic_id: atSite(mechanics.data, site)?.some((m) => String(m.id) === f.mechanic_id) ? f.mechanic_id : '',
    }));
    setErrors((er) => ({ ...er, site: undefined, unit_id: undefined }));
  };

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (pickSite && !form.site) next.site = t('select_site');
    if (!form.unit_id) next.unit_id = 'Unit is required';
    if (!form.driver_id) next.driver_id = 'Driver is required';
    if (form.problem.trim().length < 5) next.problem = 'Problem description must be at least 5 characters';
    Object.assign(next, maintenanceErrors(form.maintenance_type, form.maintenance_other));
    Object.assign(next, meterErrors(form.hm, form.km, !isEdit, units.data?.find((u) => String(u.id) === form.unit_id), existing.data?.wo_number, lang));
    setErrors(next);
    if (!Object.keys(next).length) setConfirm(true);
  };

  // Keep the saved unit / driver / mechanic selectable when it has been deactivated since.
  const wo = existing.data;

  if (isEdit && existing.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => navigate(-1)}>
        <ArrowLeft className="size-4" /> {t('work_order')}
      </Button>
      <PageHeader title={isEdit ? `${t('update_wo')} · ${existing.data?.wo_number ?? ''}` : t('create_wo')} subtitle={t('form_subtitle')} />

      <Card className="p-4 sm:p-6">
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2" noValidate>
          <MaintenanceTypeField
            type={form.maintenance_type}
            other={form.maintenance_other}
            errors={errors}
            onChange={(field, value) => set(field)({ target: { value } })}
          />
          {pickSite && (
            <Field label={t('site')} required error={errors.site} className="sm:col-span-2">
              <SiteSelect value={form.site} invalid={!!errors.site} onChange={(s) => chooseSite(s.site_name)} />
            </Field>
          )}
          <Field label={`${t('unit')} (Dump Truck)`} required error={errors.unit_id}>
            <Select value={form.unit_id} onChange={set('unit_id')} invalid={!!errors.unit_id} disabled={pickSite && !form.site}>
              <option value="">{pickSite && !form.site ? t('select_site') : t('select_unit')}</option>
              {wo && units.data && !units.data.some((u) => u.id === wo.unit_id) && <option value={wo.unit_id}>{wo.unit_number} · {wo.unit_code}</option>}
              {unitOptions?.map((u) => (
                <option key={u.id} value={u.id}>{u.unit_number} · {u.unit_code} · {u.brand} {u.model}</option>
              ))}
            </Select>
            <UnitSite site={units.data?.find((u) => String(u.id) === form.unit_id)?.site ?? (wo && String(wo.unit_id) === form.unit_id ? wo.site : null)} />
          </Field>
          <Field label={t('driver')} required error={errors.driver_id}>
            <Select value={form.driver_id} onChange={set('driver_id')} invalid={!!errors.driver_id}>
              <option value="">{t('select_driver')}</option>
              {wo && drivers.data && !drivers.data.some((d) => d.id === wo.driver_id) && <option value={wo.driver_id}>{wo.driver_name}</option>}
              {driverOptions?.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.employee_id}){pickSite && form.site && !sameSite(d.site, form.site) ? ` · ${d.site ?? '-'}` : ''}</option>)}
            </Select>
          </Field>
          <Field label={t('pic_mechanic')} error={errors.mechanic_id}>
            <Select value={form.mechanic_id} onChange={set('mechanic_id')}>
              <option value="">{t('select_mechanic')}</option>
              {wo?.mechanic_id && mechanics.data && !mechanics.data.some((m) => m.id === wo.mechanic_id) && <option value={wo.mechanic_id}>{wo.mechanic_name}</option>}
              {mechanicOptions?.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_id}){pickSite && form.site && !sameSite(m.site, form.site) ? ` · ${m.site ?? '-'}` : ''}</option>)}
            </Select>
          </Field>
          <MeterFields
            hm={form.hm}
            km={form.km}
            errors={errors}
            unit={units.data?.find((u) => String(u.id) === form.unit_id)}
            currentWo={wo?.wo_number}
            required={!isEdit}
            onChange={(field, value) => set(field)({ target: { value } })}
          />
          <Field label={t('problem')} required error={errors.problem} className="sm:col-span-2">
            <Textarea value={form.problem} onChange={set('problem')} placeholder={t('problem_placeholder')} maxLength={1000} invalid={!!errors.problem} />
            <span className="self-end text-xs text-muted-foreground">{form.problem.length}/1000</span>
          </Field>
          <div className="flex flex-col-reverse gap-2 *:w-full sm:col-span-2 sm:flex-row sm:justify-end sm:*:w-auto">
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>{t('cancel')}</Button>
            <Button type="submit">{isEdit ? t('update') : t('submit')}</Button>
          </div>
        </form>
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('confirm_title')}
        description={t('confirm_submit')}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>{t('cancel')}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>{t('yes')}</Button>
          </>
        }
      />
    </div>
  );
}
