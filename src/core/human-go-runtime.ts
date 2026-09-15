import {
  type SubmissionBaseline,
  type SubmissionClaimContext,
  type SubmissionDispatchFence,
  type SubmissionObservation,
  type SubmissionOperation,
  type SubmissionReconcileResult
} from "./submission-operation";
import type { SubmissionOperationLedger } from "./submission-operation";

export interface HumanGoCarrierSnapshot extends Omit<SubmissionClaimContext, "carrierState" | "logicalControl" | "explicitGo"> {
  carrierState: "READY" | "ATTACHING" | "STABILIZING" | "GENERATING" | "BROKEN";
  logicalControl: "CONTINUE" | "WAIT";
  explicitGo: boolean;
}

export interface HumanGoRequest {
  operationId: string;
  workItemId: string;
  logicalThreadId: string;
  payload: string;
  payloadFingerprint: string;
  preSubmitBaseline: SubmissionBaseline;
  providerConversationRef: string;
  targetCarrierRef: string;
  bindingEpoch: number;
  leaseGeneration: number;
  leaseOwnerRef: string;
  explicitGo: boolean;
  sourceEpoch: number;
  sourceObservedAt: number;
  now?: number;
}

export type HumanGoResult =
  | { status: "DISPATCHED"; operation: SubmissionOperation }
  | { status: "BLOCKED"; reason: "carrier_not_ready" | "control_not_continue" | "identity_missing" | "fence_mismatch" | "unresolved_operation" | "claim_lost" }
  | { status: "UNCERTAIN"; operation: SubmissionOperation };

export interface HumanGoRuntimeOptions {
  readCurrentCarrier: () => Promise<HumanGoCarrierSnapshot>;
  dispatch: (payload: string, fence: SubmissionDispatchFence) => Promise<void>;
}

export interface HumanGoLedger {
  initializeAuthority(context: SubmissionClaimContext): Promise<void>;
  prepare(input: Parameters<SubmissionOperationLedger["prepare"]>[0]): Promise<SubmissionOperation>;
  claim(operationId: string, context: SubmissionClaimContext, now?: number): Promise<SubmissionOperation | undefined>;
  get(operationId: string): Promise<SubmissionOperation | undefined>;
  record(operationId: string, state: "DISPATCHING" | "COMPLETED" | "UNCERTAIN" | "CANCELLED", details?: Parameters<SubmissionOperationLedger["record"]>[2]): Promise<SubmissionOperation | undefined>;
  reconcile(operationId: string, observation: SubmissionObservation): Promise<SubmissionReconcileResult>;
}

export class HumanGoRuntime {
  constructor(
    private readonly ledger: HumanGoLedger,
    private readonly options: HumanGoRuntimeOptions
  ) {}

  async execute(request: HumanGoRequest): Promise<HumanGoResult> {
    if (!request.explicitGo || !request.operationId) return { status: "BLOCKED", reason: "claim_lost" };
    const carrier = await this.options.readCurrentCarrier();
    const context = createClaimContext(request);
    if (carrier.carrierState !== "READY") return { status: "BLOCKED", reason: "carrier_not_ready" };
    if (carrier.logicalControl !== "CONTINUE") return { status: "BLOCKED", reason: "control_not_continue" };
    if (!carrier.explicitGo) return { status: "BLOCKED", reason: "claim_lost" };
    if (!carrier.providerConversationRef || !request.providerConversationRef) return { status: "BLOCKED", reason: "identity_missing" };
    if (!sameFence(carrier, context)) return { status: "BLOCKED", reason: "fence_mismatch" };

    await this.ledger.initializeAuthority(context);
    const prepared = await this.ledger.prepare({
      operationId: request.operationId,
      operationKind: "GO",
      workItemId: request.workItemId,
      logicalThreadId: request.logicalThreadId,
      targetCarrierRef: request.targetCarrierRef,
      providerConversationRef: request.providerConversationRef,
      dispatchFence: context,
      payloadFingerprint: request.payloadFingerprint,
      payload: request.payload,
      preSubmitBaseline: request.preSubmitBaseline,
      now: request.now
    });
    const current = await this.options.readCurrentCarrier();
    if (!sameCurrentCarrier(current, context)) {
      return { status: "BLOCKED", reason: "fence_mismatch" };
    }
    const claimed = await this.ledger.claim(prepared.operationId, context, request.now);
    if (!claimed) {
      const existing = await this.ledger.get(prepared.operationId);
      return existing?.state === "DISPATCHING" || existing?.state === "UNCERTAIN"
        ? { status: "UNCERTAIN", operation: existing }
        : { status: "BLOCKED", reason: "claim_lost" };
    }
    try {
      await this.options.dispatch(request.payload, context);
      const attemptedAt = Date.now();
      const recorded = await this.recordDispatchReceipt(claimed, context, attemptedAt);
      const recovered = recorded ?? await this.ledger.get(claimed.operationId);
      if (recovered?.dispatchReceipt?.outcome === "dispatched") {
        return { status: "DISPATCHED", operation: recovered };
      }
      const uncertain = await this.recordUncertain(claimed.operationId, attemptedAt);
      return { status: "UNCERTAIN", operation: uncertain ?? recovered ?? claimed };
    } catch {
      let uncertain = await this.recordUncertain(claimed.operationId, request.now);
      if (!uncertain) {
        // A worker may have committed the transition and lost only its response.
        // Retrying the idempotent record lets the caller recover that durable
        // UNCERTAIN state without ever attempting provider dispatch again.
        uncertain = await this.recordUncertain(claimed.operationId, request.now);
      }
      uncertain ??= await this.ledger.get(claimed.operationId);
      return uncertain ? { status: "UNCERTAIN", operation: uncertain } : { status: "UNCERTAIN", operation: claimed };
    }
  }

