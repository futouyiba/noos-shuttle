/**
 * Bounded Continuation Run start-gate copy (issue #80).
 *
 * Starting a run waits for a READY carrier observation. When that wait times
 * out the panel used to say "Carrier not READY" no matter why: a provider that
 * was merely mid-generation read the same as a carrier that was never mounted,
 * so the message blamed the wrong subsystem. This module keeps that choice
 * pure and exhaustive over the observed runtime state.
 *
 * Copy selection only. It reads nothing, actuates nothing, and never changes
 * what `waitForReadyObservation` decides — only what the Human is told about a
 * decision the runtime already made.
 */

import { COPY, type ShuttleCopy } from "../shared/i18n";

/** The observation facts the start gate needs. Structural, so callers may pass a full CarrierObservation. */
export interface StartGateObservation {
  state: string;
  carrierIdentityState: string;
}

/** A state in which the carrier is mounted. READY never reaches the gate: the wait would have succeeded. */
export type StartGateState = "ATTACHING" | "GENERATING" | "STABILIZING" | "SUSPENDED" | "BROKEN" | "RECOVERING";

/** Copy keys this gate may write — the plain-string entries, since some copy values are formatters. */
type StartGateCopyKey = { [K in keyof ShuttleCopy]: ShuttleCopy[K] extends string ? K : never }[keyof ShuttleCopy];

/** Which copy describes each un-READY runtime state. */
const STATE_COPY_KEYS: Record<StartGateState, StartGateCopyKey> = {
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

/** Every copy key the start gate can write, so a stale one stays recognizable. */
const START_GATE_COPY_KEYS: readonly StartGateCopyKey[] = [
  "bcrCarrierNotReady",
  "bcrCarrierGenerating",
  "bcrCarrierStabilizing"
];

function isStartGateState(state: string): state is StartGateState {
  return Object.prototype.hasOwnProperty.call(STATE_COPY_KEYS, state);
}

/**
 * The copy key for a failed start. The carrier identity check comes first: an
 * unmounted carrier is the one case the original wording described correctly,
 * and it stays that way. An absent observation has no state to read — the wait
 * could not run — and reads the same as an unmounted carrier.
 */
export function bcrStartGateCopyKey(observation: StartGateObservation | null | undefined): StartGateCopyKey {
  if (!observation || observation.carrierIdentityState !== "browser-tab") return "bcrCarrierNotReady";
  return isStartGateState(observation.state) ? STATE_COPY_KEYS[observation.state] : "bcrCarrierNotReady";
}

export function bcrStartGateMessage(observation: StartGateObservation | null | undefined, copy: ShuttleCopy): string {
  return copy[bcrStartGateCopyKey(observation)];
}

/**
 * Erase a pending start-gate message once the carrier is READY again. The
 * failure text reports a moment that has passed; leaving it up is what made a
 * healthy carrier look broken. `copy.ready` is the neutral status line the
 * panel starts with, so the recovery reads as "no standing problem" rather
 * than as a fresh claim about the page.
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
    candidate => START_GATE_COPY_KEYS.some(key => pending === candidate[key])
  );
  if (!isStartGateMessage) return false;
  if (!observation || observation.state !== "READY" || observation.carrierIdentityState !== "browser-tab") return false;
  viewState.message = copy.ready;
  return true;
}
