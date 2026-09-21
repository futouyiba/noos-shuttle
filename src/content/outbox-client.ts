/**
 * Carrier-side outbox client (issue #63 v0).
 *
 * This is the *only* place a queued message may reach the provider, and it
 * reaches it exactly the way every other Shuttle actuation does: prepare, claim
 * once, dispatch, receipt — a `SubmissionOperation` of kind `OUTBOX_MESSAGE` on
 * the existing durable ledger. The background never touches the page; it
 * decides, and it reserves the operation before this module is allowed to claim
 * it.
 *
 * One probe drives both halves of the cycle, because the carrier owns the fresh
 * observation either way: a reserved operation that already owns execution is
 * reconciled first (its durable outcome is folded back into the queue), and
 * only then may a `DISPATCH` decision actuate the frozen revision.
 */
import { dispatchOutboxMessage, reconcileOutboxReservation, type OutboxDispatchResult } from "./outbox-dispatch";
import type { CarrierObservation } from "./runtime-observer";
import type { HumanGoCarrierSnapshot } from "../core/human-go-runtime";
import type { HumanGoLedger } from "../core/human-go-runtime";
import {
  OUTBOX_STORE_KEY,
  emptyOutboxQueueState,
  expectedUserTurnAccounting,
  extractOutboxQueueState,
  hasOutstandingOutboxReservation,
  orderedOutboxItems,
  outboxQueueStatus,
  outboxRunAccounting,
  type OutboxItem,
  type OutboxQueueState,
  type OutboxRunAccounting
} from "../core/outbox-queue";
import type { OutboxGateObservation } from "../background/outbox-gate";
import type { OutboxRunExpectation } from "../core/outbox-queue";

export interface OutboxCarrierContext {
  carrier: HumanGoCarrierSnapshot;
  /** Fresh DOM read of the composer; never inferred from the observation. */
  composerEmpty: boolean;
  /** Message fingerprints from the same DOM read the baseline uses. */
  evidence: OutboxDispatchEvidence;
}

export type OutboxDispatchEvidence = {
  headFingerprint?: string;
  lastUserMessageFingerprint?: string;
  lastAssistantMessageFingerprint?: string;
};

export interface OutboxClientDeps {
  /** The carrier's own submission ledger instance — the same one its Run uses. */
  ledger: HumanGoLedger;
  /**
   * A fresh reading of the page, taken when called. Passed straight through to
   * the actuation, which re-reads at the insertion rather than trusting the
   * probe's snapshot (issue #99).
   */
  readLiveCarrier(): { observation: CarrierObservation; carrier: HumanGoCarrierSnapshot };
  sendMessage<TResponse>(message: Record<string, unknown>): Promise<TResponse | undefined>;
  readContext(observation: CarrierObservation): OutboxCarrierContext;
  /** Active Run epoch on this conversation, if any. Attribution only. */
  activeRunId(): string | undefined;
  onQueueChanged?(queue: OutboxQueueState): void;
  /** Surfaced for the degraded state; never implies a delivery. */
  onBlockedUncertain?(item: OutboxItem): void;
}

export interface OutboxClient {
  queue(): OutboxQueueState;
  status(): ReturnType<typeof outboxQueueStatus>;
  /** Arrival-ordered, cancellations dropped: what the surface lists. */
  visibleItems(): OutboxItem[];
  /** True while the whole queue is held by the Human. */
  paused(): boolean;
  /**
   * What the queue answers for, for this Run epoch: proven deliveries, and
   * whether an unresolved reservation is standing in for one turn.
   */
  outboxAccountingFor(runId: string, providerConversationRef: string): OutboxRunAccounting | undefined;
  /** The absolute expected-user-turn floor those deliveries have earned. */
  expectedUserTurnAccountingFor(runId: string, providerConversationRef: string): OutboxRunExpectation | undefined;
  /** Adopts the durable queue without probing (startup). */
  adopt(queue: OutboxQueueState): void;
  probe(observation: CarrierObservation): Promise<void>;
  enqueue(payload: string, observation: CarrierObservation): Promise<boolean>;
  edit(itemId: string, expectedRevision: number, payload: string): Promise<boolean>;
  cancel(itemId: string): Promise<boolean>;
  setPaused(paused: boolean): Promise<boolean>;
  /** True while a Run epoch still has an outbox reservation it has not accounted for. */
  reservationOutstandingFor(runId: string): boolean;
}

interface OutboxProbeResponse {
  ok?: boolean;
  status?: { kind?: string; itemId?: string; operationId?: string };
  queue?: unknown;
  dispatch?: {
    itemId: string;
    operationId: string;
    payload: string;
    payloadFingerprint: string;
    revision: number;
    reservationRunId?: string;
  };
}

