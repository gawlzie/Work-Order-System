import { clsx } from 'clsx';
import { ClipboardList, LayoutDashboard, ListOrdered, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, ShieldCheck, Smartphone, Sun, Tags, Truck, User as UserIcon, Users, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { useI18n, type TKey } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import type { Permission } from '../lib/types';
import { useBodyLock } from './ui';

const NAV: { to: string; key: TKey; icon: typeof LayoutDashboard; group?: TKey; permission?: Permission }[] = [
  { to: '/dashboard/work-order', key: 'dashboard', icon: LayoutDashboard },
  { to: '/transaction/work-order', key: 'work_order', icon: ClipboardList, group: 'transaction' },
  { to: '/master/unit', key: 'units', icon: Truck, group: 'master_data', permission: 'master.unit' },
  { to: '/master/employee', key: 'employees', icon: Users, group: 'master_data', permission: 'master.employee' },
  { to: '/master/role', key: 'roles', icon: ShieldCheck, group: 'master_data', permission: 'master.role' },
  { to: '/master/step', key: 'repair_steps', icon: ListOrdered, group: 'master_data', permission: 'master.step' },
  { to: '/master/category', key: 'repair_categories', icon: Tags, group: 'master_data', permission: 'master.category' },
  { to: '/app/work-order', key: 'application', icon: Smartphone },
  { to: '/m', key: 'mechanic_app', icon: Wrench, permission: 'wo.progress' },
];


export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { user, logout, can } = useAuth();
  const nav = NAV.filter((item) => !item.permission || can(item.permission));
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);
  useBodyLock(mobileOpen);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <div className={clsx('mb-4 flex h-12 shrink-0 items-center gap-2.5 px-2', collapsed && 'lg:justify-center lg:px-0')}>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
          <Wrench className="size-5" />
        </div>
        <div className={clsx('leading-tight', collapsed && 'lg:hidden')}>
          <p className="text-sm font-semibold">WO ITI</p>
          <p className="text-[11px] text-muted-foreground">{t('app_name')}</p>
        </div>
        <button className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X className="size-5" />
        </button>
      </div>
      {nav.map((item, i) => (
        <div key={item.to}>
          {item.group && nav[i - 1]?.group !== item.group && (
            <p className={clsx('mt-3 mb-1 px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase', collapsed && 'lg:hidden')}>
              {t(item.group)}
            </p>
          )}
          <NavLink
            to={item.to}
            title={t(item.key)}
            className={({ isActive }) =>
              clsx(
                'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition',
                collapsed && 'lg:justify-center lg:px-0',
                isActive ? 'bg-sidebar-accent text-white shadow-sm' : 'text-foreground/80 hover:bg-muted',
              )
            }
          >
            <item.icon className="size-[18px] shrink-0" />
            <span className={clsx(collapsed && 'lg:hidden')}>{t(item.key)}</span>
          </NavLink>
        </div>
      ))}
      <div className={clsx('mt-auto px-3 pt-4 pb-[env(safe-area-inset-bottom)] text-[11px] text-muted-foreground', collapsed && 'lg:hidden')}>
        © {new Date().getFullYear()} Inline Technology International
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={clsx('no-print sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-sidebar transition-all lg:block', collapsed ? 'w-[72px]' : 'w-64')}>
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)} role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 animate-fade-in bg-black/50" />
          <aside className="relative h-dvh w-72 max-w-[85vw] animate-slide-in bg-sidebar shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card/90 px-3 backdrop-blur sm:h-16 sm:px-6">
          <button className="rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <button className="hidden rounded-md p-2 hover:bg-muted lg:block" onClick={() => setCollapsed((c) => !c)} title="Toggle Sidebar" aria-label="Toggle sidebar">
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
          <NavLink to="/" className="flex items-center gap-2 lg:hidden">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-white">
              <Wrench className="size-4" />
            </span>
            <span className="text-sm font-semibold max-[359px]:hidden">WO ITI</span>
          </NavLink>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-lg border border-border p-0.5 text-xs font-medium">
              {(['en', 'id'] as const).map((l) => (
                <button key={l} onClick={() => setLang(l)} className={clsx('rounded-md px-2 py-1 uppercase', lang === l ? 'bg-primary text-white' : 'text-muted-foreground')}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => setDark(!dark)} className="rounded-md p-2 hover:bg-muted" aria-label="Toggle theme">
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-muted">
                <span className="flex size-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-white">
                  {initials(user?.full_name ?? '?')}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm font-medium">{user?.full_name}</span>
                  <span className="block text-[11px] text-muted-foreground">{user?.role_name}</span>
                </span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 animate-fade-in rounded-lg border border-border bg-card p-1 shadow-lg">
                  <div className="border-b border-border px-3 py-2 sm:hidden">
                    <p className="truncate text-sm font-medium">{user?.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{user?.role_name}</p>
                  </div>
                  <button onClick={() => { setMenuOpen(false); navigate('/profile'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted">
                    <UserIcon className="size-4" /> {t('profile')}
                  </button>
                  <button onClick={() => { logout(); navigate('/login'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-muted">
                    <LogOut className="size-4" /> {t('logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
