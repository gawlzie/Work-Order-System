import { clsx } from 'clsx';
import { Inbox, Loader2, X } from 'lucide-react';
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

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

const fieldBase =
  'w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

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

export function Badge({ variant = 'default', className, children }: { variant?: BadgeVariant; className?: string; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', badgeVariants[variant], className)}>
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

export function Modal({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children && <div className="p-5">{children}</div>}
        {footer && <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
