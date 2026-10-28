import { describe, expect, it } from "vitest";
import {
  isSubmissionFence,
  selectCompletedSubmissionToConverge,
  selectNotAcceptedSubmissionToConverge,
  selectPendingSubmissionOnCarrierReplacement,
  type SubmissionCompletionObservation,
  type SubmissionCompletionRecord,
  type SubmissionCompletionRun,
  type SubmissionRebindObservation
} from "../src/content/submission-completion-convergence";

const fence = (over: Record<string, unknown> = {}) => ({
  providerConversationRef: "conv-1",
  bindingEpoch: 7,
  leaseGeneration: 3,
  leaseOwnerRef: "observer-1",
  targetCarrierRef: "carrier-1",
  ...over
});
const operation = (over: Partial<SubmissionCompletionRecord> = {}): SubmissionCompletionRecord => ({
  operationId: "go-1",
  state: "COMPLETED",
  targetCarrierRef: "carrier-1",
  providerConversationRef: "conv-1",
  dispatchFence: fence(),
  ...over
});
const run = (over: Partial<SubmissionCompletionRun> = {}): SubmissionCompletionRun => ({
  status: "ACTIVE",
  providerConversationRef: "conv-1",
  pendingSubmissionOperationId: "go-1",
  ...over
});
const observation = (over: Partial<SubmissionCompletionObservation> = {}): SubmissionCompletionObservation =>
  ({ carrierRef: "carrier-1", providerConversationRef: "conv-1", ...over });
const select = (over: Partial<Parameters<typeof selectCompletedSubmissionToConverge>[0]> = {}) =>
  selectCompletedSubmissionToConverge({
    operations: [operation()],
    observation: observation(),
    run: run(),
    ...over
  });

describe("selectCompletedSubmissionToConverge", () => {
  it("converges the operation the run still records as pending", () => {
    expect(select()).toEqual({ operationId: "go-1" });
  });

  it("selects by the run's pending id rather than by position or recency", () => {
    const pending = operation({ operationId: "go-1" });
    // The run already applied this one; a later round's completion is not its
    // pending operation, and converging it would decide the wrong round.
    const alreadyApplied = operation({ operationId: "go-2" });
    expect(select({ operations: [alreadyApplied, pending] })).toEqual({ operationId: "go-1" });
    expect(select({ operations: [alreadyApplied, pending], run: run({ pendingSubmissionOperationId: "go-2" }) }))
      .toEqual({ operationId: "go-2" });
    expect(select({ operations: [alreadyApplied, pending], run: run({ pendingSubmissionOperationId: "go-3" }) })).toBeNull();
  });

  it("does not converge once the run has applied the completion", () => {
    expect(select({ run: run({ pendingSubmissionOperationId: undefined }) })).toBeNull();
  });

  it("does not converge a missing or terminal run", () => {
    expect(select({ run: null })).toBeNull();
    for (const status of ["ENDED", "CANCELLED", "FAILED_SAFE"]) {
      expect(select({ run: run({ status }) })).toBeNull();
    }
  });

  it("does not converge a non-COMPLETED operation", () => {
    for (const state of ["PREPARED", "DISPATCHING", "OBSERVED_ACCEPTED", "UNCERTAIN", "FAILED_SAFE", "CANCELLED"]) {
      // COMPLETED is the only acceptance evidence this selector may act on. A
      // FAILED_SAFE operation is terminal too, but it is the *opposite*
      // evidence and is decided by the not-accepted selector below.
      expect(select({ operations: [operation({ state })] })).toBeNull();
    }
  });

  it("does not converge when the pending id names no durable operation", () => {
    expect(select({ operations: [], run: run({ pendingSubmissionOperationId: "go-9" }) })).toBeNull();
  });

  it("does not converge across conversations or carriers", () => {
    expect(select({ run: run({ providerConversationRef: "conv-2" }) })).toBeNull();
    expect(select({ observation: observation({ providerConversationRef: "conv-2" }) })).toBeNull();
    expect(select({ operations: [operation({ providerConversationRef: "conv-2" })] })).toBeNull();
    expect(select({ observation: observation({ providerConversationRef: undefined }) })).toBeNull();
    expect(select({ observation: observation({ carrierRef: "carrier-2" }) })).toBeNull();
    expect(select({ operations: [operation({ targetCarrierRef: "carrier-2" })] })).toBeNull();
  });

  it("requires a structurally valid fence on the completed operation", () => {
    expect(select({ operations: [operation({ dispatchFence: undefined })] })).toBeNull();
    expect(select({ operations: [operation({ dispatchFence: fence({ leaseOwnerRef: 1 }) })] })).toBeNull();
    expect(select({ operations: [operation({ dispatchFence: {} })] })).toBeNull();
  });
});

