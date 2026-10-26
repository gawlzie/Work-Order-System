import { clsx } from 'clsx';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  Children, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n';
import { fieldBase } from './fieldStyles';

/** Typed characters from which the list is narrowed down. */
export const SEARCH_MIN = 3;

type Option = { value: string; label: string; disabled: boolean };
type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean };

/** Text of an option's content (strings, numbers and nested elements). */
function text(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return '';
}

/** The <option>s among the children, also inside fragments, arrays and conditionals. */
function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const p = (child as ReactElement<OptionProps>).props;
      const label = text(p.children);
      out.push({ value: String(p.value ?? label), label, disabled: !!p.disabled });
    } else {
      out.push(...readOptions((child as ReactElement<{ children?: ReactNode }>).props.children));
    }
  });
  return out;
}

/** Accents, case and spaces do not matter in the search ("dt1" finds "DT 101"). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');

export interface SelectProps {
  value?: string | number;
  /** Called like a native select's change: `e.target.value` is the chosen option's value. */
  onChange?: (e: { target: { value: string } }) => void;
  children?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/**
 * Drop-down used everywhere in place of a native <select>, with the same <option> children: it opens a list with a
 * search box that narrows the options once SEARCH_MIN characters are typed. The list floats above dialogs (portal)
 * and opens upwards when there is no room below.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, onChange, children, disabled, invalid, className, id, 'aria-label': ariaLabel },
  ref,
) {
  const { t } = useI18n();
  const listId = useId();
  const options = useMemo(() => readOptions(children), [children]);
  const current = String(value ?? '');
  // Like a native select, a value that is not among the options shows the first one.
  const selected = options.find((o) => o.value === current) ?? options[0];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);

  const q = fold(query);
  // Counted as typed (spaces included), the search starts from SEARCH_MIN characters.
  const searching = query.trim().length >= SEARCH_MIN && q.length > 0;
  const shown = searching ? options.filter((o) => fold(o.label).includes(q)) : options;

  const show = (initial = '') => {
    if (disabled) return;
    setQuery(initial);
    setActive(Math.max(0, options.indexOf(selected)));
    setOpen(true);
  };
  const close = (focusTrigger = true) => {
    setOpen(false);
    setPlace(null);
    if (focusTrigger) trigger.current?.focus();
  };
  const pick = (o: Option | undefined) => {
    if (!o || o.disabled) return;
    close();
    if (o.value !== current) onChange?.({ target: { value: o.value } });
  };

  // Place the list under the field (above it when there is more room there), and follow scrolling / resizing.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const width = Math.max(r.width, 192);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPlace(below >= 240 || below >= above
        ? { left, width, top: r.bottom + 4, maxHeight: Math.min(320, below) }
        : { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(320, above) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // A press outside the field and the list closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Focus the search box once the list is placed (it is not rendered before).
  const placed = !!place;
  useEffect(() => {
    if (open && placed) search.current?.focus();
  }, [open, placed]);
  // Keep the highlighted option on a selectable one in view.
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  useEffect(() => setActive(0), [q]);

  const move = (step: number) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + step + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      show();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing on the closed field starts the search with that character.
      e.preventDefault();
      show(e.key);
    }
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Handled here: an Escape must not also close the dialog the field is in.
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
  };

  const typed = query.trim().length;
  return (
    <>
      <button
        ref={(el) => {
          trigger.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKey}
        className={clsx(fieldBase, 'relative flex h-10 items-center pr-8 text-left', invalid && 'border-destructive', open && 'border-primary ring-2 ring-primary/20', className)}
      >
        <span className={clsx('min-w-0 flex-1 truncate', (!selected || selected.disabled || selected.value === '') && 'text-muted-foreground')}>{selected?.label ?? ''}</span>
        <ChevronDown className={clsx('pointer-events-none absolute right-2.5 size-4 text-muted-foreground transition', open && 'rotate-180')} />
      </button>
      {open && place &&
        createPortal(
          <div
            ref={popup}
            className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-border bg-card text-sm shadow-lg"
            style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="relative border-b border-border p-1.5">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder={t('select_search_placeholder', { n: SEARCH_MIN })}
                aria-label={t('select_search_placeholder', { n: SEARCH_MIN })}
                aria-controls={listId}
                aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                className="h-9 w-full rounded-md bg-muted/50 pr-2 pl-8 text-base outline-none placeholder:text-muted-foreground focus:bg-muted sm:text-sm"
              />
            </div>
            {typed > 0 && !searching && (
              <p className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">{t('select_search_more', { n: SEARCH_MIN - typed })}</p>
            )}
            <ul id={listId} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto py-1">
              {shown.map((o, i) => (
                <li
                  key={`${o.value}-${i}`}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={o.value === selected?.value}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => pick(o)}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2 px-3 py-2',
                    i === active && !o.disabled && 'bg-muted',
                    o.disabled && 'cursor-default text-muted-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 break-words">{o.label || ' '}</span>
                  {o.value === selected?.value && <Check className="size-4 shrink-0 text-primary" />}
                </li>
              ))}
              {!shown.length && <li className="px-3 py-3 text-center text-muted-foreground">{t('select_no_match')}</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
});
