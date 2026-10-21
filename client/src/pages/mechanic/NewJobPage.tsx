import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../../components/confirm';
import { MaintenanceTypeField, maintenanceErrors } from '../../components/MaintenanceType';
import { MeterFields, meterErrors } from '../../components/MeterFields';
import { UnitSite } from '../../components/UnitSite';
import { useToast } from '../../components/toast';
import { Button, Card, Field, Select, Textarea } from '../../components/ui';
import { useAct } from '../../lib/act';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { newId } from '../../lib/offline';
import { useEmployees, useStepTemplate, useUnits } from '../../lib/queries';

type Form = { unit_id: string; driver_id: string; mechanic_id: string; hm: string; km: string; maintenance_type: string; maintenance_other: string; problem: string };

/** Raise a work order from the field. Mechanics are set as PIC by default; the admin approves it on the web. */
export function NewJobPage() {
  const { t, lang } = useI18n();
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const act = useAct();
  const template = useStepTemplate();
  const units = useUnits();
  const drivers = useEmployees('driver');
  const mechanics = useEmployees('mechanic');
  const self = can('wo.as_mechanic') && user ? String(user.id) : '';

  const [form, setForm] = useState<Form>({ unit_id: '', driver_id: '', mechanic_id: self, hm: '', km: '', maintenance_type: '', maintenance_other: '', problem: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});

  /**
   * Stored in the outbox and sent when there is signal; until then the job screen is built from the form, the
   * units / drivers / mechanics and the steps kept on the phone. The server gives the WO number on sync.
   */
  const create = () => {
    if (!template.data?.length || !user) return toast('error', t('m_need_online_once'));
    const unit = units.data?.find((u) => String(u.id) === form.unit_id);
    const driver = drivers.data?.find((d) => String(d.id) === form.driver_id);
    const mechanic = mechanics.data?.find((m) => String(m.id) === form.mechanic_id);
    const wo_uuid = newId();
    const now = new Date().toISOString();
    const steps = template.data.map((s, i) => ({
      id: -(i + 1), parent_id: null, step_no: i + 1, step_name: s.name, is_waiting: s.waiting ? 1 : 0, is_additional: 0, allow_add_sub: s.addSub ? 1 : 0,
      pic_name: null, started_at: null, finished_at: null, remarks: null, sub_steps: [],
    }));
    const view = {
      wo_uuid, wo_number: t('m_new_offline'), unit_id: Number(form.unit_id), unit_number: unit?.unit_number ?? '', unit_code: unit?.unit_code ?? '', unit_type: unit?.unit_type ?? '',
      unit_brand: unit?.brand ?? null, unit_model: unit?.model ?? null, unit_serial: unit?.serial_number ?? null, site: unit?.site ?? null, site_company: null,
      driver_id: Number(form.driver_id), driver_name: driver?.full_name ?? '', mechanic_id: form.mechanic_id ? Number(form.mechanic_id) : null, mechanic_name: mechanic?.full_name ?? null,
      problem: form.problem.trim(), maintenance_type: form.maintenance_type, maintenance_other: form.maintenance_type === 'OTHERS' ? form.maintenance_other.trim() : null,
      hm: Number(form.hm.replace(',', '.')), km: Number(form.km), status: 'OPEN', approval_status: 'WAITING', reject_reason: null, approval_remarks: null, channel_source: 'MOBILE',
      created_by: user.id, created_by_name: user.full_name, created_at: now, updated_at: now, started_at: null, finished_at: null, category_id: null, category: null,
      job_code_list: null, part_list: null, job_standard_duration: null, repair_time: null, step_information: 'Not started', total_time: 0, proof_count: 0, mobile_sync_time: null,
      steps, additional_work: [], job_codes: [], proofs: [],
    };
    act({ type: 'wo.create', wo_uuid, label: t('op_wo_create', { unit: unit?.unit_number ?? '' }), body: { ...form }, view });
    toast('success', t('data_saved'), navigator.onLine ? t('m_sent_for_approval') : t('m_saved_offline'));
    navigate(`/m/wo/${wo_uuid}`, { replace: true });
  };

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
    if (!Object.keys(next).length) confirm({ message: t('confirm_submit_wo') }, create);
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
          <Button type="submit" className="h-12 w-full text-base">
            <Send className="size-5" /> {t('submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
