import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Info, Pencil, Plus, RefreshCcw, Search, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DeleteDialog, fieldErrors } from '../../components/master';
import { useToast } from '../../components/toast';
import { Badge, BtnLabel, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Skeleton, Switch, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import type { StepTemplate } from '../../lib/types';

const useSteps = () => useQuery({ queryKey: ['steps'], queryFn: () => api<StepTemplate[]>('/steps') });

export function StepMasterPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useSteps();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StepTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StepTemplate | null>(null);

  const move = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: 'up' | 'down' }) => api<StepTemplate[]>(`/steps/${id}/move`, { method: 'POST', body: { direction } }),
    onSuccess: (steps) => qc.setQueryData(['steps'], steps),
    onError: (err) => toast('error', (err as Error).message),
  });

  const all = list.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = term ? all.filter((s) => s.name.toLowerCase().includes(term) || s.sub_steps.some((c) => c.name.toLowerCase().includes(term))) : all;
  // Run order is only meaningful on the full list, so reordering is off while searching.
  const canMove = !term && !move.isPending;
  const activeCount = all.filter((s) => s.is_active).length;
  // Position each active step gets on a new work order.
  const runNo = new Map(all.filter((s) => s.is_active).map((s, i) => [s.id, i + 1]));

  return (
    <div>
      <PageHeader
        title={t('repair_steps')}
        subtitle={t('step_subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} title={t('reload')}>
              <RefreshCcw className={clsx('size-4', list.isFetching && 'animate-spin')} /> <BtnLabel>{t('reload')}</BtnLabel>
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> {t('add_step')}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm sm:p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p>{t('step_apply_hint')}</p>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search_step')} className="pl-9" />
          </div>
          {search && <Button variant="ghost" onClick={() => setSearch('')}><X className="size-4" /> {t('reset')}</Button>}
          {list.data && <span className="text-sm whitespace-nowrap text-muted-foreground">{t('steps_active', { n: activeCount })}</span>}
        </div>

        <ol className="divide-y divide-border">
          {rows.map((s) => {
            const index = all.indexOf(s);
            return (
              <li key={s.id} className={clsx('flex flex-col gap-3 p-4 sm:flex-row sm:items-start', !s.is_active && 'bg-muted/40')}>
                <div className="flex min-w-0 flex-1 gap-3">
                  <span
                    className={clsx(
                      'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                      s.is_active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                    title={s.is_active ? undefined : t('step_active_hint')}
                  >
                    {runNo.get(s.id) ?? '–'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={clsx('font-medium break-words', !s.is_active && 'text-muted-foreground')}>{s.name}</p>
                      {!!s.is_waiting && <Badge variant="orange">{t('waiting_step')}</Badge>}
                      {!!s.allow_add_sub && <Badge variant="default">{t('allow_add_sub_badge')}</Badge>}
                      {!s.is_active && <Badge variant="gray">{t('inactive')}</Badge>}
                    </div>
                    {s.description && <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>}
                    {s.sub_steps.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {s.sub_steps.map((c, i) => (
                          <li key={c.id} className="rounded-md border border-border bg-card px-2 py-0.5 text-xs">
                            <span className="text-muted-foreground tabular-nums">{runNo.has(s.id) ? `${runNo.get(s.id)}.${i + 1}` : i + 1}</span> {c.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="-mr-2 flex shrink-0 justify-end gap-1 max-sm:-mt-1">
                  <Button size="icon" variant="ghost" title={t('move_up')} aria-label={t('move_up')} disabled={!canMove || index === 0} onClick={() => move.mutate({ id: s.id, direction: 'up' })}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title={t('move_down')} aria-label={t('move_down')} disabled={!canMove || index === all.length - 1} onClick={() => move.mutate({ id: s.id, direction: 'down' })}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title={t('edit')} aria-label={t('edit')} onClick={() => setEditing(s)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title={t('delete')} aria-label={t('delete')} className="text-destructive" disabled={!!s.is_active && activeCount === 1} onClick={() => setDeleting(s)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        {list.isLoading && <div className="space-y-2 p-4">{[1, 2, 3].map((n) => <Skeleton key={n} className="h-14" />)}</div>}
        {list.isError && <EmptyState title={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>{t('reload')}</Button>} />}
        {list.data && !rows.length && <EmptyState title={t('no_data')} />}
      </Card>

      {editing && <StepForm step={editing === 'new' ? null : editing} lastActive={editing !== 'new' && !!editing.is_active && activeCount === 1} onClose={() => setEditing(null)} />}
      <DeleteDialog path="steps" hint="step_delete_hint" item={deleting && { id: deleting.id, label: deleting.name }} onClose={() => setDeleting(null)} />
    </div>
  );
}

function StepForm({ step, lastActive, onClose }: { step: StepTemplate | null; lastActive: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: step?.name ?? '',
    description: step?.description ?? '',
    is_waiting: !!step?.is_waiting,
    allow_add_sub: !!step?.allow_add_sub,
    is_active: step ? !!step.is_active : true,
  });
  // Local keys keep inputs stable while sub-steps are added, removed and reordered.
  const [subs, setSubs] = useState(() => (step?.sub_steps ?? []).map((c) => ({ key: `s${c.id}`, name: c.name })));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      api<StepTemplate>(step ? `/steps/${step.id}` : '/steps', {
        method: step ? 'PUT' : 'POST',
        body: { ...form, sub_steps: subs.map((c) => c.name.trim()).filter(Boolean) },
      }),
    onSuccess: (saved) => {
      toast('success', t('data_saved'), saved.name);
      qc.invalidateQueries({ queryKey: ['steps'] });
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err) ?? {});
      toast('error', (err as Error).message);
    },
  });

  const setSub = (i: number, name: string) => {
    setSubs((list) => list.map((c, j) => (j === i ? { ...c, name } : c)));
    setErrors((er) => ({ ...er, sub_steps: '' }));
  };
  const moveSub = (i: number, by: -1 | 1) =>
    setSubs((list) => {
      const next = [...list];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Step name must be 2-60 characters';
    const names = subs.map((c) => c.name.trim()).filter(Boolean);
    if (names.some((n) => n.length < 2)) next.sub_steps = 'Each sub-step must be 2-60 characters';
    else if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) next.sub_steps = 'Sub-step names must be unique';
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={step ? `${t('edit_step')} · ${step.name}` : t('add_step')}
      description={t('step_apply_hint')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form="step-form" loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <form id="step-form" onSubmit={submit} className="space-y-5" noValidate>
        <Field label={t('step_name')} required error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
              setErrors((er) => ({ ...er, name: '' }));
            }}
            maxLength={60}
            invalid={!!errors.name}
            autoFocus={!step}
          />
        </Field>
        <Field label={t('description')} error={errors.description}>
          <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={200} className="min-h-16" />
        </Field>

        <div>
          <p className="text-sm font-medium">{t('sub_steps')}</p>
          <p className="mb-2 text-xs text-muted-foreground">{t('sub_steps_hint')}</p>
          <ol className="space-y-2">
            {subs.map((c, i) => (
              <li key={c.key} className="flex items-center gap-1.5">
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                <Input value={c.name} onChange={(e) => setSub(i, e.target.value)} placeholder={t('sub_step_placeholder')} maxLength={60} aria-label={`${t('sub_steps')} ${i + 1}`} />
                <Button type="button" size="icon" variant="ghost" className="shrink-0" title={t('move_up')} aria-label={t('move_up')} disabled={i === 0} onClick={() => moveSub(i, -1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="shrink-0" title={t('move_down')} aria-label={t('move_down')} disabled={i === subs.length - 1} onClick={() => moveSub(i, 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="shrink-0 text-destructive" title={t('delete')} aria-label={t('delete')} onClick={() => setSubs((list) => list.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
          {errors.sub_steps && <p className="mt-2 text-xs text-destructive">{errors.sub_steps}</p>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={subs.length >= 15}
            onClick={() => setSubs((list) => [...list, { key: `n${Date.now()}`, name: '' }])}
          >
            <Plus className="size-3.5" /> {t('add_sub_step')}
          </Button>
        </div>

        <div className="space-y-4 rounded-lg border border-border p-4">
          <Switch checked={form.is_waiting} onChange={(v) => setForm((f) => ({ ...f, is_waiting: v }))} label={t('waiting_step')} description={t('waiting_step_hint')} />
          <Switch checked={form.allow_add_sub} onChange={(v) => setForm((f) => ({ ...f, allow_add_sub: v }))} label={t('allow_add_sub')} description={t('allow_add_sub_hint')} />
          <Switch checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} label={t('active')} description={t('step_active_hint')} disabled={lastActive} />
          {errors.is_active && <p className="text-xs text-destructive">{errors.is_active}</p>}
        </div>
      </form>
    </Modal>
  );
}
