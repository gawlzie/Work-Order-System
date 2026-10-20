import { clsx } from 'clsx';
import { Inbox, Loader2, X } from 'lucide-react';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'ghost' | 'destructive' | 'success';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  outline: 'border border-border bg-card hover:bg-muted',
  ghost: 'hover:bg-muted',
  destructive: 'bg-destructive text-white hover:opacity-90',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        variants[variant],
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'icon' && 'size-9',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

// 16px text on phones stops iOS Safari from zooming in when a field is focused.
const fieldBase =
  'w-full rounded-lg border border-border bg-card px-3 text-base outline-none sm:text-sm transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input ref={ref} className={clsx(fieldBase, 'h-10', invalid && 'border-destructive', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className, invalid, children, ...props }, ref) => (
    <select ref={ref} className={clsx(fieldBase, 'h-10 pr-8', invalid && 'border-destructive', className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <textarea ref={ref} className={clsx(fieldBase, 'min-h-28 py-2', invalid && 'border-destructive', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export function Field({ label, required, error, children, className }: { label: string; required?: boolean; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex flex-col gap-1.5', className)}>
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-xl border border-border bg-card shadow-sm', className)}>{children}</div>;
}

const badgeVariants = {
  default: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  destructive: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
  gray: 'bg-muted text-muted-foreground border-border',
};
export type BadgeVariant = keyof typeof badgeVariants;

export function Badge({ variant = 'default', className, children, title }: { variant?: BadgeVariant; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', badgeVariants[variant], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-6 animate-spin text-primary', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-muted', className)} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Inbox className="size-7 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/** Stops the page behind an overlay (modal, mobile menu) from scrolling while it is open. */
export function useBodyLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

/** Label / value pair used by the card layout that replaces tables on small screens. */
export function MetaItem({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Button text that collapses to an icon-only button (still read by screen readers) on phones. */
export const BtnLabel = ({ children }: { children: ReactNode }) => <span className="max-sm:sr-only">{children}</span>;

/** Open modals, newest last: Escape only closes the top one (e.g. a confirmation over a form). */
const openModals: symbol[] = [];

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    openModals.push(id);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openModals.at(-1) === id && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(id), 1);
    };
  }, [open]);
  useBodyLock(open);
  if (!open) return null;
  // Bottom sheet on phones, centered dialog from `sm` up.
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div
        className={clsx(
          'flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:animate-none sm:rounded-xl',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children && <div className="overflow-y-auto p-4 sm:p-5">{children}</div>}
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] *:w-full sm:flex-row sm:justify-end sm:pb-4 sm:*:w-auto">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold break-words sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={clsx('flex items-start gap-3', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary', checked ? 'bg-primary' : 'bg-border')}
      >
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
