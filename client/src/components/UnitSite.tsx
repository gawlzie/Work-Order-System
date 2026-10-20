import { MapPin } from 'lucide-react';
import { useI18n } from '../lib/i18n';

/** Under the unit picker of a new work order: the WO is raised at the unit's site. */
export function UnitSite({ site }: { site: string | null | undefined }) {
  const { t } = useI18n();
  if (!site) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <MapPin className="size-3" /> {t('wo_site_from_unit', { site })}
    </span>
  );
}
