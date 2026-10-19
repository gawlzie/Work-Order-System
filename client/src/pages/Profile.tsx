import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '../components/toast';
import { Button, Card, Field, Input, Modal, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { useI18n } from '../lib/i18n';

export function ProfilePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } }),
    onSuccess: () => {
      toast('success', t('password_changed'));
      setOpen(false);
      setCurrent('');
      setNext('');
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  if (!user) return null;
  const rows = [
    [t('employee_id'), user.employee_id],
    [t('full_name'), user.full_name],
    [t('username'), user.username],
    [t('role'), user.role_name],
    [t('phone'), user.phone ?? '-'],
    [t('email'), user.email ?? '-'],
    [t('company'), user.company],
    [t('site'), user.site],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('profile')} subtitle={t('profile_subtitle')} />
      <Card className="p-6">
        <div className="flex flex-col items-center gap-4 border-b border-border pb-6 sm:flex-row">
          <span className="flex size-16 items-center justify-center rounded-full bg-sidebar-accent text-xl font-semibold text-white">{initials(user.full_name)}</span>
          <div className="text-center sm:text-left">
            <p className="text-lg font-semibold">{user.full_name}</p>
            <p className="text-sm text-muted-foreground">{user.role_name} · {user.company}</p>
          </div>
          <Button variant="outline" className="sm:ml-auto" onClick={() => setOpen(true)}>
            <KeyRound className="size-4" /> {t('change_password')}
          </Button>
        </div>
        <dl className="grid gap-4 pt-6 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('change_password')}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
            <Button form="pw-form" type="submit" loading={change.isPending} disabled={!current || next.length < 8}>{t('submit')}</Button>
          </>
        }
      >
        <form id="pw-form" className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); change.mutate(); }}>
          <Field label={t('current_password')} required>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label={t('new_password')} required error={next && next.length < 8 ? 'Min. 8 characters' : undefined}>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
