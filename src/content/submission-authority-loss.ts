/**
 * Same-Run submission-authority loss policy.
 *
 * A Run whose own authority slot no longer matches its dispatch fence cannot
 * reconcile again — within one logical thread authority only ever moves
 * forward — so without a terminal verdict it would sit in an intermediate
 * phase forever. This decides when that observation is strong enough to end
 * the Run.
 *
 * Deliberately only "SUPERSEDED" fires. "ABSENT" means no authority entry
 * exists for the operation's thread; an operation that reached DISPATCHING
 * always had one and nothing in the extension deletes one, so an absent entry
 * is never evidence of loss. Firing on it would arm a fail-safe with no true
 * positive producer while risking a false one. It stays a diagnosis.
 *
 * The same reasoning excludes a foreign thread's authority: after the
 * per-thread keying there is no shared slot to be taken over, and even before
 * it, another conversation winning a slot is not this Run losing anything.
 * Hence the explicit identity checks below rather than a bare "not OK".
 */

export type SubmissionAuthorityDiagnosis = "OK" | "ABSENT" | "SUPERSEDED";

export interface AuthorityLossInput {
  authority: SubmissionAuthorityDiagnosis | undefined;
  now: number;
  windowMs: number;
  /** When this page first saw the diagnosis hold continuously; null if not tracking. */
  since: number | null;
  active: { operationId: string; logicalThreadId: string } | null;
  run: { status: string; pendingSubmissionOperationId?: string; logicalThreadId: string } | null;
}

export interface AuthorityLossVerdict {
  /** The tracker to carry into the next observation. */
  since: number | null;
  fire: boolean;
}

export function evaluateAuthorityLoss(input: AuthorityLossInput): AuthorityLossVerdict {
  const active = input.active;
  const run = input.run;
  const superseded = input.authority === "SUPERSEDED" && active !== null && run !== null &&
    run.status === "ACTIVE" &&
    run.pendingSubmissionOperationId === active.operationId &&
    active.logicalThreadId === run.logicalThreadId;
  if (!superseded) return { since: null, fire: false };
  const since = input.since ?? input.now;
  if (input.now - since < input.windowMs) return { since, fire: false };
  return { since: null, fire: true };
}
