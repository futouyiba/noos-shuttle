/**
 * The governed (Human-authorised) composer actuation: one payload, written only
 * into a composer the Human has left free, then submitted.
 *
 * This is the GO lane's counterpart to `background-dispatch.ts`, and it exists
 * for the same reason: the three things it does are ordering-sensitive, and the
 * order is the fix (issue #106).
 *
 *   1. read the page **now** and check the dispatch fence against that reading;
 *   2. ask the composer for a free slot, writing nothing if the Human has a
 *      draft pending;
 *   3. submit.
 *
 * Step 2 is what stops a generated continuation from destroying an unsent draft.
 * The trigger does not matter: `autoAdvanceRound` (AUTO_X5) reaches this path
 * without any new Human action, so "the Human asked for this" is not available
 * as an excuse to overwrite (issue #106).
 *
 * The read in step 1 is deliberately the *reading* half of the observer loop,
 * never the loop itself. Four call sites reach a composer write, and every one
 * of them must decide against a composer it has just looked at — the composer
 * check and the write are in the same synchronous turn, so no draft can appear
 * between them, and single-threaded JS means two writers cannot interleave. A
 * writer that instead re-entered the observer loop here would fire the probes
 * from inside an actuation, which is how a second writer reaches the same
 * composer (issue #104).
 *
 * This module holds no state: the fence check and the live reading both belong
 * to the content entry and arrive through `GovernedActuationDeps`.
 */

import type { CarrierObservation } from "./runtime-observer";
import { insertIntoFreeChatInput, submitChatInput } from "./chatgpt-dom";
import { provenNotActuatedRefusal } from "../core/proven-refusal";

export interface GovernedActuationDeps {
  /** A fresh reading of the page, taken at the instant of actuation. */
  readonly readCurrent: () => CarrierObservation;
  /** True when that reading still matches the binding this dispatch was claimed for. */
  readonly isFenceCurrent: (current: CarrierObservation) => boolean;
}

/**
 * Write `payload` into the composer and submit it, or throw without writing.
 *
 * The two refusal reasons are deliberately distinguishable, because they reach
 * the durable ledger as `operation.error` and an audit has to be able to tell
 * "the page was not ready" from "the Human had something pending":
 *
 *  - `chatgpt_composer_unavailable` — no usable composer, the fence no longer
 *    holds, or the submit did not land;
 *  - `chatgpt_composer_not_empty` — the Human's unsent text has priority.
 *
 * Which failures carry the **proven-not-actuated** signal (issue #108) is a
 * claim about the provider, so it follows exactly the pre-write boundary: the
 * fence check and the composer refusal both happen *before anything is
 * written*, so they are provably un-actuated and marked; a submit that failed
 * *after* insertion may have left the payload in the composer or fired a send,
 * so it stays an ordinary error and the ledger records `UNCERTAIN`.
 */
export async function actuateGovernedPayload(payload: string, deps: GovernedActuationDeps): Promise<void> {
  if (!deps.isFenceCurrent(deps.readCurrent())) throw provenNotActuatedRefusal("chatgpt_composer_unavailable");
  const inserted = insertIntoFreeChatInput(payload);
  // Pre-write refusal: provably nothing was sent (issue #108).
  if (!inserted.ok) throw provenNotActuatedRefusal(inserted.reason);
  // Post-write failure: the payload may already be in the composer or a send
  // may have fired — genuinely ambiguous, deliberately NOT marked.
  if (!(await submitChatInput(inserted.composer))) throw new Error("chatgpt_composer_unavailable");
}