export function createOutboxClient(deps: OutboxClientDeps): OutboxClient {
  let state: OutboxQueueState = emptyOutboxQueueState();
  let inFlight = false;

  const publish = (next: OutboxQueueState): void => {
    state = next;
    deps.onQueueChanged?.(next);
  };

  const adoptQueue = (queue: unknown): void => {
    if (queue === undefined) return;
    publish(extractOutboxQueueState({ [OUTBOX_STORE_KEY]: queue }));
  };

  const mutate = async (mutation: Record<string, unknown>): Promise<boolean> => {
    const response = await deps.sendMessage<{ ok?: boolean; queue?: unknown }>({ type: "NOOS_OUTBOX_MUTATION", mutation });
    if (!response?.ok) return false;
    adoptQueue(response.queue);
    return true;
  };

  const probe = async (observation: CarrierObservation): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const context = deps.readContext(observation);
      const response = await deps.sendMessage<OutboxProbeResponse>({
        type: "NOOS_OUTBOX_PROBE",
        carrier: context.carrier,
        observation: observationForGate(observation, context.composerEmpty),
        runId: deps.activeRunId()
      });
      if (!response?.ok) return;
      adoptQueue(response.queue);
      if (response.status?.kind === "BLOCKED_UNCERTAIN") {
        const head = state.items.find(item => item.itemId === response.status?.itemId);
        if (head) deps.onBlockedUncertain?.(head);
        return;
      }
      // The gate reports a reservation that left execution (or overstayed its
      // dispatch grace) as RECONCILE. Consuming it is what closes the loop that
      // delta 3 rests on: the ledger is driven to a terminal state so the
      // background can fold the delivery and the Run's earned floor moves. A
      // `DISPATCHING` status is a plain wait — the operation is still in flight.
      if (response.status?.kind === "RECONCILE" && response.status.operationId !== undefined) {
        const reconciled = await reconcileOutboxReservation({
          itemId: response.status.itemId ?? "",
          operationId: response.status.operationId,
          observation,
          evidence: context.evidence
        }, { ledger: deps.ledger });
        report(reconciled);
        return;
      }
      if (response.status?.kind !== "DISPATCH" || !response.dispatch) return;
      const result = await dispatchOutboxMessage(
        { ...response.dispatch, observation, evidence: context.evidence },
        { ledger: deps.ledger, readLiveCarrier: deps.readLiveCarrier }
      );
      report(result);
    } catch {
      // A restarting service worker leaves the durable reservation for the next
      // probe. A failed probe never actuates anything.
    } finally {
      inFlight = false;
    }
  };

  /** A blocked dispatch sent nothing; the item keeps its reservation and status. */
  const report = (result: OutboxDispatchResult): void => {
    if (result.status === "DISPATCHED" || result.status === "BLOCKED") return;
    deps.onQueueChanged?.(state);
  };

  return {
    queue: () => state,
    status: () => outboxQueueStatus(state),
    visibleItems: () => orderedOutboxItems(state).filter(item => item.state !== "CANCELLED"),
    paused: () => state.paused,
    outboxAccountingFor: (runId, providerConversationRef) =>
      outboxRunAccounting(state, runId, providerConversationRef),
    expectedUserTurnAccountingFor: (runId, providerConversationRef) =>
      expectedUserTurnAccounting(state, runId, providerConversationRef),
    adopt: publish,
    probe,
    async enqueue(payload, observation) {
      const conversationRef = deps.readContext(observation).carrier.providerConversationRef;
      if (!conversationRef) return false;
      const now = Date.now();
      return mutate({
        type: "enqueue",
        input: {
          // A new message is always a new item, even if the text repeats.
          itemId: `outbox-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          logicalThreadId: `thread:${conversationRef}`,
          providerConversationRef: conversationRef,
          payload,
          now
        }
      });
    },
    edit: (itemId, expectedRevision, payload) => mutate({ type: "edit", itemId, expectedRevision, payload, now: Date.now() }),
    cancel: itemId => mutate({ type: "cancel", itemId, now: Date.now() }),
    setPaused: paused => mutate({ type: "pause", paused, now: Date.now() }),
    reservationOutstandingFor: runId => hasOutstandingOutboxReservation(state, runId)
  };
}

/**
 * The gate needs the *conservative* reading of the observation, taken together
 * with the composer probe that was read at the same instant: momentary quiet is
 * not idle, so a still-mutating assistant turn or a live stop control is
 * reported as such even if `state` has not caught up yet.
 */
export function observationForGate(observation: CarrierObservation, composerEmpty: boolean): OutboxGateObservation {
  return {
    state: observation.state,
    carrierIdentityState: observation.carrierIdentityState,
    providerConversationRef: observation.providerConversationRef,
    routeRef: observation.routeRef,
    observedAt: observation.observedAt,
    sourceEpoch: observation.sourceEpoch,
    quietSince: observation.quietSince ?? undefined,
    assistantOutputMutating: observation.assistantOutputMutating,
    stopGenerationControlPresent: observation.stopGenerationControlPresent,
    providerErrorSurfacePresent: observation.providerErrorSurfacePresent,
    composerPresent: observation.composerPresent,
    composerInteractive: observation.composerInteractive,
    composerEmpty,
    userMessageCount: observation.userMessageCount
  };
}
