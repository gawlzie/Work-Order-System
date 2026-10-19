import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../components/toast';
import { Button, Card, Field, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useCategories, useEmployees, useUnits, useWorkOrder } from '../lib/queries';
import type { WorkOrderDetail } from '../lib/types';

const EMPTY = { unit_id: '', driver_id: '', mechanic_id: '', category_id: '', problem: '' };
type Form = typeof EMPTY;

export function WorkOrderFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useWorkOrder(id);
  const units = useUnits();
  const drivers = useEmployees('driver');
  const mechanics = useEmployees('mechanic');
  const categories = useCategories();

  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const wo = existing.data;
    if (wo) {
      setForm({
        unit_id: String(wo.unit_id),
        driver_id: String(wo.driver_id),
        mechanic_id: wo.mechanic_id ? String(wo.mechanic_id) : '',
        category_id: wo.category_id ? String(wo.category_id) : '',
        problem: wo.problem,
      });
    }
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () =>
      api<WorkOrderDetail>(isEdit ? `/work-orders/${id}` : '/work-orders', { method: isEdit ? 'PUT' : 'POST', body: form }),
    onSuccess: (wo) => {
      toast('success', t('saved'), wo.wo_number);
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

      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2" noValidate>
          <Field label={`${t('unit')} (Dump Truck)`} required error={errors.unit_id}>
            <Select value={form.unit_id} onChange={set('unit_id')} invalid={!!errors.unit_id}>
              <option value="">{t('select_unit')}</option>
              {wo && units.data && !units.data.some((u) => u.id === wo.unit_id) && <option value={wo.unit_id}>{wo.unit_number} · {wo.unit_code}</option>}
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>{u.unit_number} · {u.unit_code} · {u.brand} {u.model}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('driver')} required error={errors.driver_id}>
            <Select value={form.driver_id} onChange={set('driver_id')} invalid={!!errors.driver_id}>
              <option value="">{t('select_driver')}</option>
              {wo && drivers.data && !drivers.data.some((d) => d.id === wo.driver_id) && <option value={wo.driver_id}>{wo.driver_name}</option>}
              {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.employee_id})</option>)}
            </Select>
          </Field>
          <Field label={t('pic_mechanic')} error={errors.mechanic_id}>
            <Select value={form.mechanic_id} onChange={set('mechanic_id')}>
              <option value="">{t('select_mechanic')}</option>
              {wo?.mechanic_id && mechanics.data && !mechanics.data.some((m) => m.id === wo.mechanic_id) && <option value={wo.mechanic_id}>{wo.mechanic_name}</option>}
              {mechanics.data?.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_id})</option>)}
            </Select>
          </Field>
          <Field label={t('category')} error={errors.category_id}>
            <Select value={form.category_id} onChange={set('category_id')}>
              <option value="">{t('select_category')}</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('problem')} required error={errors.problem} className="sm:col-span-2">
            <Textarea value={form.problem} onChange={set('problem')} placeholder={t('problem_placeholder')} maxLength={1000} invalid={!!errors.problem} />
            <span className="self-end text-xs text-muted-foreground">{form.problem.length}/1000</span>
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
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
