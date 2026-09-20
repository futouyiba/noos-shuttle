import { describe, expect, it } from "vitest";
import { COPY } from "../src/shared/i18n";
import type { ShuttleCopy } from "../src/shared/i18n";
import type { RuntimeState } from "../src/content/runtime-observer";
import {
  bcrStartGateCopyKey,
  bcrStartGateMessage,
  recoverStartGateMessage,
  type StartGateCopyKey,
  type StartGateObservation
} from "../src/core/bcr-start-copy";

const MOUNTED = { carrierIdentityState: "browser-tab" as const };
const UNMOUNTED = { carrierIdentityState: "execution-local" as const };

/** A view state that has just been written by a failed start, for one locale. */
function failedViewState(copy: ShuttleCopy, observation: StartGateObservation | null) {
  return { message: bcrStartGateMessage(observation, copy) };
}

/**
 * What a mounted carrier's state must produce. The `Record<RuntimeState, …>` is
 * the type-exhaustive form of the runtime fallback the module used to carry: a
 * state added to `RuntimeState` stops this file from compiling until someone
 * says what the panel reports for it, instead of silently reading "Carrier not
 * READY".
 */
const MOUNTED_COPY: Record<RuntimeState, StartGateCopyKey> = {
  READY: "ready",
  GENERATING: "bcrCarrierGenerating",
  ATTACHING: "bcrCarrierStabilizing",
  STABILIZING: "bcrCarrierStabilizing",
  RECOVERING: "bcrCarrierStabilizing",
  SUSPENDED: "bcrCarrierNotReady",
  BROKEN: "bcrCarrierNotReady"
};

/** Every runtime state, read off the exhaustive table so the two cannot drift. */
const ALL_RUNTIME_STATES = Object.keys(MOUNTED_COPY) as RuntimeState[];

const FAILURE_COPY_KEYS = ["bcrCarrierNotReady", "bcrCarrierGenerating", "bcrCarrierStabilizing"] as const;

describe("bcrStartGateCopyKey", () => {
  // Acceptance 1: a generating provider must not be reported as a broken carrier.
  it("attributes GENERATING to the provider, not the carrier", () => {
    expect(bcrStartGateCopyKey({ ...MOUNTED, state: "GENERATING" })).toBe("bcrCarrierGenerating");
  });

  it("maps every runtime state to its declared copy", () => {
    for (const state of ALL_RUNTIME_STATES) {
      expect(bcrStartGateCopyKey({ ...MOUNTED, state }), state).toBe(MOUNTED_COPY[state]);
    }
    // The table is the whole union, not just the states a test happens to name.
    expect(ALL_RUNTIME_STATES).toHaveLength(7);
  });

  it("groups the settling states into one message", () => {
    for (const state of ["ATTACHING", "STABILIZING", "RECOVERING"] as const) {
      expect(bcrStartGateCopyKey({ ...MOUNTED, state }), state).toBe("bcrCarrierStabilizing");
    }
  });

  // The wait gives up on its 6 s deadline, not on the carrier, so a carrier that
  // turns READY in that tick reaches the gate with state READY. It used to fall
  // outside StartGateState and read "Carrier not READY" — a fault contradicted
  // by the very observation the copy was chosen from.
  it("reports no carrier fault when a READY observation reaches the gate", () => {
    const observation = { ...MOUNTED, state: "READY" } as const;
    expect(bcrStartGateCopyKey(observation)).toBe("ready");
    for (const locale of ["en", "zh"] as const) {
      const copy = COPY[locale];
      expect(bcrStartGateMessage(observation, copy)).toBe(copy.ready);
      for (const key of FAILURE_COPY_KEYS) {
        expect(bcrStartGateMessage(observation, copy), key).not.toBe(copy[key]);
      }
      // The resting line is not a pending failure report, so the clear point
      // leaves it alone instead of re-rendering the panel every second.
      const viewState = { message: copy.ready };
      expect(recoverStartGateMessage(viewState, copy, observation)).toBe(false);
      expect(viewState.message).toBe(copy.ready);
    }
  });

  // Acceptance 3: the one case the original wording described correctly.
  it("keeps the carrier message for an unmounted carrier, whatever the state", () => {
    for (const state of ALL_RUNTIME_STATES) {
      expect(bcrStartGateCopyKey({ ...UNMOUNTED, state }), state).toBe("bcrCarrierNotReady");
    }
    expect(bcrStartGateCopyKey(null)).toBe("bcrCarrierNotReady");
    expect(bcrStartGateCopyKey(undefined)).toBe("bcrCarrierNotReady");
  });

  it("does not claim a cause it cannot read", () => {
    // SUSPENDED (hidden tab) and BROKEN (degraded provider DOM) are not
    // "still settling"; the panel says what it sees and nothing more. An
    // undecided state has no route to that message any more: the mapping is
    // total over RuntimeState, so it fails to compile rather than fall back.
    for (const state of ["SUSPENDED", "BROKEN"] as const) {
      expect(bcrStartGateCopyKey({ ...MOUNTED, state }), state).toBe("bcrCarrierNotReady");
    }
  });

  it("keeps the failure copies distinct from the resting line", () => {
    for (const copy of [COPY.en, COPY.zh]) {
      for (const key of FAILURE_COPY_KEYS) {
        expect(copy[key], key).not.toBe(copy.ready);
      }
      expect(copy.bcrCarrierGenerating).not.toBe(copy.bcrCarrierNotReady);
      expect(copy.bcrCarrierStabilizing).not.toBe(copy.bcrCarrierNotReady);
    }
  });
});

