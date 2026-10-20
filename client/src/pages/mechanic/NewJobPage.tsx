import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../../components/confirm';
import { MaintenanceTypeField, maintenanceErrors } from '../../components/MaintenanceType';
import { MeterFields, meterErrors } from '../../components/MeterFields';
import { UnitSite } from '../../components/UnitSite';
import { useToast } from '../../components/toast';
import { Button, Card, Field, Select, Textarea } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useOnline } from '../../lib/pwa';
import { useEmployees, useUnits } from '../../lib/queries';
import type { WorkOrderDetail } from '../../lib/types';

type Form = { unit_id: string; driver_id: string; mechanic_id: string; hm: string; km: string; maintenance_type: string; maintenance_other: string; problem: string };

/** Raise a work order from the field. Mechanics are set as PIC by default; the admin approves it on the web. */
export function NewJobPage() {
  const { t, lang } = useI18n();
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const online = useOnline();
  const units = useUnits();
  const drivers = useEmployees('driver');
  const mechanics = useEmployees('mechanic');
  const self = can('wo.as_mechanic') && user ? String(user.id) : '';

  const [form, setForm] = useState<Form>({ unit_id: '', driver_id: '', mechanic_id: self, hm: '', km: '', maintenance_type: '', maintenance_other: '', problem: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});

  const save = useMutation({
    mutationFn: () => api<WorkOrderDetail>('/work-orders', { method: 'POST', body: form }),
    onSuccess: (wo) => {
      toast('success', wo.wo_number, t('m_sent_for_approval'));
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/m/wo/${wo.wo_uuid}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast('error', (err as Error).message);
    },
  });

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.unit_id) next.unit_id = 'Unit is required';
    if (!form.driver_id) next.driver_id = 'Driver is required';
    if (form.problem.trim().length < 5) next.problem = 'Problem description must be at least 5 characters';
    Object.assign(next, maintenanceErrors(form.maintenance_type, form.maintenance_other));
    Object.assign(next, meterErrors(form.hm, form.km, true, units.data?.find((u) => String(u.id) === form.unit_id), undefined, lang));
    setErrors(next);
    if (!Object.keys(next).length) confirm({ message: t('confirm_submit_wo') }, () => save.mutate());
  };

  return (
    <div>
      <h1 className="text-xl font-semibold">{t('create_wo')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('form_subtitle')}</p>
      <Card className="p-4">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <MaintenanceTypeField
            type={form.maintenance_type}
            other={form.maintenance_other}
            errors={errors}
            inputClassName="h-12"
            onChange={(field, value) => set(field)({ target: { value } })}
          />
          <Field label={t('unit')} required error={errors.unit_id}>
            <Select value={form.unit_id} onChange={set('unit_id')} invalid={!!errors.unit_id} className="h-12">
              <option value="">{t('select_unit')}</option>
              {units.data?.map((u) => <option key={u.id} value={u.id}>{u.unit_number} · {u.unit_code}</option>)}
            </Select>
            <UnitSite site={units.data?.find((u) => String(u.id) === form.unit_id)?.site} />
          </Field>
          <Field label={t('driver')} required error={errors.driver_id}>
            <Select value={form.driver_id} onChange={set('driver_id')} invalid={!!errors.driver_id} className="h-12">
              <option value="">{t('select_driver')}</option>
              {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.employee_id})</option>)}
            </Select>
          </Field>
          <Field label={t('pic_mechanic')} error={errors.mechanic_id}>
            <Select value={form.mechanic_id} onChange={set('mechanic_id')} className="h-12">
              <option value="">{t('select_mechanic')}</option>
              {mechanics.data?.map((m) => (
                <option key={m.id} value={m.id}>{m.id === user?.id ? t('m_me', { name: m.full_name }) : `${m.full_name} (${m.employee_id})`}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <MeterFields
              hm={form.hm}
              km={form.km}
              errors={errors}
              unit={units.data?.find((u) => String(u.id) === form.unit_id)}
              inputClassName="h-12"
              onChange={(field, value) => set(field)({ target: { value } })}
            />
          </div>
          <Field label={t('problem')} required error={errors.problem}>
            <Textarea value={form.problem} onChange={set('problem')} placeholder={t('problem_placeholder')} maxLength={1000} invalid={!!errors.problem} />
            <span className="self-end text-xs text-muted-foreground">{form.problem.length}/1000</span>
          </Field>
          <Button type="submit" className="h-12 w-full text-base" loading={save.isPending} disabled={!online}>
            <Send className="size-5" /> {t('submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
