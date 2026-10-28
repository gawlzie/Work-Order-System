import { clsx } from 'clsx';
import { BrandMark } from '../../components/Brand';
import { ClipboardList, PlusCircle, User as UserIcon } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { NotificationBell } from '../../components/NotificationBell';
import { SyncBar } from '../../components/SyncBar';
import { useAuth } from '../../lib/auth';
import { initials } from '../../lib/format';
import { useI18n, type TKey } from '../../lib/i18n';
import { useCategories, useEmployees, useJobCodeOptions, useStepTemplate, useUnits } from '../../lib/queries';
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
  const tabs = TABS.filter((tab) => !tab.permission || can(tab.permission));
  // Lists the forms need, loaded while there is signal and kept on the phone for offline use.
  useUnits();
  useEmployees('driver');
  useEmployees('mechanic');
  useCategories();
  useJobCodeOptions();
  useStepTemplate();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2.5 px-4">
          <BrandMark className="size-8" />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold">WO ITI</p>
            <p className="truncate text-[11px] text-muted-foreground">{t('mechanic_app')}</p>
          </div>
          <span data-tour="bell" className="ml-auto inline-flex"><NotificationBell woLink={(id) => `/m/wo/${id}`} /></span>
          <NavLink to="/m/account" className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-white" aria-label={t('m_account')}>
            {initials(user?.full_name ?? '?')}
          </NavLink>
        </div>
        <SyncBar />
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
              data-tour={`m-nav-${tab.key.replace('m_', '')}`}
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
