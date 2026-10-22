import { Eye, EyeOff } from 'lucide-react';
import benefits from '../assets/brand/login-benefits.webp';
import { BrandLogo } from '../components/Brand';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';

const DEMO = [
  ['admincompany', 'Admin Company (all sites)'],
  ['admin', 'Admin Site (BIB)'],
  ['budi', 'Mechanic'],
  ['joko', 'Driver (view only)'],
];

export function LoginPage() {
  const { t } = useI18n();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* "WOS Benefits at a Glance" shown whole (it is full of text); a blurred copy fills the rest on other screen shapes. */}
      <div className="relative hidden overflow-hidden bg-[#e8f0fb] lg:sticky lg:top-0 lg:block lg:h-screen">
        <img src={benefits} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl" />
        <img src={benefits} alt={t('login_image_alt')} className="relative size-full object-contain" />
      </div>

      <div className="flex flex-col items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <BrandLogo className="mb-4 h-11" />
          <div>
            <h2 className="text-2xl font-semibold">{t('login_title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('login_subtitle')}</p>
          </div>
          <Field label={t('username')} required>
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label={t('password')} required>
            <div className="relative">
              <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted-foreground" aria-label="Toggle password visibility">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" loading={busy}>
            {t('sign_in')}
          </Button>
          <div className="rounded-lg border border-dashed border-border p-3 text-xs">
            <p className="mb-2 font-medium text-muted-foreground">{t('demo_accounts')}</p>
            <div className="flex flex-wrap gap-2">
              {DEMO.map(([u, label]) => (
                <button key={u} type="button" onClick={() => { setUsername(u); setPassword('password123'); }} className="rounded-md bg-muted px-2 py-1 hover:bg-border">
                  <span className="font-medium">{u}</span> · {label}
                </button>
              ))}
            </div>
          </div>
        </form>
        <p className="mt-8 text-xs text-muted-foreground">© {new Date().getFullYear()} Inline Technology International</p>
      </div>
    </div>
  );
}
