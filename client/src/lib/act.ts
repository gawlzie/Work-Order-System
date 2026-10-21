import { useAuth } from './auth';
import { enqueue, type OpInput } from './offline';
import type { Step, WoJobCode, WoJobPart } from './types';

/** Mechanic app action: stored in the outbox (works offline) and sent when there is signal. */
export function useAct() {
  const { user } = useAuth();
  return (input: OpInput) => (user ? enqueue(input, user) : null);
}

/** How an outbox action points at a step: template steps by number, offline additional work by its reference. */
export const stepRef = (s: Step) => (s.is_additional ? (s.client_ref ? { step_ref: s.client_ref } : { step_id: s.id }) : { step_no: s.step_no });
/** A job code entry: by its reference when it was made offline, else by id. */
export const entryRef = (j: WoJobCode) => (j.client_ref ? { entry_ref: j.client_ref, ...(j.id > 0 ? { entry_id: j.id } : {}) } : { entry_id: j.id });
/** A spare part line: by its reference when it was made offline, else by id. */
export const lineRef = (p: WoJobPart) => (p.client_ref ? { line_ref: p.client_ref, ...(p.id > 0 ? { line_id: p.id } : {}) } : { line_id: p.id });