describe("recoverStartGateMessage", () => {
  // Acceptance 2: the stale report must go away once the carrier is READY.
  it("clears a pending failure report once the carrier is READY", () => {
    const viewState = failedViewState(COPY.zh, { ...MOUNTED, state: "GENERATING" });
    const cleared = recoverStartGateMessage(viewState, COPY.zh, { ...MOUNTED, state: "READY" });
    expect(cleared).toBe(true);
    expect(viewState.message).toBe(COPY.zh.ready);
  });

  it("clears the unmounted-carrier report too", () => {
    const viewState = failedViewState(COPY.en, { ...UNMOUNTED, state: "READY" });
    expect(viewState.message).toBe(COPY.en.bcrCarrierNotReady);
    expect(recoverStartGateMessage(viewState, COPY.en, { ...MOUNTED, state: "READY" })).toBe(true);
    expect(viewState.message).toBe(COPY.en.ready);
  });

  it("keeps the report while the carrier is still not READY", () => {
    for (const state of ["GENERATING", "STABILIZING", "ATTACHING", "RECOVERING", "BROKEN"] as const) {
      const viewState = failedViewState(COPY.en, { ...MOUNTED, state: "GENERATING" });
      expect(recoverStartGateMessage(viewState, COPY.en, { ...MOUNTED, state }), state).toBe(false);
      expect(viewState.message, state).toBe(COPY.en.bcrCarrierGenerating);
    }
    const gone = failedViewState(COPY.en, null);
    expect(gone.message).toBe(COPY.en.bcrCarrierNotReady);
    expect(recoverStartGateMessage(gone, COPY.en, null)).toBe(false);
    expect(gone.message).toBe(COPY.en.bcrCarrierNotReady);
  });

  it("leaves unrelated status messages alone", () => {
    for (const message of [COPY.en.ready, COPY.zh.bcrStartFailed, "Run 请求被拒绝: whatever", COPY.en.bcrSyncFailed]) {
      const viewState = { message };
      expect(recoverStartGateMessage(viewState, COPY.en, { ...MOUNTED, state: "READY" }), message).toBe(false);
      expect(viewState.message, message).toBe(message);
    }
  });

  it("still recognises a report written in the other locale", () => {
    // The Human can switch language between the failed click and the recovery.
    const viewState = { message: COPY.zh.bcrCarrierStabilizing };
    expect(recoverStartGateMessage(viewState, COPY.en, { ...MOUNTED, state: "READY" })).toBe(true);
    expect(viewState.message).toBe(COPY.en.ready);
  });

  it("clears any start-gate failure copy key, not just the one this run would pick", () => {
    for (const copy of [COPY.en, COPY.zh]) {
      for (const key of FAILURE_COPY_KEYS) {
        const viewState = { message: copy[key] };
        expect(recoverStartGateMessage(viewState, copy, { ...MOUNTED, state: "READY" }), key).toBe(true);
      }
    }
  });
});
