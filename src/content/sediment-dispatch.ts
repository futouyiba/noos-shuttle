/**
 * SEDIMENT transport composer (issue #61 slice 2, per the adjudicated proposal
 * `docs/deliberation-harness/shuttle-shortcut-actions-proposal-v0.md` §7).
 *
 * The adjudication (delta 2) asked for a *kind-specialised composer* modelled on
 * `deliver-child-result.ts` rather than turning `HumanGoRuntime` into a generic
 * kind switch. This module is that composer: it owns the `SEDIMENT` ledger
 * identity, and reuses `HumanGoRuntime` as the shared prepare/claim/receipt/
 * reconcile engine so the authority, fence and exactly-once invariants are the
 * same ones every other Shuttle actuation gets. Only the ledger kind (and the
 * `workItemId` taken from the canonical payload registry) differs.
 *
 * The proposal's §6 Q2 note ("do not add `operationKind` to `HumanGoRequest`")
 * predates issue #63: the outbox landed that field afterwards and already uses
 * it for `OUTBOX_MESSAGE`. What the adjudication actually forbids — exposing a
 * generic kind parameter on the panel's GO path — is honoured here: nothing in
 * this module is reachable as a `kind` argument, and `dispatchHumanGo` stays the
 * GO-only entry point.
 *
 * Type-only imports from `submission-operation` on purpose: the content entry
 * must not bundle the ledger value module, or Rollup promotes it to a shared
 * chunk an MV3 classic content script cannot load (see `outbox-dispatch.ts`).
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
export interface SedimentCarrierFence {
  providerConversationRef: string;
  targetCarrierRef: string;
  bindingEpoch: number;
  leaseGeneration: number;
  leaseOwnerRef: string;
  sourceEpoch: number;
  sourceObservedAt: number;
}

export interface SedimentDispatchRequest {
  operationId: string;
  /** Exact provider-facing bytes built from the canonical `SEDIMENT` registry definition. */
  payload: string;
  /** Fingerprint of those exact bytes; acceptance matches on the dispatched payload. */
  payloadFingerprint: string;
  preSubmitBaseline: SubmissionBaseline;
  carrier: SedimentCarrierFence;
  now?: number;
}

export interface SedimentDispatchDeps {
  /** The carrier's own ledger instance. Supplied by the caller, never built here. */
  ledger: HumanGoLedger;
  readCurrentCarrier: () => Promise<HumanGoCarrierSnapshot>;
  dispatch: (payload: string, fence: SubmissionDispatchFence) => Promise<void>;
}

/**
 * Dispatch one sediment action and return the governed result unchanged. The
 * caller decides what to do with `BLOCKED` / `REFUSED` / `UNCERTAIN`; this
 * composer never retries, never falls back to `GO`, and never bypasses the
 * ledger.
 */
export async function dispatchSediment(
  request: SedimentDispatchRequest,
  deps: SedimentDispatchDeps
): Promise<HumanGoResult> {
  const { workItemId } = shortcutPayloadDefinition("SEDIMENT");
  const runtime = new HumanGoRuntime(deps.ledger, {
    readCurrentCarrier: deps.readCurrentCarrier,
    dispatch: deps.dispatch
  });
  return runtime.execute({
    operationId: request.operationId,
    operationKind: "SEDIMENT",
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
