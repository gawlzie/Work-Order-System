import { clsx } from 'clsx';
import { CheckCircle2, ChevronRight, CircleHelp, Compass, Download, ExternalLink, KeyRound, LogOut, Monitor, Share } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConfirm } from '../../components/confirm';
import { Button, Card, Switch } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { initials } from '../../lib/format';
import { USER_GUIDE_URLS } from '../../lib/help';
import { MECHANIC_TOURS, useTourControls } from '../../lib/tour';
import { useI18n } from '../../lib/i18n';
import { useInstallPrompt } from '../../lib/pwa';
import { useTheme } from '../../lib/theme';

/** Install button for the mechanic web app, or the manual hint where the browser has no install prompt (iOS, Firefox). */
export function InstallAppButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const { canInstall, isInstalled, isIos, install } = useInstallPrompt();
  if (isInstalled) {
    return (
      <p className={clsx('inline-flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400', className)}>
        <CheckCircle2 className="size-4" /> {t('app_installed')}
      </p>
    );
  }
  if (canInstall) {
    return (
      <Button variant="outline" className={className} onClick={install}>
        <Download className="size-4" /> {t('install_app')}
      </Button>
    );
  }
  return (
    <p className={clsx('flex items-start gap-2 text-xs text-muted-foreground', className)}>
      <Share className="mt-0.5 size-4 shrink-0" /> {isIos ? t('install_ios_hint') : t('install_hint')}
    </p>
  );
}

function Row({ icon, children, to }: { icon: ReactNode; children: ReactNode; to: string }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 text-sm hover:bg-muted">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{children}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

export function AccountPage() {
  const { t, lang, setLang } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useTheme();
  const confirm = useConfirm();
  const { reset } = useTourControls();
  if (!user) return null;

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-4 p-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-lg font-semibold text-white">
          {initials(user.full_name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{user.full_name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.role_name} · {user.employee_id}</p>
          <p className="truncate text-xs text-muted-foreground">{user.company}{user.site ? ` · ${user.site}` : ''}</p>
        </div>
      </Card>

      <Card className="divide-y divide-border">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4">
          <span className="text-sm">{t('m_language')}</span>
          <div className="flex rounded-lg border border-border p-0.5 text-xs font-medium">
            {(['en', 'id'] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={clsx('rounded-md px-3 py-1.5 uppercase', lang === l ? 'bg-primary text-white' : 'text-muted-foreground')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <a href={USER_GUIDE_URLS[lang]} target="_blank" rel="noopener noreferrer" title={t('user_guide_hint')} className="flex min-h-14 items-center gap-3 px-4 text-sm hover:bg-muted">
          <CircleHelp className="size-5 text-muted-foreground" />
          <span className="flex-1">{t('user_guide')}</span>
          <ExternalLink className="size-4 text-muted-foreground" />
        </a>
        <button onClick={() => { reset(MECHANIC_TOURS); navigate('/m'); }} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm hover:bg-muted">
          <Compass className="size-5 text-muted-foreground" />
          <span className="flex-1">{t('tour_take')}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <div className="flex min-h-14 items-center px-4">
          <Switch checked={dark} onChange={setDark} label={t('m_dark_mode')} />
        </div>
        <div className="space-y-2 px-4 py-3">
          <p className="text-sm">{t('mechanic_app')}</p>
          <InstallAppButton className="w-full" />
        </div>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <Row to="/profile" icon={<KeyRound className="size-5" />}>{t('change_password')}</Row>
        <Row to="/transaction/work-order" icon={<Monitor className="size-5" />}>{t('m_full_web')}</Row>
      </Card>

      <Button variant="outline" className="h-12 w-full text-destructive" onClick={() => confirm({ message: t('confirm_logout'), tone: 'destructive', confirmLabel: t('logout') }, () => { logout(); navigate('/login', { state: { from: '/m' } }); })}>
        <LogOut className="size-4" /> {t('logout')}
      </Button>
    </div>
  );
}
