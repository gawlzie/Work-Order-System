import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ExternalLink, FileText, ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api, blobUrl, uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { Proof, WorkOrderDetail } from '../lib/types';
import { useToast } from './toast';
import { Button, Card, Modal } from './ui';

const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Image preview loaded with the auth token (an <img src> cannot send it). */
function Thumb({ woId, proof }: { woId: string; proof: Proof }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = proof.mime_type.startsWith('image/');
  useEffect(() => {
    if (!isImage) return;
    let revoked = false;
    let created: string | null = null;
    blobUrl(`/work-orders/${woId}/proofs/${proof.id}`)
      .then((u) => {
        created = u;
        if (revoked) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [woId, proof.id, isImage]);
  if (!isImage) {
    return (
      <div className="flex size-full items-center justify-center bg-red-500/10 text-red-600 dark:text-red-400">
        <FileText className="size-8" />
      </div>
    );
  }
  return url ? <img src={url} alt={proof.file_name} className="size-full object-cover" /> : (
    <div className="flex size-full items-center justify-center bg-muted text-muted-foreground"><ImageIcon className="size-7" /></div>
  );
}

/**
 * Proof of completion for a finished work order: PDF or photos uploaded by the approver (admin),
 * visible to everyone who can open the work order.
 */
export function ProofSection({ wo }: { wo: WorkOrderDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [deleting, setDeleting] = useState<Proof | null>(null);
  const finished = wo.status === 'FINISH';
  const canManage = can('wo.approve') && finished;

  const setProofs = (proofs: Proof[]) => {
    qc.setQueryData<WorkOrderDetail>(['work-order', wo.wo_uuid], (old) => (old ? { ...old, proofs } : old));
    qc.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const upload = async (files: File[]) => {
    const room = MAX_FILES - wo.proofs.length;
    const valid = files.filter((f) => {
      if (!ACCEPT.includes(f.type)) {
        toast('error', t('proof_bad_type'), f.name);
        return false;
      }
      if (f.size > MAX_BYTES) {
        toast('error', t('proof_too_large'), f.name);
        return false;
      }
      return true;
    });
    if (valid.length > room) toast('error', t('proof_limit', { n: MAX_FILES }));
    const batch = valid.slice(0, Math.max(0, room));
    if (!batch.length) return;
    setProgress({ done: 0, total: batch.length });
    let saved = 0;
    for (const file of batch) {
      try {
        setProofs(await uploadFile<Proof[]>(`/work-orders/${wo.wo_uuid}/proofs`, file));
        saved++;
      } catch (err) {
        toast('error', (err as Error).message, file.name);
      }
      setProgress((p) => p && { ...p, done: p.done + 1 });
    }
    setProgress(null);
    if (saved) toast('success', t('proof_uploaded', { n: saved }));
  };

  const remove = useMutation({
    mutationFn: (p: Proof) => api<Proof[]>(`/work-orders/${wo.wo_uuid}/proofs/${p.id}`, { method: 'DELETE' }),
    onSuccess: (proofs) => {
      setProofs(proofs);
      setDeleting(null);
      toast('success', t('data_deleted'));
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  // Open in a new tab: the tab is opened right away (so popup blockers allow it), then pointed at the file.
  const open = async (p: Proof) => {
    const tab = window.open('', '_blank');
    try {
      const url = await blobUrl(`/work-orders/${wo.wo_uuid}/proofs/${p.id}`);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      toast('error', (err as Error).message);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (canManage && !progress) upload([...e.dataTransfer.files]);
  };

  if (!finished && !wo.proofs.length) return null;

  return (
    <Card className="print-area mt-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold"><Paperclip className="size-4" /> {t('proof_title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('proof_subtitle')}</p>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{wo.proofs.length}/{MAX_FILES}</span>
      </div>

      {canManage && wo.proofs.length < MAX_FILES && (
        <div
          className={clsx('no-print m-4 rounded-xl border-2 border-dashed p-5 text-center transition', dragging ? 'border-primary bg-primary/5' : 'border-border')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-2 text-sm">{t('proof_drop')}</p>
          <p className="text-xs text-muted-foreground">{t('proof_types')}</p>
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              upload([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <Button className="mt-3" loading={!!progress} onClick={() => input.current?.click()}>
            <Upload className="size-4" /> {progress ? t('proof_uploading', { done: progress.done, total: progress.total }) : t('proof_choose')}
          </Button>
        </div>
      )}

      {wo.proofs.length > 0 ? (
        <ul className="grid gap-3 p-4 sm:grid-cols-2">
          {wo.proofs.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border p-2">
              <button onClick={() => open(p)} className="size-16 shrink-0 overflow-hidden rounded-lg" aria-label={t('proof_open')}>
                <Thumb woId={wo.wo_uuid} proof={p} />
              </button>
              <div className="min-w-0 flex-1">
                <button onClick={() => open(p)} className="block max-w-full truncate text-left text-sm font-medium hover:text-primary hover:underline" title={p.file_name}>
                  {p.file_name}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {p.mime_type === 'application/pdf' ? 'PDF' : p.mime_type.replace('image/', '').toUpperCase()} · {formatSize(p.size)}
                </p>
                <p className="truncate text-xs text-muted-foreground">{p.uploaded_by_name ?? '-'} · {formatDateTime(p.uploaded_at)}</p>
              </div>
              <div className="no-print flex shrink-0 flex-col gap-1">
                <Button size="icon" variant="ghost" title={t('proof_open')} aria-label={t('proof_open')} onClick={() => open(p)}>
                  <ExternalLink className="size-4" />
                </Button>
                {canManage && (
                  <Button size="icon" variant="ghost" className="text-destructive" title={t('delete')} aria-label={t('delete')} onClick={() => setDeleting(p)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{canManage ? t('proof_none_admin') : t('proof_none')}</p>
      )}

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('confirm_title')}
        description={t('proof_delete_confirm', { name: deleting?.file_name ?? '' })}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>{t('delete')}</Button>
          </>
        }
      />
    </Card>
  );
}
