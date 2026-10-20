import { useI18n, type TKey } from '../lib/i18n';
import type { MaintenanceType } from '../lib/types';
import { Field, Input, Select } from './ui';

/** Types of maintenance a work order can be raised for (same list as the server); Others has its own description. */
export const MAINTENANCE_TYPES: { value: MaintenanceType; key: TKey }[] = [
  { value: 'PREVENTIVE', key: 'mt_preventive' },
  { value: 'REPAIR', key: 'mt_repair' },
  { value: 'WARRANTY', key: 'mt_warranty' },
  { value: 'PDI', key: 'mt_pdi' },
  { value: 'OTHERS', key: 'mt_others' },
];

/** e.g. "Repair" or "Others: Modification"; '-' when not set. */
export function maintenanceLabel(type: MaintenanceType | null | undefined, other: string | null | undefined, t: (k: TKey) => string) {
  const found = MAINTENANCE_TYPES.find((m) => m.value === type);
  if (!found) return '-';
  return type === 'OTHERS' ? `${t(found.key)}: ${other ?? ''}` : t(found.key);
}

/** Client-side checks matching the server. */
export function maintenanceErrors(type: string, other: string) {
  const errors: { maintenance_type?: string; maintenance_other?: string } = {};
  if (!MAINTENANCE_TYPES.some((m) => m.value === type)) errors.maintenance_type = 'Choose the type of maintenance';
  else if (type === 'OTHERS' && (other.trim().length < 2 || other.trim().length > 60)) errors.maintenance_other = 'Describe the type of maintenance (2-60 characters)';
  return errors;
}

/** Type of maintenance dropdown; choosing Others shows a free text field for it. */
export function MaintenanceTypeField({ type, other, onChange, errors, inputClassName }: {
  type: string;
  other: string;
  onChange: (field: 'maintenance_type' | 'maintenance_other', value: string) => void;
  errors: { maintenance_type?: string; maintenance_other?: string };
  inputClassName?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t('maintenance_type')} required error={errors.maintenance_type}>
        <Select value={type} onChange={(e) => onChange('maintenance_type', e.target.value)} invalid={!!errors.maintenance_type} className={inputClassName}>
          <option value="">{t('select_maintenance')}</option>
          {MAINTENANCE_TYPES.map((m) => <option key={m.value} value={m.value}>{t(m.key)}</option>)}
        </Select>
      </Field>
      {type === 'OTHERS' && (
        <Field label={t('mt_others_label')} required error={errors.maintenance_other}>
          <Input value={other} onChange={(e) => onChange('maintenance_other', e.target.value)} placeholder={t('mt_others_placeholder')} maxLength={60} invalid={!!errors.maintenance_other} className={inputClassName} autoFocus />
        </Field>
      )}
    </>
  );
}
