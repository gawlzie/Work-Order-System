import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import { useI18n } from '../lib/i18n';

export function NotFoundPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">404</span>
      <h1 className="mt-4 text-3xl font-semibold">{t('notfound_title')}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">{t('notfound_desc')}</p>
      <Button className="mt-6" onClick={() => navigate('/dashboard/work-order')}>{t('back_home')}</Button>
    </div>
  );
}
