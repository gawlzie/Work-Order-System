import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './auth';
import { useI18n, type TKey } from './i18n';

/**
 * Guided tours: step-by-step tips that highlight the real controls of a screen. A step points at an element with
 * data-tour="<target>" (or at nothing, for a centred card); steps whose element is not on screen (another role,
 * another work order state) are skipped. Each tour starts by itself once per user on this device and can be
 * restarted from the help menu (web) or the Account tab (mechanic app).
 */
export type TourId = 'web' | 'wo-list' | 'wo-detail' | 'm-home' | 'm-wo';
type Step = { target?: string; title: TKey; body: TKey };

const TOURS: Record<TourId, Step[]> = {
  web: [
    { title: 'tour_web_welcome_t', body: 'tour_web_welcome_b' },
    { target: 'nav', title: 'tour_web_nav_t', body: 'tour_web_nav_b' },
    { target: 'dash-cards', title: 'tour_web_cards_t', body: 'tour_web_cards_b' },
    { target: 'page-actions', title: 'tour_web_filters_t', body: 'tour_web_filters_b' },
    { target: 'dash-list', title: 'tour_web_list_t', body: 'tour_web_list_b' },
    { target: 'lang', title: 'tour_lang_t', body: 'tour_lang_b' },
    { target: 'help', title: 'tour_help_t', body: 'tour_help_b' },
    { target: 'bell', title: 'tour_bell_t', body: 'tour_bell_b' },
    { target: 'profile', title: 'tour_profile_t', body: 'tour_profile_b' },
  ],
  'wo-list': [
    { target: 'page-actions', title: 'tour_wolist_actions_t', body: 'tour_wolist_actions_b' },
    { target: 'wo-search', title: 'tour_wolist_search_t', body: 'tour_wolist_search_b' },
    { target: 'wo-table', title: 'tour_wolist_table_t', body: 'tour_wolist_table_b' },
  ],
  'wo-detail': [
    { target: 'wo-approval', title: 'tour_wodetail_approval_t', body: 'tour_wodetail_approval_b' },
    { target: 'wo-info', title: 'tour_wodetail_info_t', body: 'tour_wodetail_info_b' },
    { target: 'wo-steps', title: 'tour_wodetail_steps_t', body: 'tour_wodetail_steps_b' },
    { target: 'wo-proof', title: 'tour_wodetail_proof_t', body: 'tour_wodetail_proof_b' },
    { target: 'page-actions', title: 'tour_wodetail_actions_t', body: 'tour_wodetail_actions_b' },
  ],
  'm-home': [
    { title: 'tour_m_welcome_t', body: 'tour_m_welcome_b' },
    { target: 'm-tabs', title: 'tour_m_tabs_t', body: 'tour_m_tabs_b' },
    { target: 'm-search', title: 'tour_m_search_t', body: 'tour_m_search_b' },
    { target: 'm-list', title: 'tour_m_list_t', body: 'tour_m_list_b' },
    { target: 'm-nav-new', title: 'tour_m_new_t', body: 'tour_m_new_b' },
    { target: 'bell', title: 'tour_bell_t', body: 'tour_bell_b' },
    { target: 'm-nav-account', title: 'tour_m_account_t', body: 'tour_m_account_b' },
  ],
  'm-wo': [
    { target: 'm-step', title: 'tour_mwo_step_t', body: 'tour_mwo_step_b' },
    { target: 'm-jobcodes', title: 'tour_mwo_jobcodes_t', body: 'tour_mwo_jobcodes_b' },
    { target: 'm-finish', title: 'tour_mwo_finish_t', body: 'tour_mwo_finish_b' },
    { target: 'm-steps', title: 'tour_mwo_steps_t', body: 'tour_mwo_steps_b' },
  ],
};

/** The tours the mechanic app's "Take the tour" restarts. */
export const MECHANIC_TOURS: TourId[] = ['m-home', 'm-wo'];

const doneKey = (userId: number | undefined, id: TourId) => `wos-tour:${userId ?? 0}:${id}`;
const isDone = (userId: number | undefined, id: TourId) => {
  try { return localStorage.getItem(doneKey(userId, id)) === 'done'; } catch { return true; }
};
const markDone = (userId: number | undefined, id: TourId) => {
  try { localStorage.setItem(doneKey(userId, id), 'done'); } catch { /* storage blocked: the tour simply shows again */ }
};

