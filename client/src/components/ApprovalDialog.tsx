import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { WorkOrder, WorkOrderDetail } from '../lib/types';
import { useToast } from './toast';
import { Button, Field, Modal, Textarea } from './ui';

type Target = Pick<WorkOrder, 'wo_uuid' | 'wo_number' | 'unit_number' | 'problem'>;

/** Approve (optional remarks) or reject (reason required) a work order that is waiting for approval. */
export function ApprovalDialog({ kind, wo, onClose }: { kind: 'approve' | 'reject'; wo: Target; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const approve = kind === 'approve';

  const save = useMutation({
    mutationFn: () =>
      api<WorkOrderDetail>(`/work-orders/${wo.wo_uuid}/approval`, {
        method: 'POST',
        body: approve ? { action: 'APPROVE', remarks: text } : { action: 'REJECT', reason: text },
      }),
    onSuccess: (data) => {
      toast('success', t(approve ? 'approved' : 'rejected'), wo.wo_number);
      qc.setQueryData(['work-order', wo.wo_uuid], data);
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t(approve ? 'approve_title' : 'reject_title')}
      description={`${wo.wo_number} · ${wo.unit_number} — ${t(approve ? 'approve_subtitle' : 'reject_subtitle')}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant={approve ? 'success' : 'destructive'} loading={save.isPending} disabled={!approve && text.trim().length < 3} onClick={() => save.mutate()}>
            {t(approve ? 'approve' : 'reject')}
          </Button>
        </>
      }
    >
      <p className="text-sm">{wo.problem}</p>
      {approve ? (
        <Field label={t('approval_remarks')} className="mt-4">
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('approval_remarks_placeholder')} maxLength={500} className="min-h-20" />
          <span className="self-end text-xs text-muted-foreground">{text.length}/500</span>
        </Field>
      ) : (
        <Field label={t('reject_reason')} required className="mt-4">
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        </Field>
      )}
    </Modal>
  );
}
