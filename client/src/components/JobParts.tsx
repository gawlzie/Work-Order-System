import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useOnline } from '../lib/pwa';
import { useSparepartSearch } from '../lib/queries';
import type { SparepartOption, WoJobCode, WoJobPart, WorkOrderDetail } from '../lib/types';
import { useConfirm } from './confirm';
import { useToast } from './toast';
import { Button, Field, Input, Modal } from './ui';

/** LTR, KG and MTR may have decimals; other units are counted in whole numbers (same rule as the server). */
const DECIMAL_UOMS = ['LTR', 'KG', 'MTR'];
const qtyText = (qty: number, lang: string) => new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-GB', { maximumFractionDigits: 2 }).format(qty);

function qtyError(raw: string, uom: string) {
  const v = Number(raw.trim().replace(',', '.'));
  if (raw.trim() === '' || !Number.isFinite(v) || v <= 0 || v > 9999999) return 'Quantity must be more than 0 (max 9,999,999)';
  if (!DECIMAL_UOMS.includes(uom) && !Number.isInteger(v)) return `Quantity must be a whole number for ${uom}`;
  if (DECIMAL_UOMS.includes(uom) && Math.round(v * 100) !== Math.round(v * 100 * 1e6) / 1e6) return 'Quantity can have at most 2 decimals';
  return '';
}

/**
 * Spare parts used for one job code entry (job code + mechanic) of Step 7: part, quantity and its unit.
 * Who may change them is decided by the parent (same rule as the job codes themselves).
 */
