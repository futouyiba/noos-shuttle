import { describe, expect, it } from "vitest";
import { COPY } from "../src/shared/i18n";
import type { ShuttleCopy } from "../src/shared/i18n";
import { bcrStartGateCopyKey, bcrStartGateMessage, recoverStartGateMessage, type StartGateObservation } from "../src/core/bcr-start-copy";

const MOUNTED = { carrierIdentityState: "browser-tab" as const };
const UNMOUNTED = { carrierIdentityState: "execution-local" as const };

/** A view state that has just been written by a failed start, for one locale. */
function failedViewState(copy: ShuttleCopy, observation: StartGateObservation | null) {
  return { message: bcrStartGateMessage(observation, copy) };
}

describe("bcrStartGateCopyKey", () => {
  // Acceptance 1: a generating provider must not be reported as a broken carrier.
  it("attributes GENERATING to the provider, not the carrier", () => {
    expect(bcrStartGateCopyKey({ ...MOUNTED, state: "GENERATING" })).toBe("bcrCarrierGenerating");
  });

  it("groups the settling states into one message", () => {
    for (const state of ["ATTACHING", "STABILIZING", "RECOVERING"]) {
      expect(bcrStartGateCopyKey({ ...MOUNTED, state }), state).toBe("bcrCarrierStabilizing");
    }
  });

  // Acceptance 3: the one case the original wording described correctly.
  it("keeps the carrier message for an unmounted carrier, whatever the state", () => {
    for (const state of ["READY", "GENERATING", "STABILIZING", "BROKEN", "ATTACHING", "RECOVERING", "SUSPENDED"]) {
      expect(bcrStartGateCopyKey({ ...UNMOUNTED, state }), state).toBe("bcrCarrierNotReady");
    }
    expect(bcrStartGateCopyKey(null)).toBe("bcrCarrierNotReady");
    expect(bcrStartGateCopyKey(undefined)).toBe("bcrCarrierNotReady");
  });

  it("does not claim a cause it cannot read", () => {
    // SUSPENDED (hidden tab) and BROKEN (degraded provider DOM) are not
    // "still settling"; an unknown future state must not be guessed either.
    for (const state of ["SUSPENDED", "BROKEN", "SOMETHING_NEW"]) {
      expect(bcrStartGateCopyKey({ ...MOUNTED, state }), state).toBe("bcrCarrierNotReady");
    }
  });

  it("maps every runtime state to a distinct-from-default copy where the issue asks for one", () => {
    expect(COPY.en.bcrCarrierGenerating).not.toBe(COPY.en.bcrCarrierNotReady);
    expect(COPY.en.bcrCarrierStabilizing).not.toBe(COPY.en.bcrCarrierNotReady);
    expect(COPY.zh.bcrCarrierGenerating).not.toBe(COPY.zh.bcrCarrierNotReady);
    expect(COPY.zh.bcrCarrierStabilizing).not.toBe(COPY.zh.bcrCarrierNotReady);
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
    for (const state of ["GENERATING", "STABILIZING", "ATTACHING", "RECOVERING", "BROKEN"]) {
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

  it("clears any start-gate copy key, not just the one this run would pick", () => {
    for (const copy of [COPY.en, COPY.zh]) {
      for (const key of ["bcrCarrierNotReady", "bcrCarrierGenerating", "bcrCarrierStabilizing"] as const) {
        const viewState = { message: copy[key] };
        expect(recoverStartGateMessage(viewState, copy, { ...MOUNTED, state: "READY" }), key).toBe(true);
      }
    }
  });
});