describe("selectNotAcceptedSubmissionToConverge", () => {
  const notAccepted = (over: Partial<SubmissionCompletionRecord> = {}) => operation({ state: "FAILED_SAFE", ...over });
  const selectFailed = (over: Partial<Parameters<typeof selectNotAcceptedSubmissionToConverge>[0]> = {}) =>
    selectNotAcceptedSubmissionToConverge({
      operations: [notAccepted()],
      observation: observation(),
      run: run(),
      ...over
    });

  it("converges the run's own pending operation once the ledger proved the GO was not accepted", () => {
    expect(selectFailed()).toEqual({ operationId: "go-1" });
  });

  it("selects by the run's pending id, never by recency", () => {
    const pending = notAccepted({ operationId: "go-1" });
    const unrelated = notAccepted({ operationId: "go-2" });
    expect(selectFailed({ operations: [unrelated, pending] })).toEqual({ operationId: "go-1" });
    expect(selectFailed({ operations: [unrelated, pending], run: run({ pendingSubmissionOperationId: "go-3" }) })).toBeNull();
  });

  it("never converges an accepted or still-in-flight operation", () => {
    for (const state of ["PREPARED", "DISPATCHING", "OBSERVED_ACCEPTED", "COMPLETED", "UNCERTAIN", "CANCELLED"]) {
      expect(selectFailed({ operations: [notAccepted({ state })] })).toBeNull();
    }
  });

  it("does not converge a missing, ended, or already-applied run", () => {
    expect(selectFailed({ run: null })).toBeNull();
    for (const status of ["ENDED", "CANCELLED", "FAILED_SAFE"]) {
      expect(selectFailed({ run: run({ status }) })).toBeNull();
    }
    expect(selectFailed({ run: run({ pendingSubmissionOperationId: undefined }) })).toBeNull();
  });

  it("stays scoped to the watched carrier and conversation", () => {
    expect(selectFailed({ run: run({ providerConversationRef: "conv-2" }) })).toBeNull();
    expect(selectFailed({ observation: observation({ providerConversationRef: undefined }) })).toBeNull();
    expect(selectFailed({ operations: [notAccepted({ providerConversationRef: "conv-2" })] })).toBeNull();
    expect(selectFailed({ observation: observation({ carrierRef: "carrier-2" }) })).toBeNull();
    expect(selectFailed({ operations: [notAccepted({ targetCarrierRef: "carrier-2" })] })).toBeNull();
  });

  it("requires a structurally valid fence", () => {
    expect(selectFailed({ operations: [notAccepted({ dispatchFence: undefined })] })).toBeNull();
    expect(selectFailed({ operations: [notAccepted({ dispatchFence: fence({ targetCarrierRef: 3 }) })] })).toBeNull();
  });

  it("does not converge a FAILED_SAFE operation that is not the pending one", () => {
    expect(selectFailed({ operations: [], run: run({ pendingSubmissionOperationId: "go-9" }) })).toBeNull();
  });
});

describe("isSubmissionFence", () => {
  it("accepts a complete fence and rejects an incomplete or mistyped one", () => {
    expect(isSubmissionFence(fence())).toBe(true);
    expect(isSubmissionFence({ ...fence(), bindingEpoch: undefined })).toBe(false);
    expect(isSubmissionFence({ ...fence(), providerConversationRef: 2 })).toBe(false);
    expect(isSubmissionFence(null)).toBe(false);
    expect(isSubmissionFence("carrier-1")).toBe(false);
  });
});

