import { useMutation } from '@tanstack/react-query';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useOnline } from '../lib/pwa';
import { entryRef, lineRef, useAct } from '../lib/act';
import { newRef } from '../lib/offline';
import type { WoJobCode, WoJobPart, WorkOrderDetail } from '../lib/types';
import { useConfirm } from './confirm';
import { useToast } from './toast';
import { Button, Field, Input, Modal, Select } from './ui';

/** Same units as the server; LTR, KG and MTR may have decimals, other units are counted in whole numbers. */
const UOMS = ['PCS', 'SET', 'UNIT', 'PAIR', 'BOX', 'ROLL', 'TUBE', 'CAN', 'PAIL', 'DRUM', 'LTR', 'KG', 'MTR'];
const DECIMAL_UOMS = ['LTR', 'KG', 'MTR'];
const qtyText = (qty: number, lang: string) => new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-GB', { maximumFractionDigits: 2 }).format(qty);
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ');

function qtyError(raw: string, uom: string) {
  const v = Number(raw.trim().replace(',', '.'));
  if (raw.trim() === '' || !Number.isFinite(v) || v <= 0 || v > 9999999) return 'Quantity must be more than 0 (max 9,999,999)';
  if (!DECIMAL_UOMS.includes(uom) && !Number.isInteger(v)) return `Quantity must be a whole number for ${uom}`;
  if (DECIMAL_UOMS.includes(uom) && Math.round(v * 100) !== Math.round(v * 100 * 1e6) / 1e6) return 'Quantity can have at most 2 decimals';
  return '';
}

/** Part number (lines from the former spare part master only) and name. */
const partLabel = (p: Pick<WoJobPart, 'part_number' | 'part_name'>) => (p.part_number ? `${p.part_number} · ${p.part_name}` : p.part_name);

/**
 * Spare parts used for one job code entry (job code + mechanic) of Step 7: typed part name, quantity and unit.
 * Who may change them is decided by the parent (same rule as the job codes themselves).
 */
/** `queued` (mechanic app): changes go through the outbox, so they also work offline. */
export function JobParts({ wo, entry, editable, onDone, queued }: { wo: WorkOrderDetail; entry: WoJobCode; editable: boolean; onDone: (data: WorkOrderDetail) => void; queued?: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const online = useOnline();
  const act = useAct();
  const [editing, setEditing] = useState<WoJobPart | 'new' | null>(null);
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
                  {p.part_number && <><span className="font-mono">{p.part_number}</span> · </>}{p.part_name}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{qtyText(p.qty, lang)} {p.uom}</span>
                {editable && (
                  <span className="no-print -my-1 ml-auto flex shrink-0 sm:ml-0">
                    <Button size="icon" variant="ghost" className="size-7" title={t('edit_part_title')} aria-label={t('edit_part_title')} disabled={!queued && !online} onClick={() => setEditing(p)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive"
                      title={t('delete')}
                      aria-label={t('delete')}
                      disabled={!queued && !online}
                      loading={remove.isPending && remove.variables?.id === p.id}
                      onClick={() => confirm({ message: t('confirm_remove_part', { part: partLabel(p), job: entry.job_code }), tone: 'destructive', confirmLabel: t('delete') }, () => (queued ? act({ type: 'part.remove', wo_uuid: wo.wo_uuid, label: t('op_part_remove', { part: p.part_name }), ...entryRef(entry), ...lineRef(p) }) : remove.mutate(p)))}
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
        <Button size="sm" variant="ghost" className="no-print -ml-2 mt-1 h-8 text-primary" disabled={!queued && !online} onClick={() => setEditing('new')}>
          <Plus className="size-3.5" /> {t('add_part')}
        </Button>
      )}
      {editing && (
        <PartDialog
          base={base}
          wo={wo}
          entry={entry}
          line={editing === 'new' ? null : editing}
          queued={queued}
          onClose={() => setEditing(null)}
          onDone={(data) => { onDone(data); setEditing(null); }}
        />
      )}
    </div>
  );
}

/** Add a spare part line (`line` null) or change one: name, quantity and unit are all typed or picked here. */
function PartDialog({ base, wo, entry, line, queued, onClose, onDone }: { base: string; wo: WorkOrderDetail; entry: WoJobCode; line: WoJobPart | null; queued?: boolean; onClose: () => void; onDone: (data: WorkOrderDetail) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const act = useAct();
  const [name, setName] = useState(line?.part_name ?? '');
  const [qty, setQty] = useState(line ? String(line.qty) : '1');
  const [uom, setUom] = useState(line?.uom ?? 'PCS');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Names already used on this work order, offered while typing (also offline).
  const suggestions = [...new Set(wo.job_codes.flatMap((j) => (j.parts ?? []).map((p) => p.part_name)))].sort();
  const listId = `part-names-${entry.id}`;

  const save = useMutation({
    mutationFn: () => {
      const body = { part_name: cleanName(name), qty, uom };
      return line ? api<WorkOrderDetail>(`${base}/${line.id}`, { method: 'PUT', body }) : api<WorkOrderDetail>(base, { method: 'POST', body });
    },
    onSuccess: onDone,
    onError: (err) => {
      setErrors(err instanceof ApiError && err.errors ? err.errors : {});
      toast('error', (err as Error).message);
    },
  });

  const submit = () => {
    const part = cleanName(name);
    const next: Record<string, string> = {};
    if (part.length < 2 || part.length > 120) next.part_name = t('enter_part');
    else if ((entry.parts ?? []).some((p) => p.id !== line?.id && p.part_name.toLowerCase() === part.toLowerCase())) next.part_name = t('part_listed_error');
    if (qtyError(qty, uom)) next.qty = qtyError(qty, uom);
    setErrors(next);
    if (Object.keys(next).length) return;
    const amount = qtyText(Number(qty.replace(',', '.')), lang);
    const message = line
      ? t('confirm_edit_part', { part, qty: amount, uom })
      : t('confirm_add_part', { part, qty: amount, uom, job: entry.job_code, mechanic: entry.mechanic_name });
    confirm({ message }, () => {
      if (!queued) return save.mutate();
      if (line) act({ type: 'part.update', wo_uuid: wo.wo_uuid, label: t('op_part_update', { part, qty: amount, uom }), ...entryRef(entry), ...lineRef(line), part_name: part, qty, uom });
      else act({ type: 'part.add', wo_uuid: wo.wo_uuid, label: t('op_part_add', { part, qty: amount, uom }), ...entryRef(entry), part_name: part, qty, uom, line_ref: newRef() });
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={line ? t('edit_part_title') : t('add_part_title')}
      description={`${entry.job_code} · ${entry.job_name} — ${entry.mechanic_name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('spareparts')} required error={errors.part_name}>
          <Input
            autoFocus
            value={name}
            list={listId}
            maxLength={120}
            onChange={(e) => { setName(e.target.value); setErrors((er) => ({ ...er, part_name: '' })); }}
            placeholder={t('part_name_placeholder')}
            invalid={!!errors.part_name}
          />
          <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('quantity')} required error={errors.qty}>
            <Input type="number" inputMode="decimal" min={0} step={DECIMAL_UOMS.includes(uom) ? 0.01 : 1} value={qty} onChange={(e) => { setQty(e.target.value); setErrors((er) => ({ ...er, qty: '' })); }} invalid={!!errors.qty} />
          </Field>
          <Field label={t('uom')} required error={errors.uom}>
            <Select value={uom} onChange={(e) => { setUom(e.target.value); setErrors((er) => ({ ...er, qty: '', uom: '' })); }}>
              {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
