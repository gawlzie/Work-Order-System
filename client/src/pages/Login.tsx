import { Eye, EyeOff, Wrench } from 'lucide-react';
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
      <div className="relative hidden overflow-hidden bg-[#030712] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 size-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary">
            <Wrench className="size-5" />
          </div>
          <span className="font-semibold">Inline Technology International</span>
        </div>
        <div className="relative">
          <h1 className="text-4xl leading-tight font-semibold">{t('app_name')}</h1>
          <p className="mt-4 max-w-md text-white/70">
            We integrate innovation and reliability to empower your business with cutting-edge technology.
          </p>
        </div>
        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} Inline Technology International</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div className="lg:hidden">
            <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-primary text-white">
              <Wrench className="size-5" />
            </div>
          </div>
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
      </div>
    </div>
  );
}
