import { describe, expect, it } from "vitest";
import {
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  type SubmissionAuthority,
  type SubmissionClaimContext,
  type SubmissionOperationState
} from "../src/core/submission-operation";

/**
 * `OUTBOX_MESSAGE` rides the existing `SubmissionOperation` ledger (issue #63
 * delta 1/2). These pin the two things that make it a specialization rather than
 * a new lane: it is one of the closed kinds everywhere the kind set is
 * validated, and its acceptance is proven by *its own bytes* — never by "some
 * new turn appeared".
 */

const PAYLOAD = "queued human message";
const FINGERPRINT = fingerprintSubmissionPayload(PAYLOAD);

function baseline() {
  return {
    conversationRef: "conversation:a",
    routeRef: "route:a",
    assistantMessageCount: 1,
    userMessageCount: 4,
    lastUserMessageFingerprint: "prior-user",
    lastAssistantMessageFingerprint: "a1",
    headFingerprint: "h1",
    observedAt: 1
  };
}

function context(overrides: Partial<SubmissionClaimContext> = {}): SubmissionClaimContext {
  return {
    logicalThreadId: "t1",
    providerConversationRef: "conversation:a",
    bindingEpoch: 1,
    leaseGeneration: 1,
    leaseOwnerRef: "owner-1",
    targetCarrierRef: "browser-tab:1",
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: 0,
    sourceObservedAt: 1,
    ...overrides
  };
}

function authority(value = context()): SubmissionAuthority {
  return { ...value, authorityGeneration: 1, authorityEstablishedAt: value.sourceObservedAt };
}

function memoryStore(authorityValue = authority()) {
  let value: unknown;
  return {
    get: async (_key?: string) => value,
    set: async (next: Record<string, unknown>) => { value = next; },
    getAuthority: async (logicalThreadId: string) => logicalThreadId === authorityValue.logicalThreadId ? authorityValue : undefined,
    ensureAuthority: async () => undefined
  };
}

function outboxInput(operationId: string, overrides: Record<string, unknown> = {}) {
  const fence = context();
  return {
    operationId,
    operationKind: "OUTBOX_MESSAGE" as const,
    workItemId: "shuttle-outbox",
    logicalThreadId: "t1",
    targetCarrierRef: "browser-tab:1",
    providerConversationRef: "conversation:a",
    dispatchFence: fence,
    payloadFingerprint: FINGERPRINT,
    payload: PAYLOAD,
    runId: "bcr-run-1",
    preSubmitBaseline: baseline(),
    ...overrides
  };
}

async function observed(ledger: SubmissionOperationLedger, operationId: string): Promise<SubmissionOperationState | undefined> {
  return (await ledger.get(operationId))?.state;
}

describe("OUTBOX_MESSAGE is a first-class SubmissionOperation kind", () => {
  it("prepares with a matching payload fingerprint and keeps its run attribution", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const prepared = await ledger.prepare(outboxInput("outbox-1"));
    expect(prepared.state).toBe("PREPARED");
    expect(prepared.operationKind).toBe("OUTBOX_MESSAGE");
    expect(prepared.runId).toBe("bcr-run-1");
    expect((await ledger.list())).toHaveLength(1);
  });

  it("refuses a payload whose fingerprint does not match, exactly as a GO does", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await expect(ledger.prepare(outboxInput("outbox-bad", { payload: "tampered" })))
      .rejects.toThrow("submission_prepare_invalid");
  });

  it("reports a reuse conflict when the payload moves under an operation id", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(outboxInput("outbox-reuse"));
    // Same identity, different bytes: the fingerprint of the frozen revision is
    // the operation's identity, so this must not silently become a new send.
    await expect(ledger.prepare(outboxInput("outbox-reuse", { payload: "edited after dispatch", payloadFingerprint: fingerprintSubmissionPayload("edited after dispatch") })))
      .rejects.toThrow("operation_id_reuse_conflict:outbox-reuse");
  });

  it("proves acceptance only when its own payload is the conversation's last user turn", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(outboxInput("outbox-accept"));
    await ledger.claim("outbox-accept", context(), 10);
    const result = await ledger.reconcile("outbox-accept", {
      ...baseline(),
      userMessageCount: 5,
      lastUserMessageFingerprint: FINGERPRINT,
      generationActive: true,
      observedAt: 20,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    // The ledger reports PROVEN_ACCEPTED here because the payload matched; the
    // item still only becomes DELIVERED on success-terminal evidence.
    expect(result.outcome).toBe("PROVEN_ACCEPTED");
    expect(result.operation?.acceptedPayloadFingerprint).toBe(FINGERPRINT);
    expect(result.operation?.state).toBe("OBSERVED_ACCEPTED");
  });

  /**
   * The counter-example the risk is about: a Human message landing instead of the
   * queued one must not read as this operation's acceptance. If it did, the
   * queue would claim a turn it never authored, and the Run's expected-turn
   * accounting would inherit that lie.
   */
  it("does not treat some other new user turn as acceptance", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(outboxInput("outbox-foreign"));
    await ledger.claim("outbox-foreign", context(), 10);
    const result = await ledger.reconcile("outbox-foreign", {
      ...baseline(),
      userMessageCount: 5,
      lastUserMessageFingerprint: fingerprintSubmissionPayload("a human typed this by hand"),
      generationActive: true,
      observedAt: 20,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    // Fail-closed, and visibly so: the operation parks as UNCERTAIN rather than
    // staying DISPATCHING, which is what suspends the queue head of line instead
    // of retrying behind an ambiguous send.
    expect(await observed(ledger, "outbox-foreign")).toBe("UNCERTAIN");
    expect((await ledger.get("outbox-foreign"))?.acceptedPayloadFingerprint).toBeUndefined();
  });

  it("requires the same payload fingerprint before it will record COMPLETED", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(outboxInput("outbox-complete"));
    await ledger.claim("outbox-complete", context(), 10);
    // A stable, finished turn whose last user message is somebody else's.
    const evidence = {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 5,
      lastUserMessageFingerprint: "someone-else",
      generationActive: false,
      stableSince: 15_000,
      observedAt: 25_000,
      sourceEpoch: 0,
      dispatchFence: context()
    };
    await ledger.reconcile("outbox-complete", evidence);
    expect(await observed(ledger, "outbox-complete")).not.toBe("OBSERVED_ACCEPTED");
    // The completion gate needs the payload fingerprint on the finishing
    // evidence, so a turn that is stable but not ours can never close this
    // operation — and therefore can never be counted as a delivery.
    await ledger.record("outbox-complete", "COMPLETED", { now: 26_000 });
    expect(await observed(ledger, "outbox-complete")).not.toBe("COMPLETED");
  });

  it("completes on its own accepted, finished turn", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(outboxInput("outbox-happy"));
    await ledger.claim("outbox-happy", context(), 10);
    await ledger.reconcile("outbox-happy", {
      ...baseline(),
      userMessageCount: 5,
      lastUserMessageFingerprint: FINGERPRINT,
      generationActive: true,
      observedAt: 20,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    await ledger.reconcile("outbox-happy", {
      ...baseline(),
      userMessageCount: 5,
      lastUserMessageFingerprint: FINGERPRINT,
      generationActive: false,
      stableSince: 15_000,
      observedAt: 30_000,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    const completed = await ledger.record("outbox-happy", "COMPLETED", { now: 31_000 });
    expect(completed?.state).toBe("COMPLETED");
  });
});
