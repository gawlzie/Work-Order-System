import { useI18n, type TKey } from '../lib/i18n';
import type { MaintenanceType } from '../lib/types';
import { Field, Input, Select } from './ui';

/** Longest notes the server accepts. */
export const MAINTENANCE_NOTES_MAX = 200;

/** Types of maintenance a work order can be raised for (same list as the server); notes go with any of them. */
export const MAINTENANCE_TYPES: { value: MaintenanceType; key: TKey }[] = [
  { value: 'PREVENTIVE', key: 'mt_preventive' },
  { value: 'REPAIR', key: 'mt_repair' },
  { value: 'WARRANTY', key: 'mt_warranty' },
  { value: 'PDI', key: 'mt_pdi' },
  { value: 'OTHERS', key: 'mt_others' },
];

/** e.g. "Repair" or "Others"; '-' when not set. The notes are shown on their own. */
export function maintenanceLabel(type: MaintenanceType | null | undefined, t: (k: TKey) => string) {
  const found = MAINTENANCE_TYPES.find((m) => m.value === type);
  return found ? t(found.key) : '-';
}

/** Client-side checks matching the server. */
export function maintenanceErrors(type: string, other: string) {
  const errors: { maintenance_type?: string; maintenance_other?: string } = {};
  if (!MAINTENANCE_TYPES.some((m) => m.value === type)) errors.maintenance_type = 'Choose the type of maintenance';
  else if (type === 'OTHERS' && other.trim().length < 2) errors.maintenance_other = 'Notes are required for Others: describe the type of maintenance';
  if (other.trim().length > MAINTENANCE_NOTES_MAX) errors.maintenance_other = `Notes are too long (max ${MAINTENANCE_NOTES_MAX} characters)`;
  return errors;
}

/** Type of maintenance dropdown with its notes, shown for every type (required for Others, as its description). */
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
      <Field label={t('maintenance_notes')} required={type === 'OTHERS'} error={errors.maintenance_other}>
        <Input
          value={other}
          onChange={(e) => onChange('maintenance_other', e.target.value)}
          placeholder={type === 'OTHERS' ? t('mt_others_placeholder') : t('maintenance_notes_placeholder')}
          maxLength={MAINTENANCE_NOTES_MAX}
          invalid={!!errors.maintenance_other}
          className={inputClassName}
        />
      </Field>
    </>
  );
}