  private async recordUncertain(operationId: string, now?: number): Promise<SubmissionOperation | undefined> {
    try {
      return await this.ledger.record(operationId, "UNCERTAIN", { now });
    } catch {
      return undefined;
    }
  }

  private async recordDispatchReceipt(
    operation: SubmissionOperation,
    fence: SubmissionDispatchFence,
    attemptedAt: number
  ): Promise<SubmissionOperation | undefined> {
    const claimedAt = operation.dispatchClaimedAt ?? attemptedAt;
    const details = {
      now: attemptedAt,
      dispatchReceipt: { claimedAt, attemptedAt, outcome: "dispatched" as const, fence }
    };
    try {
      const recorded = await this.ledger.record(operation.operationId, "DISPATCHING", details);
      if (recorded?.dispatchReceipt?.outcome === "dispatched") return recorded;
    } catch {
      // A lost worker response is recovered by the idempotent retry below.
    }
    try {
      const retried = await this.ledger.record(operation.operationId, "DISPATCHING", details);
      return retried?.dispatchReceipt?.outcome === "dispatched" ? retried : undefined;
    } catch {
      return undefined;
    }
  }

  async reconcile(operationId: string, observation: SubmissionObservation): Promise<SubmissionReconcileResult> {
    return this.ledger.reconcile(operationId, observation);
  }
}

function createClaimContext(request: HumanGoRequest): SubmissionClaimContext {
  return {
    logicalThreadId: request.logicalThreadId,
    providerConversationRef: request.providerConversationRef,
    bindingEpoch: request.bindingEpoch,
    leaseGeneration: request.leaseGeneration,
    leaseOwnerRef: request.leaseOwnerRef,
    targetCarrierRef: request.targetCarrierRef,
    sourceEpoch: request.sourceEpoch,
    sourceObservedAt: request.sourceObservedAt,
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true
  };
}

function sameFence(left: Pick<HumanGoCarrierSnapshot, "providerConversationRef" | "bindingEpoch" | "leaseGeneration" | "leaseOwnerRef" | "targetCarrierRef" | "explicitGo" | "carrierState" | "logicalControl">, right: SubmissionClaimContext): boolean {
  return left.providerConversationRef === right.providerConversationRef &&
    left.bindingEpoch === right.bindingEpoch &&
    left.leaseGeneration === right.leaseGeneration &&
    left.leaseOwnerRef === right.leaseOwnerRef &&
    left.targetCarrierRef === right.targetCarrierRef &&
    left.explicitGo === right.explicitGo &&
    left.carrierState === right.carrierState &&
    left.logicalControl === right.logicalControl;
}

function sameCurrentCarrier(carrier: HumanGoCarrierSnapshot, context: SubmissionClaimContext): boolean {
  return sameFence(carrier, context) && carrier.sourceEpoch === context.sourceEpoch;
}