/** The visible element for a target (the sidebar and the mobile menu button can share one). */
function findTarget(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

type Ctx = {
  /** The tour of the screen shown now, if it has one. */
  pageTour: TourId | null;
  start: (id: TourId) => void;
  /** Forgets that these tours were seen, so they start again on their screens. */
  reset: (ids: TourId[]) => void;
  register: (id: TourId | null) => void;
};
const TourCtx = createContext<Ctx | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pageTour, setPageTour] = useState<TourId | null>(null);
  const [running, setRunning] = useState<{ id: TourId; steps: Step[] } | null>(null);

  const start = useCallback((id: TourId) => {
    const steps = TOURS[id].filter((s) => !s.target || findTarget(s.target));
    if (steps.length) setRunning({ id, steps });
  }, []);
  const reset = useCallback((ids: TourId[]) => {
    for (const id of ids) {
      try { localStorage.removeItem(doneKey(user?.id, id)); } catch { /* nothing to forget */ }
    }
  }, [user?.id]);
  const finish = useCallback(() => {
    setRunning((r) => {
      if (r) markDone(user?.id, r.id);
      return null;
    });
  }, [user?.id]);

  return (
    <TourCtx.Provider value={{ pageTour, start, reset, register: setPageTour }}>
      {children}
      {running && <TourOverlay key={running.id} steps={running.steps} onClose={finish} />}
    </TourCtx.Provider>
  );
}

export function useTourControls() {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error('useTourControls outside TourProvider');
  return ctx;
}

/** Declares the tour of a screen; it starts by itself the first time, once the screen's data is there. */
export function useTour(id: TourId, ready = true) {
  const { user } = useAuth();
  const ctx = useContext(TourCtx);
  const register = ctx?.register;
  const start = ctx?.start;
  useEffect(() => {
    register?.(id);
    return () => register?.(null);
  }, [id, register]);
  useEffect(() => {
    if (!ready || !user || !start || isDone(user.id, id)) return;
    // Give the screen a moment to lay out before measuring its controls.
    const timer = window.setTimeout(() => start(id), 700);
    return () => window.clearTimeout(timer);
  }, [id, ready, user, start]);
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_W = 340;

function TourOverlay({ steps, onClose }: { steps: Step[]; onClose: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  // Measure the highlighted element; follow it while the page scrolls or resizes.
  useLayoutEffect(() => {
    const el = step.target ? findTarget(step.target) : null;
    if (!el) { setBox(null); return; }
    // A section taller than most of the screen is shown from its top (below the sticky header), others centred.
    const r0 = el.getBoundingClientRect();
    if (r0.height > window.innerHeight * 0.6) window.scrollBy({ top: r0.top - 72, behavior: 'auto' });
    else el.scrollIntoView({ block: 'center', behavior: 'auto' });
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useLayoutEffect(() => {
    setCardH(cardRef.current?.offsetHeight ?? 0);
    cardRef.current?.focus();
  }, [index, box]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') last ? onClose() : setIndex((i) => i + 1);
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, onClose]);

  // The card goes below the highlight, or above it when there is no room; centred when nothing is highlighted.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 24);
  let cardStyle: CSSProperties;
  if (!box) {
    cardStyle = { width, left: (vw - width) / 2, top: Math.max(12, (vh - cardH) / 2) };
  } else {
    const below = box.top + box.height + 10;
    const above = box.top - 10 - cardH;
    const top = below + cardH <= vh - 12 || above < 12 ? Math.min(below, vh - cardH - 12) : above;
    const left = Math.min(Math.max(12, box.left + box.width / 2 - width / 2), vw - width - 12);
    cardStyle = { width, left, top: Math.max(12, top) };
  }

  return createPortal(
    <div className="no-print fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Clicks outside the card do nothing, so the tour is not left by accident. */}
      <div className="absolute inset-0" />
      {box ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        tabIndex={-1}
        className="absolute animate-fade-in rounded-xl border border-border bg-card p-4 text-foreground shadow-xl outline-none"
        style={cardStyle}
      >
        <p className="text-xs font-medium text-muted-foreground tabular-nums">{t('tour_step_of', { n: index + 1, total: steps.length })}</p>
        <h2 id="tour-title" className="mt-1 font-semibold">{t(step.title)}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(step.body)}</p>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={onClose} className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted">
            {t('tour_skip')}
          </button>
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <button onClick={() => setIndex((i) => i - 1)} className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
                {t('tour_back')}
              </button>
            )}
            <button onClick={() => (last ? onClose() : setIndex((i) => i + 1))} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90">
              {last ? t('tour_done') : t('tour_next')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
