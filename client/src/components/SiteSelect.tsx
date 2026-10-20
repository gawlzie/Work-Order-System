import { useI18n } from '../lib/i18n';
import { useSites } from '../lib/queries';
import type { SiteOption } from '../lib/types';
import { Select } from './ui';

/** Active sites from the site master; a record's current (inactive or renamed) site stays selectable. */
export function SiteSelect({ value, invalid, onChange, className }: { value: string; invalid?: boolean; onChange: (site: SiteOption) => void; className?: string }) {
  const { t } = useI18n();
  const sites = useSites(true);
  const options = (sites.data ?? []).filter((s) => s.is_active || s.site_name === value);
  return (
    <Select
      value={options.some((s) => s.site_name === value) ? value : ''}
      onChange={(e) => {
        const site = options.find((s) => s.site_name === e.target.value);
        if (site) onChange(site);
      }}
      invalid={invalid}
      className={className}
    >
      <option value="" disabled>{value && !options.some((s) => s.site_name === value) ? `${value} (${t('site_not_in_master')})` : t('select_site')}</option>
      {options.map((s) => <option key={s.id} value={s.site_name}>{s.site_name}{s.is_active ? '' : ` (${t('inactive')})`}</option>)}
    </Select>
  );
}

/** Site filter for lists: all sites, including inactive ones. */
export function SiteFilter({ value, onChange, className }: { value: string; onChange: (site: string) => void; className?: string }) {
  const { t } = useI18n();
  const sites = useSites(true);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label={t('site')}>
      <option value="">{t('all_sites')}</option>
      {value && !sites.data?.some((s) => s.site_name === value) && <option value={value}>{value}</option>}
      {sites.data?.map((s) => <option key={s.id} value={s.site_name}>{s.site_name}</option>)}
    </Select>
  );
}
