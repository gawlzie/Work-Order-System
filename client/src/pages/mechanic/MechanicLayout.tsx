import { clsx } from 'clsx';
import { ClipboardList, PlusCircle, User as UserIcon, WifiOff, Wrench } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { NotificationBell } from '../../components/NotificationBell';
import { useAuth } from '../../lib/auth';
import { initials } from '../../lib/format';
import { useI18n, type TKey } from '../../lib/i18n';
import { useOnline } from '../../lib/pwa';
import type { Permission } from '../../lib/types';

const TABS: { to: string; key: TKey; icon: typeof ClipboardList; end?: boolean; permission?: Permission }[] = [
  { to: '/m', key: 'm_jobs', icon: ClipboardList, end: true },
  { to: '/m/new', key: 'm_new', icon: PlusCircle, permission: 'wo.create' },
  { to: '/m/account', key: 'm_account', icon: UserIcon },
];

/**
 * App shell of the mechanic web app: a phone-first layout with a bottom tab bar instead of the admin sidebar.
 * On tablets and PCs the content stays in a centred column so it reads like the Android app.
 */
export function MechanicLayout() {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const online = useOnline();
  const tabs = TABS.filter((tab) => !tab.permission || can(tab.permission));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2.5 px-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-white">
            <Wrench className="size-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold">WO ITI</p>
            <p className="truncate text-[11px] text-muted-foreground">{t('mechanic_app')}</p>
          </div>
          <NotificationBell woLink={(id) => `/m/wo/${id}`} className="ml-auto" />
          <NavLink to="/m/account" className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-white" aria-label={t('m_account')}>
            {initials(user?.full_name ?? '?')}
          </NavLink>
        </div>
        {!online && (
          <p className="flex items-center justify-center gap-2 bg-orange-500 px-4 py-1.5 text-center text-xs font-medium text-white" role="status">
            <WifiOff className="size-3.5 shrink-0" /> {t('m_offline')}
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                clsx('flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition', isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
              }
            >
              <tab.icon className="size-6" />
              {t(tab.key)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
