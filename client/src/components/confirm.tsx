import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { Button, Modal } from './ui';

interface ConfirmOptions {
  message: string;
  title?: string;
  /** Label of the confirm button; defaults to "Yes". */
  confirmLabel?: string;
  tone?: 'primary' | 'success' | 'destructive';
}
/** Ask before an action: resolves true when confirmed; with `onConfirm` it also runs the action. */
type Confirm = (options: ConfirmOptions, onConfirm?: () => void) => Promise<boolean>;

const Ctx = createContext<Confirm>(async () => true);

/** One confirmation dialog for the whole app, so every submit / finish / delete asks the same way. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((opts, onConfirm) => {
    resolver.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = (ok) => {
        resolver.current = null;
        setOptions(null);
        resolve(ok);
        if (ok) onConfirm?.();
      };
    });
  }, []);

  const close = (ok: boolean) => resolver.current?.(ok);
  const tone = options?.tone ?? 'primary';

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!options}
        onClose={() => close(false)}
        title={options?.title ?? t('confirm_title')}
        description={options?.message}
        footer={
          <>
            <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
            <Button variant={tone} autoFocus onClick={() => close(true)}>{options?.confirmLabel ?? t('yes')}</Button>
          </>
        }
      />
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
