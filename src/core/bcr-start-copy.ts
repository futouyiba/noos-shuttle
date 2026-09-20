/**
 * Bounded Continuation Run start-gate copy (issue #80).
 *
 * Starting a run waits for a READY carrier observation. When that wait times
 * out the panel used to say "Carrier not READY" no matter why: a provider that
 * was merely mid-generation read the same as a carrier that was never mounted,
 * so the message blamed the wrong subsystem. This module keeps that choice
 * pure, and exhaustive over `RuntimeState` at the type level so a new runtime
 * state cannot quietly inherit a cause it does not have.
 *
 * Copy selection only. It reads nothing, actuates nothing, and never changes
 * what `waitForReadyObservation` decides — only what the Human is told about a
 * decision the runtime already made.
 */

import { COPY, type ShuttleCopy } from "../shared/i18n";
// Type-only import: the carrier's state vocabulary has exactly one definition.
import type { RuntimeState } from "../content/runtime-observer";

/** The observation facts the start gate needs. Structural, so callers may pass a full CarrierObservation. */
export interface StartGateObservation {
  state: RuntimeState;
  carrierIdentityState: string;
}

/** Copy keys this gate may write — the plain-string entries, since some copy values are formatters. */
export type StartGateCopyKey = { [K in keyof ShuttleCopy]: ShuttleCopy[K] extends string ? K : never }[keyof ShuttleCopy];

/**
 * Which copy describes each runtime state a mounted carrier can hand the gate.
 *
 * The record is total over `RuntimeState`, so a state added to that union fails
 * to compile here until someone decides what the panel says about it. The
 * earlier runtime fallback could not do that: a new state silently inherited
 * "Carrier not READY", which is the same wrong-cause report #80 was about.
 */
const STATE_COPY_KEYS: Record<RuntimeState, StartGateCopyKey> = {
  // The gate gives up on its 6 s deadline, not on the carrier, so READY can
  // reach it: a carrier that turned READY in that tick is READY when the copy
  // is chosen. Nothing is wrong with it, so the panel reports no fault and
  // rests on the same neutral line the clear point writes once READY is seen.
  READY: "ready",
  GENERATING: "bcrCarrierGenerating",
  ATTACHING: "bcrCarrierStabilizing",
  STABILIZING: "bcrCarrierStabilizing",
  RECOVERING: "bcrCarrierStabilizing",
  // A hidden tab and a degraded provider DOM are not "still settling"; telling
  // the Human to wait again would be the same wrong-cause mistake in a new
  // dress, so both fall back to the honest carrier-state message.
  SUSPENDED: "bcrCarrierNotReady",
  BROKEN: "bcrCarrierNotReady"
};

/**
 * Every copy key that reports a start-gate failure, so a stale one stays
 * recognizable. `ready` is deliberately absent: it is the resting line, not a
 * report, and treating it as pending would re-render the panel every second.
 */
const START_GATE_FAILURE_COPY_KEYS: readonly StartGateCopyKey[] = [
  "bcrCarrierNotReady",
  "bcrCarrierGenerating",
  "bcrCarrierStabilizing"
];

/**
 * The copy key for a failed start. The carrier identity check comes first: an
 * unmounted carrier is the one case the original wording described correctly,
 * and it stays that way. An absent observation has no state to read — the wait
 * could not run — and reads the same as an unmounted carrier.
 *
 * Past that check the mapping is total over `RuntimeState`, so there is no
 * fallback branch left to swallow a state nobody decided about.
 */
export function bcrStartGateCopyKey(observation: StartGateObservation | null | undefined): StartGateCopyKey {
  if (!observation || observation.carrierIdentityState !== "browser-tab") return "bcrCarrierNotReady";
  return STATE_COPY_KEYS[observation.state];
}

export function bcrStartGateMessage(observation: StartGateObservation | null | undefined, copy: ShuttleCopy): string {
  return copy[bcrStartGateCopyKey(observation)];
}

/**
 * Erase a pending start-gate message once the carrier is READY again. The
 * failure text reports a moment that has passed; leaving it up is what made a
 * healthy carrier look broken. `copy.ready` is the neutral status line the
 * panel starts with (and the line a READY gate reads, see STATE_COPY_KEYS), so
 * the recovery reads as "no standing problem" rather than as a fresh claim
 * about the page.
 *
 * Returns true when the message was cleared and the caller should re-render.
 */
export function recoverStartGateMessage(
  viewState: { message: string },
  copy: ShuttleCopy,
  observation: StartGateObservation | null | undefined
): boolean {
  const pending = viewState.message;
  // Compare against every locale: the Human can switch language between the
  // failed click and the recovery, which would otherwise strand the stale text.
  const isStartGateMessage = Object.values(COPY).some(
    candidate => START_GATE_FAILURE_COPY_KEYS.some(key => pending === candidate[key])
  );
  if (!isStartGateMessage) return false;
  if (!observation || observation.state !== "READY" || observation.carrierIdentityState !== "browser-tab") return false;
  viewState.message = copy.ready;
  return true;
}