export function JobParts({ wo, entry, editable, onDone }: { wo: WorkOrderDetail; entry: WoJobCode; editable: boolean; onDone: (data: WorkOrderDetail) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const online = useOnline();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WoJobPart | null>(null);
  const base = `/work-orders/${wo.wo_uuid}/job-codes/${entry.id}/parts`;
  const parts = entry.parts ?? [];

  const remove = useMutation({
    mutationFn: (line: WoJobPart) => api<WorkOrderDetail>(`${base}/${line.id}`, { method: 'DELETE' }),
    onSuccess: onDone,
    onError: (err) => toast('error', (err as Error).message),
  });

  if (!parts.length && !editable) return null;
  return (
    <div className="mt-2">
      {parts.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-muted/50 px-2.5 py-1.5">
          {parts.map((p) => (
            // On a phone the part name gets its own line, quantity and buttons go below it.
            <li key={p.id} className="flex items-start gap-2 text-xs">
              <Package className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                <span className="w-full break-words sm:w-auto sm:min-w-0 sm:flex-1">
                  <span className="font-mono">{p.part_number}</span> · {p.part_name}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{qtyText(p.qty, lang)} {p.uom}</span>
                {editable && (
                  <span className="no-print -my-1 ml-auto flex shrink-0 sm:ml-0">
                    <Button size="icon" variant="ghost" className="size-7" title={t('edit_part_title')} aria-label={t('edit_part_title')} disabled={!online} onClick={() => setEditing(p)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive"
                      title={t('delete')}
                      aria-label={t('delete')}
                      disabled={!online}
                      loading={remove.isPending && remove.variables?.id === p.id}
                      onClick={() => confirm({ message: t('confirm_remove_part', { part: `${p.part_number} · ${p.part_name}`, job: entry.job_code }), tone: 'destructive', confirmLabel: t('delete') }, () => remove.mutate(p))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Button size="sm" variant="ghost" className="no-print -ml-2 mt-1 h-8 text-primary" disabled={!online} onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> {t('add_part')}
        </Button>
      )}
      {adding && <AddPartDialog base={base} entry={entry} onClose={() => setAdding(false)} onDone={(data) => { onDone(data); setAdding(false); }} />}
      {editing && <EditPartDialog base={base} line={editing} onClose={() => setEditing(null)} onDone={(data) => { onDone(data); setEditing(null); }} />}
    </div>
  );
}

function AddPartDialog({ base, entry, onClose, onDone }: { base: string; entry: WoJobCode; onClose: () => void; onDone: (data: WorkOrderDetail) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [term, setTerm] = useState('');
  const search = useDeferredValue(term.trim());
  const results = useSparepartSearch(search);
  const [part, setPart] = useState<SparepartOption | null>(null);
  const [qty, setQty] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const listed = new Set((entry.parts ?? []).map((p) => p.sparepart_id));

  const save = useMutation({
    mutationFn: () => api<WorkOrderDetail>(base, { method: 'POST', body: { sparepart_id: part?.id, qty } }),
    onSuccess: onDone,
    onError: (err) => {
      setErrors(err instanceof ApiError && err.errors ? err.errors : {});
      toast('error', (err as Error).message);
    },
  });
  const submit = () => {
    const next: Record<string, string> = {};
    if (!part) next.sparepart_id = t('choose_part');
    else if (qtyError(qty, part.uom)) next.qty = qtyError(qty, part.uom);
    setErrors(next);
    if (Object.keys(next).length || !part) return;
    const amount = qtyText(Number(qty.replace(',', '.')), lang);
    confirm({ message: t('confirm_add_part', { part: `${part.part_number} · ${part.part_name}`, qty: amount, uom: part.uom, job: entry.job_code, mechanic: entry.mechanic_name }) }, () => save.mutate());
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('add_part_title')}
      description={`${entry.job_code} · ${entry.job_name} — ${entry.mechanic_name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('spareparts')} required error={errors.sparepart_id}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('search_part')} className="pl-9" invalid={!!errors.sparepart_id} />
          </div>
          {search.length < 2 ? (
            <span className="text-xs text-muted-foreground">{t('part_search_hint')}</span>
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
              {results.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{t('no_parts_found')}</li>}
              {results.data?.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={listed.has(p.id)}
                    onClick={() => { setPart(p); setErrors((e) => ({ ...e, sparepart_id: '', qty: '' })); if (!DECIMAL_UOMS.includes(p.uom) && !Number.isInteger(Number(qty))) setQty('1'); }}
                    className={clsx(
                      'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/60 disabled:opacity-50',
                      part?.id === p.id && 'bg-primary/10',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs text-muted-foreground">{p.part_number}</span>
                      <span className="block break-words">{p.part_name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{listed.has(p.id) ? t('part_listed') : `${p.uom} · ${t('in_stock_short', { n: qtyText(p.stock, lang) })}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
        {part && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-mono text-xs">{part.part_number}</span> · {part.part_name}
          </div>
        )}
        <Field label={`${t('quantity')}${part ? ` (${part.uom})` : ''}`} required error={errors.qty}>
          <div className="flex items-center gap-2">
            <Input type="number" inputMode="decimal" min={0} step={part && DECIMAL_UOMS.includes(part.uom) ? 0.01 : 1} value={qty} onChange={(e) => { setQty(e.target.value); setErrors((er) => ({ ...er, qty: '' })); }} invalid={!!errors.qty} className="max-w-40" />
            <span className="text-sm font-medium text-muted-foreground">{part?.uom ?? '-'}</span>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function EditPartDialog({ base, line, onClose, onDone }: { base: string; line: WoJobPart; onClose: () => void; onDone: (data: WorkOrderDetail) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [qty, setQty] = useState(String(line.qty));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api<WorkOrderDetail>(`${base}/${line.id}`, { method: 'PUT', body: { qty } }),
    onSuccess: onDone,
    onError: (err) => {
      setError(err instanceof ApiError && err.errors?.qty ? err.errors.qty : '');
      toast('error', (err as Error).message);
    },
  });
  const submit = () => {
    const e = qtyError(qty, line.uom);
    setError(e);
    if (!e) confirm({ message: t('confirm_edit_part', { part: `${line.part_number} · ${line.part_name}`, qty: qtyText(Number(qty.replace(',', '.')), lang), uom: line.uom }) }, () => save.mutate());
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('edit_part_title')}
      description={`${line.part_number} · ${line.part_name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <Field label={`${t('quantity')} (${line.uom})`} required error={error}>
        <div className="flex items-center gap-2">
          <Input autoFocus type="number" inputMode="decimal" min={0} step={DECIMAL_UOMS.includes(line.uom) ? 0.01 : 1} value={qty} onChange={(e) => { setQty(e.target.value); setError(''); }} invalid={!!error} className="max-w-40" />
          <span className="text-sm font-medium text-muted-foreground">{line.uom}</span>
        </div>
      </Field>
    </Modal>
  );
}
