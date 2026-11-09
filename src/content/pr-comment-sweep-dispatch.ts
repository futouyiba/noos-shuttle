/**
 * PR_COMMENT_SWEEP transport composer (issue #61 slice 5, per the adjudicated
 * proposal §7 slice 5 and §6 Q2/Q3).
 *
 * Same shape as `sediment-dispatch.ts` and `overview-html-dispatch.ts`: a
 * kind-specialised composer modelled on `deliver-child-result.ts`. It owns the
 * `PR_COMMENT_SWEEP` ledger identity and reuses `HumanGoRuntime` as the shared
 * prepare/claim/receipt/reconcile engine, so authority, fence and exactly-once
 * invariants are unchanged. It adds no guard, no retry and no fallback: a
 * `BLOCKED` / `REFUSED` / `UNCERTAIN` result is returned to the caller as is.
 *
 * Type-only imports from `submission-operation` on purpose: the content entry
 * must not bundle the ledger value module, or Rollup promotes it to a shared
 * chunk an MV3 classic content script cannot load (see `sediment-dispatch.ts`).
 */
import type { SubmissionBaseline, SubmissionDispatchFence } from "../core/submission-operation";
import {
  HumanGoRuntime,
  type HumanGoCarrierSnapshot,
  type HumanGoLedger,
  type HumanGoResult
} from "../core/human-go-runtime";
import { shortcutPayloadDefinition } from "../core/continuation-payload";

/** The five authority fields plus the two claim-time readings. */
export interface PrCommentSweepCarrierFence {
  providerConversationRef: string;
  targetCarrierRef: string;
  bindingEpoch: number;
  leaseGeneration: number;
  leaseOwnerRef: string;
  sourceEpoch: number;
  sourceObservedAt: number;
}

export interface PrCommentSweepDispatchRequest {
  operationId: string;
  /** Exact provider-facing bytes built from the canonical `PR_COMMENT_SWEEP` definition. */
  payload: string;
  /** Fingerprint of those exact bytes; acceptance matches on the dispatched payload. */
  payloadFingerprint: string;
  preSubmitBaseline: SubmissionBaseline;
  carrier: PrCommentSweepCarrierFence;
  now?: number;
}

export interface PrCommentSweepDispatchDeps {
  /** The carrier's own ledger instance. Supplied by the caller, never built here. */
  ledger: HumanGoLedger;
  readCurrentCarrier: () => Promise<HumanGoCarrierSnapshot>;
  dispatch: (payload: string, fence: SubmissionDispatchFence) => Promise<void>;
}

/**
 * Dispatch one PR comment sweep and return the governed result unchanged. The
 * caller decides what to do with `BLOCKED` / `REFUSED` / `UNCERTAIN`; this
 * composer never retries, never falls back to `GO`, and never bypasses the
 * ledger.
 */
export async function dispatchPrCommentSweep(
  request: PrCommentSweepDispatchRequest,
  deps: PrCommentSweepDispatchDeps
): Promise<HumanGoResult> {
  const { workItemId } = shortcutPayloadDefinition("PR_COMMENT_SWEEP");
  const runtime = new HumanGoRuntime(deps.ledger, {
    readCurrentCarrier: deps.readCurrentCarrier,
    dispatch: deps.dispatch
  });
  return runtime.execute({
    operationId: request.operationId,
    operationKind: "PR_COMMENT_SWEEP",
    workItemId,
    logicalThreadId: `thread:${request.carrier.providerConversationRef}`,
    payload: request.payload,
    payloadFingerprint: request.payloadFingerprint,
    preSubmitBaseline: request.preSubmitBaseline,
    providerConversationRef: request.carrier.providerConversationRef,
    targetCarrierRef: request.carrier.targetCarrierRef,
    bindingEpoch: request.carrier.bindingEpoch,
    leaseGeneration: request.carrier.leaseGeneration,
    leaseOwnerRef: request.carrier.leaseOwnerRef,
    explicitGo: true,
    sourceEpoch: request.carrier.sourceEpoch,
    sourceObservedAt: request.carrier.sourceObservedAt,
    now: request.now
  });
}
