import { clsx } from 'clsx';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  description?: string;
}

const Ctx = createContext<(kind: Kind, title: string, description?: string) => void>(() => {});

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const colors = { success: 'text-emerald-500', error: 'text-red-500', info: 'text-blue-500' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, title: string, description?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, title, description }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className="pointer-events-auto flex gap-3 rounded-lg border border-border bg-card p-4 shadow-lg" role="status">
              <Icon className={clsx('mt-0.5 size-5 shrink-0', colors[t.kind])} />
              <div>
                <p className="text-sm font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
