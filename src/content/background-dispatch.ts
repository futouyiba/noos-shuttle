/**
 * The shared shell of the two background delivery listeners
 * (`NOOS_DISPATCH_GOAL_REANCHOR` and `NOOS_DISPATCH_DELIVER_CHILD_RESULT`).
 *
 * Both listeners do the same four things in the same order, and the order is
 * load-bearing:
 *
 *   1. validate the operation against the live observation and the submission
 *      fence — a delivery is only ever actuated into the conversation, carrier
 *      and execution instance it was claimed for;
 *   2. ask the composer for a free slot, writing nothing anywhere if the Human
 *      has a draft pending;
 *   3. only then claim the carrier as busy;
 *   4. submit, and report the observation the background reconciles against.
 *
 * Step 3 *after* step 2 is the fix for issue #98. Both listeners used to claim
 * the carrier first and only then look at the composer, which made a refusal
 * indistinguishable from an in-flight turn: `activeSubmission` stayed set, so
 * every later probe short-circuited on it and the carrier never offered to
 * deliver again, while the payload had already overwritten the Human's draft on
 * the way in. Claiming last means a refusal leaves the carrier exactly as it
 * found it, which is what lets the background treat the refusal as "not
 * attempted" rather than as "possibly sent".
 *
 * This module holds no state of its own: the carrier's `activeSubmission` slot
 * and the observation ledger both belong to the content entry, and arrive
 * through `BackgroundDispatchDeps`.
 */

import type { SubmissionDispatchFence } from "../core/submission-operation";
import { isSubmissionFence } from "./submission-completion-convergence";
import { insertIntoFreeChatInput, submitChatInput } from "./chatgpt-dom";

/** The parts of the live carrier observation this gate decides on. */
export interface BackgroundDispatchObservation {
  readonly state: string;
  readonly executionInstanceRef: string;
  readonly sourceEpoch: number;
  readonly carrierRef: string;
  readonly providerConversationRef?: string;
}

/** The parts of a claimed submission operation this gate decides on. */
export interface BackgroundDispatchOperation {
  readonly operationId: string;
  readonly logicalThreadId: string;
  readonly operationKind?: string;
  readonly state?: string;
  readonly payload?: unknown;
  readonly dispatchFence?: SubmissionDispatchFence;
  readonly dispatchClaimedAt?: number;
}

export interface BackgroundDispatchMessage {
  readonly type?: string;
  readonly operation?: BackgroundDispatchOperation;
}

export interface BackgroundDispatchDeps {
  /** The message this listener owns; every other message type is not ours to answer. */
  readonly messageType: string;
  /** The submission operation kind this listener actuates. */
  readonly operationKind: string;
  readonly readObservation: () => BackgroundDispatchObservation | null | undefined;
  /** True while this carrier already owns an in-flight turn. */
  readonly isSubmissionActive: () => boolean;
  /** Marks the carrier as owning the in-flight turn. Called only once the payload is in. */
  readonly claimSubmission: (claim: {
    readonly operationId: string;
    readonly logicalThreadId: string;
    readonly fence: SubmissionDispatchFence;
    readonly claimedAt: number;
  }) => void;
  /** The acknowledgment the background reconciles against, built by the caller. */
  readonly buildObservation: (current: BackgroundDispatchObservation, operation: BackgroundDispatchOperation) => Record<string, unknown>;
  readonly sendResponse: (response: Record<string, unknown>) => void;
}

/**
 * Answer one message for this listener, and report whether the response is
 * asynchronous.
 *
 * The return value is the `chrome.runtime.onMessage` contract: `false` for a
 * message this listener does not own, and `true` exactly when `sendResponse`
 * will be called later, from the submit. A refusal answers synchronously and
 * returns `false`, because there is nothing left to wait for.
 */
export function handleBackgroundDispatch(message: unknown, senderIsSelf: boolean, deps: BackgroundDispatchDeps): boolean {
  const dispatched = message as BackgroundDispatchMessage | undefined;
  if (dispatched?.type !== deps.messageType) return false;
  if (!senderIsSelf) { deps.sendResponse({ ok: false }); return false; }

  const operation = dispatched.operation;
  const current = deps.readObservation();
  if (!current || current.state !== "READY" || deps.isSubmissionActive() ||
    operation?.operationKind !== deps.operationKind || operation.state !== "DISPATCHING" ||
    !isSubmissionFence(operation.dispatchFence) || typeof operation.payload !== "string" ||
    operation.dispatchFence.leaseOwnerRef !== current.executionInstanceRef ||
    operation.dispatchFence.bindingEpoch !== current.sourceEpoch ||
    operation.dispatchFence.targetCarrierRef !== current.carrierRef ||
    operation.dispatchFence.providerConversationRef !== current.providerConversationRef) {
    deps.sendResponse({ ok: false });
    return false;
  }

  // Issue #98: the Human's draft is never overwritten. A refusal writes
  // nothing, submits nothing, and — because the carrier is claimed below —
  // also leaves the carrier free, so the background can offer the same
  // delivery again once the composer is free.
  const inserted = insertIntoFreeChatInput(operation.payload);
  if (!inserted.ok) {
    deps.sendResponse({ ok: false, reason: inserted.reason });
    return false;
  }

  deps.claimSubmission({
    operationId: operation.operationId,
    logicalThreadId: operation.logicalThreadId,
    fence: operation.dispatchFence,
    claimedAt: operation.dispatchClaimedAt ?? Date.now()
  });

  submitChatInput(inserted.composer).then(sent => {
    deps.sendResponse({ ok: sent, observation: deps.buildObservation(current, operation) });
  }).catch(() => deps.sendResponse({ ok: false }));
  return true;
}
