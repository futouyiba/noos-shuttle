import { describe, expect, it } from "vitest";
import { evaluateAuthorityLoss, type AuthorityLossInput } from "../src/content/submission-authority-loss";

const run = (over: Partial<{ status: string; pendingSubmissionOperationId?: string; logicalThreadId: string }> = {}) =>
  ({ status: "ACTIVE", pendingSubmissionOperationId: "go-1", logicalThreadId: "t1", ...over });
const active = (over: Partial<{ operationId: string; logicalThreadId: string }> = {}) =>
  ({ operationId: "go-1", logicalThreadId: "t1", ...over });
const observe = (over: Partial<AuthorityLossInput> = {}) => evaluateAuthorityLoss({
  authority: "SUPERSEDED",
  sameFence: true,
  now: 5_000,
  windowMs: 2_000,
  since: null,
  active: active(),
  run: run(),
  ...over
});

describe("evaluateAuthorityLoss", () => {
  it("does not fire on the first sighting but starts the window", () => {
    expect(observe()).toEqual({ since: 5_000, fire: false });
  });

  it("fires exactly once, only after the window has elapsed", () => {
    expect(observe({ since: 5_000, now: 6_999 })).toEqual({ since: 5_000, fire: false });
    expect(observe({ since: 5_000, now: 7_000 })).toEqual({ since: null, fire: true });
  });

  it("abandons the window as soon as the diagnosis stops holding", () => {
    expect(observe({ since: 5_000, now: 6_000, authority: "OK" })).toEqual({ since: null, fire: false });
    expect(observe({ since: 5_000, now: 6_000, authority: undefined })).toEqual({ since: null, fire: false });
  });

  it("never fires on ABSENT, which has no true-positive producer", () => {
    expect(observe({ authority: "ABSENT", since: 0, now: 1_000_000 })).toEqual({ since: null, fire: false });
  });

  it("never fires when the durable fence was re-fenced under this page", () => {
    // A sibling tab on the same conversation re-fenced the operation through
    // recover, so nothing was lost: the sibling is its actuator now, and the
    // Run it is driving is still valid.
    expect(observe({ since: 0, now: 1_000_000, sameFence: false })).toEqual({ since: null, fire: false });
  });

  it("suppresses rather than fires when the fence verdict is missing", () => {
    expect(observe({ since: 0, now: 1_000_000, sameFence: undefined })).toEqual({ since: null, fire: false });
  });

  it("requires the diagnosed operation to be the Run's pending one", () => {
    expect(observe({ since: 0, now: 1_000_000, run: run({ pendingSubmissionOperationId: "other" }) }).fire).toBe(false);
    expect(observe({ since: 0, now: 1_000_000, run: run({ pendingSubmissionOperationId: undefined }) }).fire).toBe(false);
    expect(observe({ since: 0, now: 1_000_000, active: active({ operationId: "other" }) }).fire).toBe(false);
  });

  it("requires the superseded slot to be the Run's own thread", () => {
    expect(observe({ since: 0, now: 1_000_000, active: active({ logicalThreadId: "t2" }) }).fire).toBe(false);
    expect(observe({ since: 0, now: 1_000_000, run: run({ logicalThreadId: "t2" }) }).fire).toBe(false);
  });

  it("never fires for a terminal Run, a missing Run, or no active submission", () => {
    for (const status of ["ENDED", "CANCELLED", "FAILED_SAFE"]) {
      expect(observe({ since: 0, now: 1_000_000, run: run({ status }) }).fire).toBe(false);
    }
    expect(observe({ since: 0, now: 1_000_000, run: null }).fire).toBe(false);
    expect(observe({ since: 0, now: 1_000_000, active: null }).fire).toBe(false);
  });
});
