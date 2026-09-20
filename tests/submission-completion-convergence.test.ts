import { describe, expect, it } from "vitest";
import {
  isSubmissionFence,
  selectCompletedSubmissionToConverge,
  type SubmissionCompletionObservation,
  type SubmissionCompletionRecord,
  type SubmissionCompletionRun
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
      // These still own execution, so live recovery stays responsible for them.
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

describe("isSubmissionFence", () => {
  it("accepts a complete fence and rejects an incomplete or mistyped one", () => {
    expect(isSubmissionFence(fence())).toBe(true);
    expect(isSubmissionFence({ ...fence(), bindingEpoch: undefined })).toBe(false);
    expect(isSubmissionFence({ ...fence(), providerConversationRef: 2 })).toBe(false);
    expect(isSubmissionFence(null)).toBe(false);
    expect(isSubmissionFence("carrier-1")).toBe(false);
  });
});
