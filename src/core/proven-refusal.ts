/**
 * The "proven not actuated" refusal signal — the copy reachable from the
 * content bundle (issue #108).
 *
 * The canonical constant and helpers live in `src/core/submission-operation.ts`
 * (used by the background lanes and tests). This separate module exists because
 * the content bundle cannot value-import that one: the ledger is already
 * bundled by the service-worker entry, and a runtime import from both entries
 * would make the renderer hoist it into a shared chunk an MV3 classic content
 * script cannot load. This module is deliberately reachable from the content
 * entry *only* — background code uses the canonical helpers — so it stays
 * single-copy, and `tests/proven-refusal.test.ts` pins both sides to the same
 * name string.
 *
 * Semantics (identical to the core side): a dispatch callback throws this
 * signal when it refused *before any provider-facing write* — the composer-draft
 * refusal being the canonical case. A failure that may have written anything
 * (a submit that did not land after insertion) must throw an ordinary Error and
 * stays `UNCERTAIN`: "proven not actuated" is a claim about the provider, and a
 * half-completed actuation cannot support it.
 */

export const PROVEN_NOT_ACTUATED_REFUSAL_NAME = "ProvenNotActuatedRefusal";

/** Construct the "proven not actuated" refusal signal for `reason`. */
export function provenNotActuatedRefusal(reason: string): Error {
  return Object.assign(new Error(reason), { name: PROVEN_NOT_ACTUATED_REFUSAL_NAME });
}

/** Structural recognition — by `name`, never by class identity (see above). */
export function isProvenNotActuatedRefusal(value: unknown): value is Error & { reason: string } {
  return Boolean(value && typeof value === "object" && (value as { name?: unknown }).name === PROVEN_NOT_ACTUATED_REFUSAL_NAME &&
    typeof (value as { message?: unknown }).message === "string" && (value as { message: string }).message !== "");
}
