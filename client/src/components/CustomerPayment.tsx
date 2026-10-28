import { useI18n, type TKey } from '../lib/i18n';
import type { CustomerType, PaymentType } from '../lib/types';
import { Field, Input, Select } from './ui';

/** Longest "Others" payment description the server accepts. */
export const PAYMENT_OTHER_MAX = 100;

/** Who the work is for and who pays for it (same lists as the server). */
export const CUSTOMER_TYPES: { value: CustomerType; key: TKey }[] = [
  { value: 'INTERNAL', key: 'ct_internal' },
  { value: 'EXTERNAL', key: 'ct_external' },
];
export const PAYMENT_TYPES: { value: PaymentType; key: TKey }[] = [
  { value: 'CUSTOMER_PAID', key: 'pay_customer_paid' },
  { value: 'FREE', key: 'pay_free' },
  { value: 'OTHERS', key: 'pay_others' },
];

/** e.g. "Internal"; '-' when not set (work orders from before it was asked). */
export function customerTypeLabel(type: CustomerType | null | undefined, t: (k: TKey) => string) {
  const found = CUSTOMER_TYPES.find((c) => c.value === type);
  return found ? t(found.key) : '-';
}

/** e.g. "Free" or "Others: Warranty claim to supplier"; '-' when not set. */
export function paymentLabel(type: PaymentType | null | undefined, other: string | null | undefined, t: (k: TKey) => string) {
  const found = PAYMENT_TYPES.find((p) => p.value === type);
  if (!found) return '-';
  return type === 'OTHERS' && other ? `${t(found.key)}: ${other}` : t(found.key);
}

type Errors = { customer_type?: string; payment_type?: string; payment_other?: string };

/** Client-side checks matching the server. */
export function customerPaymentErrors(customerType: string, paymentType: string, paymentOther: string) {
  const errors: Errors = {};
  if (!CUSTOMER_TYPES.some((c) => c.value === customerType)) errors.customer_type = 'Choose the customer type';
  if (!PAYMENT_TYPES.some((p) => p.value === paymentType)) errors.payment_type = 'Choose the payment';
  else if (paymentType === 'OTHERS' && paymentOther.trim().length < 2) errors.payment_other = 'Describe the payment for Others';
  if (paymentOther.trim().length > PAYMENT_OTHER_MAX) errors.payment_other = `Payment description is too long (max ${PAYMENT_OTHER_MAX} characters)`;
  return errors;
}

/** Customer Type and Payment dropdowns; Payment "Others" asks for a free description. */
export function CustomerPaymentFields({ customerType, paymentType, paymentOther, onChange, errors, inputClassName, otherClassName }: {
  customerType: string;
  paymentType: string;
  paymentOther: string;
  onChange: (field: 'customer_type' | 'payment_type' | 'payment_other', value: string) => void;
  errors: Errors;
  inputClassName?: string;
  /** Class of the Others description field, e.g. to span the form's columns. */
  otherClassName?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t('customer_type')} required error={errors.customer_type}>
        <Select value={customerType} onChange={(e) => onChange('customer_type', e.target.value)} invalid={!!errors.customer_type} className={inputClassName}>
          <option value="">{t('select_customer_type')}</option>
          {CUSTOMER_TYPES.map((c) => <option key={c.value} value={c.value}>{t(c.key)}</option>)}
        </Select>
      </Field>
      <Field label={t('payment')} required error={errors.payment_type}>
        <Select value={paymentType} onChange={(e) => onChange('payment_type', e.target.value)} invalid={!!errors.payment_type} className={inputClassName}>
          <option value="">{t('select_payment')}</option>
          {PAYMENT_TYPES.map((p) => <option key={p.value} value={p.value}>{t(p.key)}</option>)}
        </Select>
      </Field>
      {paymentType === 'OTHERS' && (
        <Field label={t('payment_other')} required error={errors.payment_other} className={otherClassName}>
          <Input
            value={paymentOther}
            onChange={(e) => onChange('payment_other', e.target.value)}
            placeholder={t('payment_other_placeholder')}
            maxLength={PAYMENT_OTHER_MAX}
            invalid={!!errors.payment_other}
            className={inputClassName}
          />
        </Field>
      )}
    </>
  );
}
