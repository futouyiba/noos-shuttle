/**
 * OVERVIEW_HTML transport composer (issue #61 slice 4, per the adjudicated
 * proposal §7 slice 4 and §6 Q2).
 *
 * Like `sediment-dispatch.ts`, this is a *kind-specialised composer* modelled on
 * `deliver-child-result.ts`: it owns the `OVERVIEW_HTML` ledger identity and
 * reuses `HumanGoRuntime` as the shared prepare/claim/receipt/reconcile engine,
 * so the authority, fence and exactly-once invariants are unchanged. It carries
 * no new guard and no new actuation path (proposal §5.6).
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
export interface OverviewHtmlCarrierFence {
  providerConversationRef: string;
  targetCarrierRef: string;
  bindingEpoch: number;
  leaseGeneration: number;
  leaseOwnerRef: string;
  sourceEpoch: number;
  sourceObservedAt: number;
}

export interface OverviewHtmlDispatchRequest {
  operationId: string;
  /** Exact provider-facing bytes built from the canonical `OVERVIEW_HTML` registry definition. */
  payload: string;
  /** Fingerprint of those exact bytes; acceptance matches on the dispatched payload. */
  payloadFingerprint: string;
  preSubmitBaseline: SubmissionBaseline;
  carrier: OverviewHtmlCarrierFence;
  now?: number;
}

export interface OverviewHtmlDispatchDeps {
  /** The carrier's own ledger instance. Supplied by the caller, never built here. */
  ledger: HumanGoLedger;
  readCurrentCarrier: () => Promise<HumanGoCarrierSnapshot>;
  dispatch: (payload: string, fence: SubmissionDispatchFence) => Promise<void>;
}

/**
 * Dispatch one overview action and return the governed result unchanged. The
 * caller decides what to do with `BLOCKED` / `REFUSED` / `UNCERTAIN`; this
 * composer never retries, never falls back to `GO`, and never bypasses the
 * ledger.
 */
export async function dispatchOverviewHtml(
  request: OverviewHtmlDispatchRequest,
  deps: OverviewHtmlDispatchDeps
): Promise<HumanGoResult> {
  const { workItemId } = shortcutPayloadDefinition("OVERVIEW_HTML");
  const runtime = new HumanGoRuntime(deps.ledger, {
    readCurrentCarrier: deps.readCurrentCarrier,
    dispatch: deps.dispatch
  });
  return runtime.execute({
    operationId: request.operationId,
    operationKind: "OVERVIEW_HTML",
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