describe("selectPendingSubmissionOnCarrierReplacement", () => {
  // The operation was dispatched by another execution: a different carrier, or
  // the same tab reloaded into a new document.
  const replaced = (over: Partial<SubmissionRebindObservation> = {}): SubmissionRebindObservation => ({
    carrierRef: "carrier-2",
    executionInstanceRef: "observer-2",
    providerConversationRef: "conv-1",
    ...over
  });
  const selectRebind = (over: {
    operations?: SubmissionCompletionRecord[];
    observation?: SubmissionRebindObservation;
    run?: SubmissionCompletionRun | null;
  } = {}) => selectPendingSubmissionOnCarrierReplacement({
    operations: over.operations ?? [operation()],
    observation: over.observation ?? replaced(),
    run: over.run === undefined ? run() : over.run
  });

  it("continues the run on a durably COMPLETED round", () => {
    expect(selectRebind()).toEqual({ operationId: "go-1", state: "COMPLETED" });
  });

  it("ends the run on a durably FAILED_SAFE round, never as acceptance", () => {
    expect(selectRebind({ operations: [operation({ state: "FAILED_SAFE" })] }))
      .toEqual({ operationId: "go-1", state: "NOT_ACCEPTED" });
  });

  it("settles every unprovable acceptance state as UNCERTAIN", () => {
    for (const state of ["DISPATCHING", "UNCERTAIN", "OBSERVED_ACCEPTED", "PREPARED", "CANCELLED"]) {
      expect(selectRebind({ operations: [operation({ state })] }))
        .toEqual({ operationId: "go-1", state: "UNCERTAIN" });
    }
  });

  it("treats a missing record or unreadable fence as UNCERTAIN rather than non-acceptance", () => {
    expect(selectRebind({ operations: [] })).toEqual({ operationId: "go-1", state: "UNCERTAIN" });
    expect(selectRebind({ operations: [operation({ dispatchFence: undefined })] }))
      .toEqual({ operationId: "go-1", state: "UNCERTAIN" });
    expect(selectRebind({ operations: [operation({ providerConversationRef: "conv-2" })] }))
      .toEqual({ operationId: "go-1", state: "UNCERTAIN" });
    expect(selectRebind({ operations: [operation({ dispatchFence: fence({ providerConversationRef: "conv-2" }) })] }))
      .toEqual({ operationId: "go-1", state: "UNCERTAIN" });
  });

  it("leaves a round its own execution dispatched to the ordinary lanes", () => {
    // Same carrier and same execution instance: recovery may still own it, so
    // this selector must not decide it.
    expect(selectRebind({
      observation: replaced({ carrierRef: "carrier-1", executionInstanceRef: "observer-1" })
    })).toBeNull();
  });

  it("applies after a reload of the same tab (new document, same carrier)", () => {
    expect(selectRebind({
      observation: replaced({ carrierRef: "carrier-1", executionInstanceRef: "observer-2" })
    })).toEqual({ operationId: "go-1", state: "COMPLETED" });
  });

  it("stays scoped to the run's own pending operation and conversation", () => {
    expect(selectRebind({ run: null })).toBeNull();
    for (const status of ["ENDED", "CANCELLED", "FAILED_SAFE"]) {
      expect(selectRebind({ run: run({ status }) })).toBeNull();
    }
    expect(selectRebind({ run: run({ pendingSubmissionOperationId: undefined }) })).toBeNull();
    expect(selectRebind({ run: run({ providerConversationRef: "conv-2" }) })).toBeNull();
    expect(selectRebind({ observation: replaced({ providerConversationRef: undefined }) })).toBeNull();
    // Only the pending id may be decided; a completed sibling is not this round.
    expect(selectRebind({
      operations: [operation({ operationId: "go-2" })],
      run: run({ pendingSubmissionOperationId: "go-2" })
    })).toEqual({ operationId: "go-2", state: "COMPLETED" });
    expect(selectRebind({
      operations: [operation({ operationId: "go-2", state: "FAILED_SAFE" })],
      run: run({ pendingSubmissionOperationId: "go-3" })
    })).toEqual({ operationId: "go-3", state: "UNCERTAIN" });
  });
});
