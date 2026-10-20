import { useI18n } from '../lib/i18n';
import type { Unit } from '../lib/types';
import { Field, Input } from './ui';

/** Hour meter / odometer value in the user's language, e.g. 12,450.5 (EN) or 12.450,5 (ID). */
export function formatMeter(value: number | null | undefined, lang: string) {
  if (value == null) return '-';
  return new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-GB', { maximumFractionDigits: 1 }).format(value);
}

/** Client-side checks matching the server: HM ≥ 0 with one decimal, KM a whole number ≥ 0. */
/** `required`: new WOs must have both readings; on edit empty keeps the stored value. */
export function meterErrors(hm: string, km: string, required = true) {
  const errors: { hm?: string; km?: string } = {};
  const h = Number(hm);
  const k = Number(km);
  if (hm.trim() === '') { if (required) errors.hm = 'HM is required'; }
  else if (!Number.isFinite(h) || h < 0 || h > 999999.9) errors.hm = 'HM must be a number from 0 to 999,999.9';
  if (km.trim() === '') { if (required) errors.km = 'KM is required'; }
  else if (!Number.isInteger(k) || k < 0 || k > 9999999) errors.km = 'KM must be a whole number from 0 to 9,999,999';
  return errors;
}

/**
 * HM (hour meter) and KM (odometer) inputs for a work order. Under each field the unit's last recorded value is shown,
 * so a typo (e.g. a missing digit) is easy to spot.
 */
export function MeterFields({ hm, km, onChange, errors, unit, currentWo, inputClassName, required = true }: {
  hm: string;
  km: string;
  onChange: (field: 'hm' | 'km', value: string) => void;
  errors: { hm?: string; km?: string };
  unit?: Unit | null;
  /** WO being edited: its own reading is not shown as "last recorded". */
  currentWo?: string;
  inputClassName?: string;
  required?: boolean;
}) {
  const { t, lang } = useI18n();
  const hint = (value: number | null | undefined, wo: string | null | undefined) =>
    !unit ? null : value != null && wo !== currentWo ? t('meter_last', { v: formatMeter(value, lang), wo: wo ?? '-' }) : t('meter_none');
  return (
    <>
      <Field label={t('hm')} required={required} error={errors.hm}>
        <Input type="number" inputMode="decimal" min={0} max={999999.9} step={0.1} value={hm} onChange={(e) => onChange('hm', e.target.value)} invalid={!!errors.hm} className={inputClassName} placeholder="0" />
        {!errors.hm && hint(unit?.last_hm, unit?.last_hm_wo) && <span className="text-xs text-muted-foreground">{hint(unit?.last_hm, unit?.last_hm_wo)}</span>}
      </Field>
      <Field label={t('km')} required={required} error={errors.km}>
        <Input type="number" inputMode="numeric" min={0} max={9999999} step={1} value={km} onChange={(e) => onChange('km', e.target.value)} invalid={!!errors.km} className={inputClassName} placeholder="0" />
        {!errors.km && hint(unit?.last_km, unit?.last_km_wo) && <span className="text-xs text-muted-foreground">{hint(unit?.last_km, unit?.last_km_wo)}</span>}
      </Field>
    </>
  );
}
