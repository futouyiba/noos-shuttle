import {
  WorkItemInbox,
  InMemoryWorkItemStore,
  createChromeWorkItemStore,
  WorkItemConflictError,
  WorkItemValidationError,
  type AbsorbOptions,
  type CreateWorkItemInput,
  type WorkItemBinding,
  type ColdStartApprovalEvent,
  type WorkItemAdoptionEvent
} from "../core/work-item-inbox";
import type { CandidateProposal } from "../core/work-item-inbox";
import { createChromeWorkItemCoordinator } from "../core/work-item-coordinator";
import type { NoosCrystal } from "../core/noos-crystal";
import type { NoosThread } from "../core/noos-thread";
import { extractProviderConversationId } from "../shared/provider-identity";
import { runGoalReanchorProbe } from "./goal-reanchor-runtime";
import { runChildDeliveryProbe } from "./delivery-runtime";
import {
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_STORE_KEY,
  createOutboxReservation,
  emptyOutboxQueueState,
  extractOutboxQueueState,
  headOutboxItem,
  reduceOutboxQueue,
  type OutboxMutation,
  type OutboxMutationResult,
  type OutboxQueueState,
  type OutboxSubmissionOutcome
} from "../core/outbox-queue";
import {
  classifyOutboxHead,
  type OutboxGateCarrier,
  type OutboxGateObservation,
  type OutboxProbeInput,
  type OutboxProbeState
} from "./outbox-gate";
import { adoptBrowserChildSpawn, requestBrowserChildSpawn } from "./spawn-runtime";
import { ResultDeliveryLedger, createChromeResultDeliveryStore } from "../core/result-delivery";
import { carrierTabQueryPatterns, type CarrierTabCandidate } from "../core/carrier-focus";
import {
  CARRIER_FOCUS_ALARM,
  CARRIER_FOCUS_ALARM_PERIOD_MINUTES,
  HUB_FOCUS_ACK_URL,
  HUB_FOCUS_REQUESTS_URL,
  type CarrierFocusRuntimeDeps,
  startCarrierFocusPolling
} from "./focus-runtime";
import { ProviderExecutionJournal, createChromeExecutionJournalStore } from "../core/execution-journal";
import { DurableOperationalStateReducer, createChromeOperationalStateReducerStore } from "../core/durable-operational-state-reducer";
import { SubmissionOperationLedger, createChromeSubmissionStore, isSubmissionOperation, type SubmissionOperation, type SubmissionOperationMutation } from "../core/submission-operation";
import {
  BCR_EXPERIMENTAL_MAX_BUDGET,
  CONTINUATION_RUN_STORE_KEY,
  emptyContinuationRunStore,
  reduceContinuationRunStore,
  type ContinuationRunMutation,
  type ContinuationRunMutationResult,
  type ContinuationRunStore
} from "../core/continuation-run";
import {
  BCR_EVALUATOR_ALLOWED_HOST,
  BCR_EVALUATOR_CONFIG_KEY,
  BCR_EVALUATOR_DEFAULT_MODEL,
  evaluateContinuation,
  isEvaluatorExcerptUsable,
  normalizeEvaluatorConfig
} from "../core/continuation-evaluator";
import {
  ChildWorkerLedger,
  createChromeChildWorkerStore,
  isCreateChildIntentInput,
  type CreateChildIntentInput
} from "../core/child-worker";

chrome.runtime.onInstalled.addListener(() => {
  console.info("NOOS Shuttle installed.");
});

// Hub「查看对话」focus lane: poll the paired Hub for focus requests and
// activate/open the carrier tab. Focus is observation-only (no lease).
const carrierFocusDeps: CarrierFocusRuntimeDeps = {
  fetchRequests: () => fetchHubJsonWithRepair(HUB_FOCUS_REQUESTS_URL),
  postAck: (requestId) =>
    postHubJsonWithRepair(HUB_FOCUS_ACK_URL, { request_id: requestId }),
  queryTabs: async (): Promise<CarrierTabCandidate[]> => {
    const tabs = await chrome.tabs.query({ url: carrierTabQueryPatterns() });
    const candidates = tabs.filter(
      (tab) => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId)
    );
    const windowFocused = new Map<number, boolean>();
    await Promise.all(
      [...new Set(candidates.map((tab) => tab.windowId))].map(async (windowId) => {
        try {
          windowFocused.set(windowId, (await chrome.windows.get(windowId)).focused);
        } catch {
          windowFocused.set(windowId, false);
        }
      })
    );
    return candidates.map((tab) => ({
      tabId: tab.id as number,
      windowId: tab.windowId as number,
      url: tab.url ?? "",
      active: tab.active,
      lastAccessed: tab.lastAccessed ?? 0,
      windowFocused: windowFocused.get(tab.windowId as number) ?? false
    }));
  },
  activateTab: async (tabId) => {
    await chrome.tabs.update(tabId, { active: true });
  },
  focusWindow: async (windowId) => {
    await chrome.windows.update(windowId, { focused: true });
  },
  openObserverTab: async (url) => {
    await chrome.tabs.create({ url, active: true });
  }
};
// Guarded on chrome.alarms (granted by the manifest in the real MV3 host):
// partial test doubles stub only the APIs they exercise, and an unguarded
// start would leave a dangling interval plus in-flight fetches per reload.
if (chrome.alarms) {
  const carrierFocusTick = startCarrierFocusPolling(carrierFocusDeps);
  chrome.alarms.create(CARRIER_FOCUS_ALARM, { periodInMinutes: CARRIER_FOCUS_ALARM_PERIOD_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CARRIER_FOCUS_ALARM) {
      carrierFocusTick();
    }
  });
}

const HUB_LOCAL_WRITE_URL = "http://127.0.0.1:17642/v1/ingest";
const HUB_HEALTH_URL = "http://127.0.0.1:17642/health";
const HUB_PAIR_URL = "http://127.0.0.1:17642/pair";
const HUB_VAULT_RECENT_URL = "http://127.0.0.1:17642/v1/vault/recent";
const HUB_VAULT_BROWSE_URL = "http://127.0.0.1:17642/v1/vault/browse";
const HUB_VAULT_OBJECT_URL = "http://127.0.0.1:17642/v1/vault/object";
const HUB_WIKI_TARGET_URL = "http://127.0.0.1:17642/v1/wiki/default-target";
const HUB_ACTION_URL = "http://127.0.0.1:17642/v1/actions";
const HUB_BCR_EVALUATOR_CONFIG_URL = "http://127.0.0.1:17642/v1/bcr/evaluator-config";
const HUB_TOKEN_STORAGE_KEY = "noosHubShuttleToken";
const workItemStorage = {
  get: (key: string) => chrome.storage.local.get(key) as Promise<Record<string, unknown>>,
  set: (value: Record<string, unknown>) => chrome.storage.local.set(value)
};
const workItemCoordinator = createChromeWorkItemCoordinator(workItemStorage);
const workItemInbox = chrome.storage?.local
  ? new WorkItemInbox(createChromeWorkItemStore(workItemStorage, workItemCoordinator))
  : new WorkItemInbox(new InMemoryWorkItemStore());
let submissionOperationCoordinator: SubmissionOperationLedger | undefined;

const CONTINUATION_RUN_LOCK = "noos-continuation-run-authority";
const OUTBOX_LOCK = "noos-outbox-queue-authority";

/**
 * Outbox queue mutations. The queue is its own durable store — separate from
 * Run state and from the Work Item Inbox — and is guarded by its own authority
 * lock so a queue edit can never interleave with the probe that reserves (or
 * records) a delivery.
 */
async function handleOutboxMutation(mutation: OutboxMutation): Promise<OutboxMutationResult> {
  const storage = chrome.storage?.local;
  if (!storage) return { ok: false, error: "storage_unavailable", state: emptyOutboxQueueState() };
  if (!mutation || typeof mutation !== "object" || !isKnownOutboxMutation(mutation)) {
    return { ok: false, error: "invalid_mutation", state: emptyOutboxQueueState() };
  }
  return navigator.locks.request(OUTBOX_LOCK, async () => {
    const persisted = await storage.get(OUTBOX_STORE_KEY);
    const state = extractOutboxQueueState(persisted);
    const result = reduceOutboxQueue(state, mutation);
    if (result.ok && result.state !== state) await storage.set({ [OUTBOX_STORE_KEY]: result.state });
    return result;
  });
}

function isKnownOutboxMutation(mutation: OutboxMutation): boolean {
  switch (mutation.type) {
    case "list":
      return true;
    case "enqueue":
      return !!mutation.input && typeof mutation.input === "object" &&
        isNonEmptyString(mutation.input.itemId) &&
        isNonEmptyString(mutation.input.logicalThreadId) &&
        isNonEmptyString(mutation.input.providerConversationRef) &&
        typeof mutation.input.payload === "string" &&
        isFiniteInteger(mutation.input.now);
    case "edit":
      return isOperationId(mutation.itemId) && isFiniteInteger(mutation.expectedRevision) &&
        typeof mutation.payload === "string" && isFiniteInteger(mutation.now);
    case "cancel":
      return isOperationId(mutation.itemId) && isFiniteInteger(mutation.now);
    case "pause":
      return typeof mutation.paused === "boolean" && isFiniteInteger(mutation.now);
    case "claim_dispatch":
      return isOperationId(mutation.itemId) && !!mutation.input && typeof mutation.input === "object" &&
        isOperationId(mutation.input.operationId) && isFiniteInteger(mutation.input.now);
    case "record_submission":
      return !!mutation.outcome && typeof mutation.outcome === "object" &&
        isOperationId(mutation.outcome.operationId) &&
        typeof mutation.outcome.state === "string" &&
        isFiniteInteger(mutation.outcome.now);
    case "release_attempt":
      return isOperationId(mutation.itemId) && mutation.reason === "PROVEN_NOT_ACCEPTED" && isFiniteInteger(mutation.now);
    default:
      return false;
  }
}

/**
 * Every field of the carrier's half of a probe is re-checked here rather than
 * assumed from the content script.
 */
function isOutboxGateCarrier(value: unknown): value is OutboxGateCarrier {
  if (!isClaimContext(value)) return false;
  const carrier = value as unknown as Record<string, unknown>;
  return isFiniteInteger(carrier.sourceEpoch) && typeof carrier.leaseOwnerRef === "string";
}

function isOutboxGateObservation(value: unknown): value is OutboxGateObservation {
  if (!value || typeof value !== "object") return false;
  const observation = value as Record<string, unknown>;
  return typeof observation.state === "string" &&
    typeof observation.carrierIdentityState === "string" &&
    (observation.providerConversationRef === undefined || typeof observation.providerConversationRef === "string") &&
    typeof observation.routeRef === "string" &&
    isFiniteInteger(observation.observedAt) &&
    isFiniteInteger(observation.sourceEpoch) &&
    (observation.quietSince === undefined || isFiniteInteger(observation.quietSince)) &&
    typeof observation.assistantOutputMutating === "boolean" &&
    typeof observation.stopGenerationControlPresent === "boolean" &&
    typeof observation.providerErrorSurfacePresent === "boolean" &&
    typeof observation.composerPresent === "boolean" &&
    typeof observation.composerInteractive === "boolean" &&
    typeof observation.composerEmpty === "boolean" &&
    (observation.userMessageCount === undefined || isFiniteInteger(observation.userMessageCount));
}

/** True when an execution-owning operation already holds this exact target. */
function hasExecutionInFlight(operations: SubmissionOperation[], carrier: OutboxGateCarrier): boolean {
  return operations.some(operation =>
    (operation.state === "DISPATCHING" || operation.state === "UNCERTAIN" || operation.state === "OBSERVED_ACCEPTED") &&
    operation.targetCarrierRef === carrier.targetCarrierRef &&
    operation.providerConversationRef === carrier.providerConversationRef);
}

/**
 * One outbox probe from the canonical carrier. Nothing is actuated here: a
 * DISPATCH decision durably reserves the operation, and the carrier may then
 * claim and deliver exactly that revision.
 *
 * Every ledger fact the gate reads — the thread's actuation authority, the
 * execution-owning operations — is read from the durable store *here* rather
 * than accepted from the wire, so a compromised or stale content script cannot
 * talk the gate into believing this carrier holds a lease it does not.
 */
async function handleOutboxProbe(message: { carrier: unknown; observation: unknown; runId?: unknown }): Promise<Record<string, unknown>> {
  const storage = chrome.storage?.local;
  const submissions = getSubmissionOperationCoordinator();
  if (!storage || !submissions) return { ok: false, error: "outbox_unavailable" };
  if (!isOutboxGateCarrier(message.carrier) || !isOutboxGateObservation(message.observation)) {
    return { ok: false, error: "invalid_probe" };
  }
  const carrier = message.carrier as OutboxGateCarrier;
  const runId = typeof message.runId === "string" && message.runId.trim() !== "" ? message.runId : undefined;
  // The queue's own identity: an item only ever actuates into the conversation
  // and logical thread its record names, which is the carrier's own thread.
  const logicalThreadId = carrier.logicalThreadId;
  const operations = await submissions.list();
  const authority = await submissions.authorityFor(logicalThreadId);
  const outcome = await navigator.locks.request(OUTBOX_LOCK, async () => {
    const state = extractOutboxQueueState(await storage.get(OUTBOX_STORE_KEY));
    const probe = probeOutboxHead({
      queue: state,
      carrier,
      observation: message.observation as OutboxGateObservation,
      ledgers: { authority, executionInFlight: hasExecutionInFlight(operations, carrier), operations },
      runId
    });
    if (probe.queue !== state) await storage.set({ [OUTBOX_STORE_KEY]: probe.queue });
    // Fold the reserved operation's outcome in while still holding the lock, so
    // a delivery can never be recorded twice or out of order.
    const recorded = await recordOutboxOutcome(storage, submissions, probe.queue);
    return { probe, queue: recorded.queue, recorded: recorded.recorded };
  });
  const recorded = outcome.recorded;
  return {
    ok: true,
    status: outcome.probe.status,
    queue: outcome.queue,
    dispatch: outcome.probe.dispatch
      ? {
          itemId: outcome.probe.dispatch.item.itemId,
          operationId: outcome.probe.dispatch.operationId,
          payload: outcome.probe.dispatch.item.payload,
          payloadFingerprint: outcome.probe.dispatch.item.payloadFingerprint,
          revision: outcome.probe.dispatch.item.revision,
          reservationRunId: outcome.probe.dispatch.reservationRunId
        }
      : undefined,
    recorded
  };
}

/**
 * One probe's decision, plus the durable reservation it implies.
 *
 * The reservation lands inside the *same* durable record as the item's own
 * identity, and the caller stores that record before the carrier is told it may
 * claim anything. That ordering is exactly what makes the Run's expected-turn
 * accounting provenance-bound: there is no instant at which a delivery is
 * possible but the operation it will be proven by is not yet recorded.
 *
 * Lives here rather than in the gate module so the shared queue store is
 * reachable from the content entry alone — the renderer otherwise promotes it to
 * a chunk an MV3 content script cannot load.
 */
function probeOutboxHead(input: OutboxProbeInput, now = Date.now()): OutboxProbeState {
  const head = headOutboxItem(input.queue);
  if (!head) return { queue: input.queue, status: { kind: "IDLE" } };
  const decision = classifyOutboxHead(head, input, now, {
    maxAttempts: OUTBOX_MAX_ATTEMPTS,
    // Deterministic per revision and attempt, and distinct across attempts: a
    // retry after a proven-not-accepted dispatch must never reuse the id of an
    // operation the ledger already retired.
    mintOperationId: item => `outbox:${item.itemId}:r${item.revision}:a${item.attempts + 1}:${item.payloadFingerprint.slice(0, 8)}`
  });
  if (decision.kind !== "DISPATCH") return { queue: input.queue, status: decision };
  const claimed = reduceOutboxQueue(input.queue, {
    type: "claim_dispatch",
    itemId: head.itemId,
    input: {
      operationId: decision.operationId,
      reservation: createOutboxReservation(head, decision.operationId, input.runId, input.observation.userMessageCount),
      now
    }
  });
  if (!claimed.ok || !claimed.item) return { queue: input.queue, status: { kind: "WAIT", itemId: head.itemId, reason: "reservation_missing" } };
  return {
    queue: claimed.state,
    status: { kind: "DISPATCH", itemId: head.itemId, operationId: decision.operationId },
    dispatch: { item: claimed.item, operationId: decision.operationId, reservationRunId: input.runId }
  };
}

/**
 * Folds the reserved head operation's durable outcome into the queue.
 *
 * Only the two success-terminal states count as a delivery, and the item takes
 * its accounting baseline from that operation's own pre-submit observation.
 * A proven-not-accepted attempt releases the item for one more try (or parks it
 * once the attempt cap is spent); a still-executing or ambiguous operation
 * changes nothing at all, which is what keeps a failed dispatch from leaving a
 * loose `+1` behind for the Run's accounting to lean on.
 */
async function recordOutboxOutcome(
  storage: Pick<chrome.storage.StorageArea, "get" | "set">,
  submissions: SubmissionOperationLedger,
  queue: OutboxQueueState
): Promise<{ queue: OutboxQueueState; recorded?: OutboxSubmissionOutcome }> {
  const head = headOutboxItem(queue);
  if (!head || head.state !== "DISPATCHING" || head.submissionOperationId === undefined) return { queue };
  const operation = await submissions.get(head.submissionOperationId);
  if (!operation || operation.operationKind !== "OUTBOX_MESSAGE") return { queue };
  const terminal = operation.state === "OBSERVED_ACCEPTED" || operation.state === "COMPLETED" ||
    operation.state === "UNCERTAIN" || operation.state === "FAILED_SAFE" || operation.state === "CANCELLED";
  if (!terminal) return { queue };
  const outcome: OutboxSubmissionOutcome = {
    operationId: operation.operationId,
    state: operation.state,
    baselineUserMessageCount: operation.preSubmitBaseline.userMessageCount,
    now: Date.now()
  };
  const applied = reduceOutboxQueue(queue, { type: "record_submission", outcome });
  if (!applied.ok) return { queue };
  let next = applied.state;
  if (operation.state === "FAILED_SAFE") {
    const released = reduceOutboxQueue(next, { type: "release_attempt", itemId: head.itemId, reason: "PROVEN_NOT_ACCEPTED", now: outcome.now });
    if (released.ok) next = released.state;
  }
  await storage.set({ [OUTBOX_STORE_KEY]: next });
  return { queue: next, recorded: outcome };
}

function isContinuationRunStoreShape(value: unknown): value is ContinuationRunStore {
  if (!value || typeof value !== "object") return false;
  const store = value as Partial<ContinuationRunStore>;
  return typeof store.activeByConversation === "object" && store.activeByConversation !== null &&
    Array.isArray(store.ended) && Array.isArray(store.candidates);
}

/** The background coordinator owns the durable run store; content scripts only project it. */
async function handleContinuationRunMutation(mutation: ContinuationRunMutation): Promise<ContinuationRunMutationResult> {
  const storage = chrome.storage?.local;
  if (!storage) return { ok: false, error: "storage_unavailable" };
  if (!mutation || typeof mutation !== "object" || !isKnownContinuationRunMutation(mutation)) return { ok: false, error: "invalid_mutation" };
  return navigator.locks.request(CONTINUATION_RUN_LOCK, async () => {
    const persisted = await storage.get(CONTINUATION_RUN_STORE_KEY);
    const store: ContinuationRunStore = isContinuationRunStoreShape(persisted[CONTINUATION_RUN_STORE_KEY])
      ? persisted[CONTINUATION_RUN_STORE_KEY]
      : emptyContinuationRunStore();
    const result = reduceContinuationRunStore(store, mutation);
    if (result.ok && result.store !== store) await storage.set({ [CONTINUATION_RUN_STORE_KEY]: result.store });
    return result;
  });
}

/** Isolated evaluator call for one completed AUTO_X5 round. The goal/scope come from the durable run (never from the wire); the excerpt is bounded; the verdict is always gated by the conservative deterministic policy. */
async function handleContinuationEvaluate(message: { runId?: unknown; assistantTurnExcerpt?: unknown }): Promise<Record<string, unknown>> {
  const storage = chrome.storage?.local;
  if (!storage) return { ok: false, error: "storage_unavailable" };
  const runId = typeof message.runId === "string" ? message.runId.trim() : "";
  const excerpt = typeof message.assistantTurnExcerpt === "string" ? message.assistantTurnExcerpt : "";
  if (runId === "") return { ok: false, error: "runId_required" };
  // Kept as a payload bound even though the shipped content script caps the
  // excerpt at 2000 chars: this lane is an authority boundary any extension
  // context can message, and the excerpt is forwarded to a third-party endpoint.
  if (excerpt.length > 8_000) return { ok: false, error: "excerpt_too_long" };
  // Fail closed before the evaluator is called at all. A node that has not
  // rendered carries no material, so the model can only answer UNCERTAIN/LOW —
  // and that "nothing to judge" answer would otherwise be displayed as a stop
  // verdict the model reached. Report the missing text as itself instead: it is
  // not a Human wait, and it is not the model's judgment.
  if (!isEvaluatorExcerptUsable(excerpt)) {
    return { ok: true, decision: "WOULD_STOP", stopReason: "EXCERPT_UNAVAILABLE", error: "excerpt_unavailable" };
  }
  const rawConfig = (await storage.get(BCR_EVALUATOR_CONFIG_KEY))[BCR_EVALUATOR_CONFIG_KEY];
  const config = normalizeEvaluatorConfig(rawConfig);
  if (!config) return { ok: false, error: "evaluator_unconfigured" };
  const persisted = await storage.get(CONTINUATION_RUN_STORE_KEY);
  const store: ContinuationRunStore = isContinuationRunStoreShape(persisted[CONTINUATION_RUN_STORE_KEY])
    ? persisted[CONTINUATION_RUN_STORE_KEY]
    : emptyContinuationRunStore();
  const run = Object.values(store.activeByConversation).find(candidate => candidate.runId === runId);
  if (!run || run.status !== "ACTIVE" || run.mode !== "AUTO_X5" || run.phase !== "EVALUATING") {
    return { ok: false, error: "no_active_auto_run" };
  }
  const verdict = await evaluateContinuation({
    goal: run.goal,
    scope: run.scope ?? run.goal,
    assistantTurnExcerpt: excerpt
  }, config);
  return {
    ok: true,
    decision: verdict.decision,
    assessment: verdict.assessment,
    stopReason: verdict.stopReason,
    // Passed through as computed, never coerced: an undefined veto means no veto
    // evaluation happened, and recording it as false would claim the word list
    // was consulted and found nothing.
    vetoHit: verdict.vetoHit,
    error: verdict.error
  };
}

/** Evaluator config read/write. The key never echoes back to the content script; empty key input preserves the stored one. */
async function handleContinuationEvalConfig(message: { config?: unknown }): Promise<Record<string, unknown>> {  const storage = chrome.storage?.local;
  if (!storage) return { ok: false, error: "storage_unavailable" };
  if (message.config !== undefined && message.config !== null) {
    const config = message.config as { apiKey?: unknown; model?: unknown };
    const current = normalizeEvaluatorConfig((await storage.get(BCR_EVALUATOR_CONFIG_KEY))[BCR_EVALUATOR_CONFIG_KEY]);
    const apiKey = typeof config.apiKey === "string" && config.apiKey.trim() !== "" ? config.apiKey.trim() : current?.apiKey;
    const model = typeof config.model === "string" && config.model.trim() !== "" ? config.model.trim() : current?.model ?? BCR_EVALUATOR_DEFAULT_MODEL;
    if (!apiKey) return { ok: false, error: "api_key_required" };
    if (apiKey.length > 300 || model.length > 120) return { ok: false, error: "config_too_long" };
    await storage.set({ [BCR_EVALUATOR_CONFIG_KEY]: { baseUrl: `https://${BCR_EVALUATOR_ALLOWED_HOST}`, apiKey, model } });
  }
  const after = normalizeEvaluatorConfig((await storage.get(BCR_EVALUATOR_CONFIG_KEY))[BCR_EVALUATOR_CONFIG_KEY]);
  return { ok: true, evaluatorConfigured: Boolean(after), model: after?.model ?? BCR_EVALUATOR_DEFAULT_MODEL };
}

/** Explicit pull of the Hub-side evaluator config into the local store. Never automatic: the Hub sync always overrides the local key/model, so it only runs on the user's click. The payload is re-validated against the same allowlist the evaluator enforces. */
async function handleContinuationEvalSync(): Promise<Record<string, unknown>> {
  const storage = chrome.storage?.local;
  if (!storage) return { ok: false, error: "storage_unavailable" };
  let payload: unknown;
  try {
    payload = await fetchHubJsonWithRepair(HUB_BCR_EVALUATOR_CONFIG_URL);
  } catch {
    return { ok: false, error: "hub_unreachable" };
  }
  if (!payload || typeof payload !== "object") return { ok: false, error: "hub_unreachable" };
  const body = payload as { ok?: unknown; errorCode?: unknown; configured?: unknown; baseUrl?: unknown; apiKey?: unknown; model?: unknown };
  // The Hub helper family reports transport/pairing failures as error-shaped
  // payloads ({ok:false, errorCode}) rather than throwing.
  if (body.ok === false || typeof body.errorCode === "string") return { ok: false, error: "hub_unreachable" };
  if (body.ok !== true || body.configured !== true || typeof body.baseUrl !== "string" ||
    typeof body.apiKey !== "string" || body.apiKey === "" || typeof body.model !== "string" || body.model === "") {
    return { ok: true, synced: false, reason: "hub_not_configured" };
  }
  const config = normalizeEvaluatorConfig({ baseUrl: body.baseUrl, apiKey: body.apiKey, model: body.model });
  if (!config) return { ok: true, synced: false, reason: "hub_config_invalid" };
  await storage.set({ [BCR_EVALUATOR_CONFIG_KEY]: config });
  return { ok: true, synced: true, model: config.model };
}

function isKnownContinuationRunMutation(mutation: ContinuationRunMutation): boolean {  switch (mutation.type) {
    case "get_active":
      return typeof mutation.providerConversationRef === "string" && mutation.providerConversationRef.trim() !== "";
    case "start":
      return !!mutation.input && typeof mutation.input === "object" &&
        typeof mutation.input.runId === "string" && mutation.input.runId.trim() !== "" &&
        typeof mutation.input.workItemId === "string" && mutation.input.workItemId.trim() !== "" &&
        typeof mutation.input.logicalThreadId === "string" && mutation.input.logicalThreadId.trim() !== "" &&
        typeof mutation.input.providerConversationRef === "string" && mutation.input.providerConversationRef.trim() !== "" &&
        typeof mutation.input.bindingEpoch === "number" && Number.isFinite(mutation.input.bindingEpoch) &&
        typeof mutation.input.maxContinuations === "number" && Number.isFinite(mutation.input.maxContinuations) &&
        typeof mutation.input.now === "number" && Number.isFinite(mutation.input.now);
    case "apply":
      return typeof mutation.runId === "string" && mutation.runId.trim() !== "" &&
        !!mutation.event && typeof mutation.event === "object" && typeof mutation.event.type === "string" &&
        typeof mutation.now === "number" && Number.isFinite(mutation.now);
    case "check_dispatch":
      return typeof mutation.runId === "string" && mutation.runId.trim() !== "" &&
        typeof mutation.providerConversationRef === "string" && mutation.providerConversationRef.trim() !== "" &&
        typeof mutation.bindingEpoch === "number" && Number.isFinite(mutation.bindingEpoch);
    case "record_round_evidence":
      return typeof mutation.runId === "string" && mutation.runId.trim() !== "" &&
        Number.isInteger(mutation.continuationIndex) && mutation.continuationIndex >= 1 &&
        typeof mutation.capturedAt === "number" && Number.isFinite(mutation.capturedAt) &&
        typeof mutation.decision === "string" && typeof mutation.humanAction === "string" &&
        (mutation.vetoHit === undefined || typeof mutation.vetoHit === "boolean");
    case "attach_candidate":
      return !!mutation.candidate && typeof mutation.candidate === "object" &&
        typeof mutation.candidate.candidateId === "string" && mutation.candidate.candidateId.trim() !== "";
  }
}

function getSubmissionOperationCoordinator(): SubmissionOperationLedger | undefined {
  const storage = chrome.storage?.local;
  if (!storage) return undefined;
  submissionOperationCoordinator ??= new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false }));
  return submissionOperationCoordinator;
}
function isCreateChildIntentWire(value: unknown): boolean {
  // The wire form of a spawn request intent; the ledger re-validates fully.
  return isCreateChildIntentInput(value);
}

let childWorkerLedger: ChildWorkerLedger | undefined;

function getChildWorkerLedger(): ChildWorkerLedger | undefined {
  const storage = chrome.storage?.local;
  if (!storage) return undefined;
  childWorkerLedger ??= new ChildWorkerLedger(createChromeChildWorkerStore(storage));
  return childWorkerLedger;
}
let resultDeliveryLedger: ResultDeliveryLedger | undefined;

function getResultDeliveryLedger(): ResultDeliveryLedger | undefined {
  const storage = chrome.storage?.local;
  if (!storage) return undefined;
  resultDeliveryLedger ??= new ResultDeliveryLedger(createChromeResultDeliveryStore(storage));
  return resultDeliveryLedger;
}
let executionJournal: ProviderExecutionJournal | undefined;

function getExecutionJournal(): ProviderExecutionJournal | undefined {
  const storage = chrome.storage?.local;
  if (!storage) return undefined;
  executionJournal ??= new ProviderExecutionJournal(createChromeExecutionJournalStore(storage));
  return executionJournal;
}
let controlStateReducer: Promise<DurableOperationalStateReducer> | undefined;

function getControlStateReducer(): Promise<DurableOperationalStateReducer> | undefined {
  const storage = chrome.storage?.local;
  if (!storage) return undefined;
  if (!controlStateReducer) {
    const restore = DurableOperationalStateReducer.restore(createChromeOperationalStateReducerStore(storage));
    // A transient restore failure must not poison the delivery lane: drop the
    // cached promise so the next probe retries instead of failing forever.
    controlStateReducer = restore.catch(error => {
      controlStateReducer = undefined;
      throw error;
    });
  }
  return controlStateReducer;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isWorkItemMessage(message)) {
    handleWorkItemMessage(message, sender)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          errorCode: error instanceof Error && "code" in error ? String(error.code) : "work_item_failed",
          message: error instanceof Error ? error.message : "Work Item action failed."
        })
      );
    return true;
  }

  if (message?.type === "NOOS_CONTINUATION_EVALUATE") {
    if (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || !isAllowedProviderSender(sender)) {
      sendResponse({ ok: false, error: "sender_not_allowed" });
      return false;
    }
    handleContinuationEvaluate(message)
      .then(result => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "NOOS_CONTINUATION_EVAL_CONFIG") {
    if (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || !isAllowedProviderSender(sender)) {
      sendResponse({ ok: false, error: "sender_not_allowed" });
      return false;
    }
    handleContinuationEvalConfig(message)
      .then(result => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "NOOS_CONTINUATION_EVAL_SYNC") {
    if (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || !isAllowedProviderSender(sender)) {
      sendResponse({ ok: false, error: "sender_not_allowed" });
      return false;
    }
    handleContinuationEvalSync()
      .then(result => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "NOOS_CONTINUATION_RUN_MUTATION") {
    if (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || !isAllowedProviderSender(sender)) {
      sendResponse({ ok: false, error: "sender_not_allowed" });
      return false;
    }
    handleContinuationRunMutation(message.mutation as ContinuationRunMutation)
      .then(result => sendResponse(result.ok
        ? { ok: true, run: result.run, budgetCap: BCR_EXPERIMENTAL_MAX_BUDGET }
        : { ok: false, error: result.error }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "NOOS_SUBMISSION_AUTHORITY") {
    const submissions = getSubmissionOperationCoordinator();
    const logicalThreadId = (message as { logicalThreadId?: unknown }).logicalThreadId;
    if (!submissions || !isAllowedProviderSender(sender) || !isNonEmptyString(logicalThreadId)) {
      sendResponse({ ok: false });
      return false;
    }
    submissions.authorityFor(logicalThreadId)
      .then(authority => sendResponse({ ok: true, authority }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "NOOS_OUTBOX_MUTATION") {
    if (sender.frameId !== 0 || !isAllowedProviderSender(sender)) {
      sendResponse({ ok: false, error: "sender_not_allowed" });
      return false;
    }
    handleOutboxMutation(message.mutation as OutboxMutation)
      .then(result => sendResponse(result.ok ? { ok: true, item: result.item, queue: result.state } : { ok: false, error: result.error, queue: result.state }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "NOOS_OUTBOX_PROBE") {
    if (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || !isAllowedProviderSender(sender) ||
      (message.carrier as { targetCarrierRef?: unknown } | undefined)?.targetCarrierRef !== `browser-tab:${sender.tab!.id}`) {
      sendResponse({ ok: false, error: "sender_not_allowed" });
      return false;
    }
    handleOutboxProbe(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "NOOS_GOAL_REANCHOR_PROBE") {
    const coordinator = getSubmissionOperationCoordinator();
    if (!coordinator || sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) ||
      !isAllowedProviderSender(sender) || !isClaimContext(message.context) || !isBaseline(message.baseline) ||
      message.context.targetCarrierRef !== `browser-tab:${sender.tab!.id}` ||
      message.baseline.conversationRef !== message.context.providerConversationRef) {
      sendResponse({ ok: false });
      return false;
    }
    runGoalReanchorProbe(message, chrome.storage.local, coordinator, async operation => {
      const result = await chrome.tabs.sendMessage(sender.tab!.id!, { type: "NOOS_DISPATCH_GOAL_REANCHOR", operation }, { frameId: 0 });
      if (!result?.ok || !isObservation(result.observation)) throw new Error("reanchor_dispatch_uncertain");
      await coordinator.record(operation.operationId, "DISPATCHING", { now: result.observation.observedAt,
        dispatchReceipt: { claimedAt: operation.dispatchClaimedAt!, attemptedAt: result.observation.observedAt,
          outcome: "dispatched", fence: operation.dispatchFence! } });
      return result.observation;
    }).then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "NOOS_CHILD_DELIVERY_PROBE") {
    const submissions = getSubmissionOperationCoordinator();
    const children = getChildWorkerLedger();
    const deliveries = getResultDeliveryLedger();
    if (!submissions || !children || !deliveries || sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) ||
      !isAllowedProviderSender(sender) || !isClaimContext(message.context) || !isBaseline(message.baseline) ||
      message.context.targetCarrierRef !== `browser-tab:${sender.tab!.id}` ||
      message.baseline.conversationRef !== message.context.providerConversationRef) {
      sendResponse({ ok: false });
      return false;
    }
    const controlPromise = getControlStateReducer();
    Promise.resolve(controlPromise).then(control => runChildDeliveryProbe(message, chrome.storage.local, {
      children, deliveries, submissions,
      journal: getExecutionJournal(),
      control
    }, async operation => {
      const result = await chrome.tabs.sendMessage(sender.tab!.id!, { type: "NOOS_DISPATCH_DELIVER_CHILD_RESULT", operation }, { frameId: 0 });
      if (!result?.ok || !isObservation(result.observation)) throw new Error("delivery_dispatch_uncertain");
      return result.observation;
    })).then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "NOOS_CHILD_SPAWN_REQUEST" && sender.frameId === 0 &&
    Number.isSafeInteger(sender.tab?.id) && isAllowedProviderSender(sender) &&
    isCreateChildIntentWire(message.intent)) {
    const ledger = getChildWorkerLedger();
    if (!ledger) {
      sendResponse({ ok: false, error: "child_ledger_unavailable" });
      return false;
    }
    // The tab opens only inside the openTab callback — after the strategy
    // gate and intent validation, so a refusal (spawn_needs_human, reuse
    // conflict, not-resumable) never leaks an orphan tab.
    requestBrowserChildSpawn(ledger, chrome.storage.local, async () => {
      const tab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: false });
      if (!Number.isSafeInteger(tab.id)) throw new Error("spawn_tab_unavailable");
      return tab.id!;
    }, { intent: message.intent })
      .then(result => sendResponse({ ok: true, result: { childThreadId: result.child.childThreadId, state: result.child.state, tabId: result.tabId } }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : "child_spawn_failed" }));
    return true;
  }

  if (message?.type === "NOOS_CHILD_SPAWN_ADOPT" && sender.frameId === 0 &&
    Number.isSafeInteger(sender.tab?.id) && isAllowedProviderSender(sender) &&
    (message.providerConversationRef === undefined || typeof message.providerConversationRef === "string")) {
    const ledger = getChildWorkerLedger();
    if (!ledger) {
      sendResponse({ ok: false, error: "child_ledger_unavailable" });
      return false;
    }
    adoptBrowserChildSpawn(ledger, chrome.storage.local, {
      tabId: sender.tab!.id!,
      // When the tab URL already carries a conversation id, the claim must
      // match it — a tab cannot adopt an identity from another conversation.
      providerConversationRef: message.providerConversationRef === undefined
        ? undefined
        : ((): string => {
            const urlRef = extractProviderConversationId(sender.tab?.url ?? "");
            if (urlRef && urlRef !== message.providerConversationRef) {
              throw new Error("adoption_url_mismatch");
            }
            return message.providerConversationRef;
          })()
    })
      .then(result => sendResponse({ ok: true, result: result.status === "ADOPTED"
        ? { status: result.status, childThreadId: result.child.childThreadId, state: result.child.state }
        : { status: result.status } }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : "child_adoption_failed" }));
    return true;
  }

  if (isSubmissionMutationMessage(message, sender)) {
    const coordinator = getSubmissionOperationCoordinator();
    if (!coordinator) {
      sendResponse({ ok: false, error: "submission_coordinator_unavailable" });
      return false;
    }
    initializeSubmissionAuthority(coordinator, message.mutation)
      .then(() => applySubmissionMutation(coordinator, message.mutation))
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : "submission_claim_failed" }));
    return true;
  }

  if (isChildMutationMessage(message, sender)) {
    const ledger = getChildWorkerLedger();
    if (!ledger) {
      sendResponse({ ok: false, error: "child_ledger_unavailable" });
      return false;
    }
    applyChildMutation(ledger, message.mutation)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : "child_mutation_failed" }));
    return true;
  }

  if (message?.type === "NOOS_OBSERVATION_CARRIER" && sender.frameId === 0 && sender.tab?.id !== undefined) {
    sendResponse({ carrierRef: `browser-tab:${sender.tab.id}`, windowId: sender.tab.windowId, documentId: sender.documentId });
    return false;
  }
  if (isVaultSaveMessage(message)) {
    saveMarkdownToVault(message.filename, message.content, "handoff", sender.tab?.url)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "NOOS Vault save failed."
        });
      });

    return true;
  }

  if (isCrystalSaveMessage(message)) {
    saveMarkdownToVault(message.filename, message.content, "crystal", sender.tab?.url)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "NOOS Vault save failed."
        });
      });

    return true;
  }

  if (isContextPackSaveMessage(message)) {
    saveContextPackToVault(message.directory, message.files, message.sourceUrl)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "context_pack_save_failed",
          message: error instanceof Error ? error.message : "Context Pack save failed."
        });
      });

    return true;
  }

  if (isArtifactDownloadMessage(message)) {
    downloadArtifactsToMirror(message.directory, message.files)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "artifact_download_failed",
          message: error instanceof Error ? error.message : "Artifact download failed."
        });
      });

    return true;
  }

  if (isVaultStatusMessage(message)) {
    getVaultStatus().then(sendResponse);
    return true;
  }

  if (isVaultRecentMessage(message)) {
    getVaultRecentObjects()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "Could not load NOOS Vault objects."
        });
      });
    return true;
  }

  if (isVaultBrowseMessage(message)) {
    getVaultBrowseObjects(message.folder, message.query)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "Could not browse NOOS Vault."
        });
      });
    return true;
  }

  if (isVaultObjectMessage(message)) {
    getVaultObject(message.lookupKey)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "Could not load NOOS Vault object."
        });
      });
    return true;
  }

  if (isWikiTargetMessage(message)) {
    getWikiTarget()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "hub_unavailable",
          message: error instanceof Error ? error.message : "Could not load default Wiki project."
        });
      });
    return true;
  }

  if (isFeishuWikiActionMessage(message)) {
    runFeishuWikiAction(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          status: "hub_unavailable",
          errorCode: "hub_unavailable",
          message: error instanceof Error ? error.message : "NOOS Hub action failed."
        });
      });
    return true;
  }

  if (isFeishuPublishMarkdownMessage(message)) {
    runFeishuPublishMarkdown(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          status: "hub_unavailable",
          errorCode: "hub_unavailable",
          message: error instanceof Error ? error.message : "NOOS Hub publish action failed."
        });
      });
    return true;
  }

  return false;
});

type ChildWorkerMutation =
  | { type: "list" }
  | { type: "create_intent"; input: CreateChildIntentInput }
  | { type: "begin_spawn" | "mark_spawn_uncertain" | "prove_non_creation" | "activate" | "begin_return" | "complete" | "retire" | "mark_broken" | "cancel"; childThreadId: string; now?: number }
  | { type: "bind_conversation"; childThreadId: string; binding: { providerConversationRef: string; carrierRef: string }; now?: number }
  | { type: "record_result"; childThreadId: string; result: { resultRef: string; completionReceipt: string }; now?: number };

function isChildMutationMessage(value: unknown, sender: chrome.runtime.MessageSender): value is { type: "NOOS_CHILD_MUTATION"; mutation: ChildWorkerMutation } {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<{ type: string; mutation: ChildWorkerMutation }>;
  return message.type === "NOOS_CHILD_MUTATION" &&
    sender.frameId === 0 &&
    Number.isSafeInteger(sender.tab?.id) &&
    isAllowedProviderSender(sender) &&
    isChildWorkerMutation(message.mutation);
}

function isChildWorkerMutation(value: unknown): value is ChildWorkerMutation {
  if (!value || typeof value !== "object") return false;
  const mutation = value as Partial<ChildWorkerMutation> & { childThreadId?: unknown; input?: unknown; binding?: unknown; result?: unknown; now?: unknown };
  if (typeof mutation.type !== "string") return false;
  const soloTypes = ["begin_spawn", "mark_spawn_uncertain", "prove_non_creation", "activate", "begin_return", "complete", "retire", "mark_broken", "cancel"];
  if (mutation.type === "list") return true;
  if (mutation.type === "create_intent") return isCreateChildIntentInput(mutation.input);
  if (soloTypes.includes(mutation.type)) return isOperationId(mutation.childThreadId) && (mutation.now === undefined || isFiniteInteger(mutation.now));
  if (mutation.type === "bind_conversation") {
    const binding = mutation.binding as Record<string, unknown> | undefined;
    return isOperationId(mutation.childThreadId) &&
      Boolean(binding && typeof binding.providerConversationRef === "string" && (binding.providerConversationRef as string).trim().length > 0 &&
        typeof binding.carrierRef === "string" && (binding.carrierRef as string).trim().length > 0) &&
      (mutation.now === undefined || isFiniteInteger(mutation.now));
  }
  if (mutation.type === "record_result") {
    const result = mutation.result as Record<string, unknown> | undefined;
    return isOperationId(mutation.childThreadId) &&
      Boolean(result && typeof result.resultRef === "string" && (result.resultRef as string).trim().length > 0 &&
        typeof result.completionReceipt === "string" && (result.completionReceipt as string).trim().length > 0) &&
      (mutation.now === undefined || isFiniteInteger(mutation.now));
  }
  return false;
}

async function applyChildMutation(ledger: ChildWorkerLedger, mutation: ChildWorkerMutation): Promise<unknown> {
  switch (mutation.type) {
    case "list": return ledger.list();
    case "create_intent": return ledger.createIntent(mutation.input);
    case "begin_spawn": return ledger.beginSpawn(mutation.childThreadId, mutation.now);
    case "mark_spawn_uncertain": return ledger.markSpawnUncertain(mutation.childThreadId, mutation.now);
    case "bind_conversation": return ledger.bindConversation(mutation.childThreadId, mutation.binding, mutation.now);
    case "prove_non_creation": return ledger.proveNonCreation(mutation.childThreadId, mutation.now);
    case "activate": return ledger.activate(mutation.childThreadId, mutation.now);
    case "record_result": return ledger.recordResult(mutation.childThreadId, mutation.result, mutation.now);
    case "begin_return": return ledger.beginReturn(mutation.childThreadId, mutation.now);
    case "complete": return ledger.complete(mutation.childThreadId, mutation.now);
    case "retire": return ledger.retire(mutation.childThreadId, mutation.now);
    case "mark_broken": return ledger.markBroken(mutation.childThreadId, mutation.now);
    case "cancel": return ledger.cancel(mutation.childThreadId, mutation.now);
    default: throw new Error("unsupported_child_mutation");
  }
}

async function initializeSubmissionAuthority(coordinator: SubmissionOperationLedger, mutation: SubmissionOperationMutation): Promise<void> {
  if (mutation.type === "claim" || mutation.type === "initialize_authority") {
    await coordinator.initializeAuthority(mutation.context);
  }
}

function isSubmissionMutationMessage(value: unknown, sender: chrome.runtime.MessageSender): value is { type: "NOOS_SUBMISSION_MUTATION"; mutation: SubmissionOperationMutation } {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<{ type: string; mutation: SubmissionOperationMutation }>;
  return message.type === "NOOS_SUBMISSION_MUTATION" &&
    sender.frameId === 0 &&
    Number.isSafeInteger(sender.tab?.id) &&
    isAllowedProviderSender(sender) &&
    isSubmissionOperationMutation(message.mutation);
}

async function applySubmissionMutation(coordinator: SubmissionOperationLedger, mutation: SubmissionOperationMutation): Promise<unknown> {
  switch (mutation.type) {
    case "list":
      return coordinator.list();
    case "initialize_authority":
      return true;
    case "recover":
      return coordinator.recover(mutation.operationId, mutation.context, mutation.now);
    case "prepare":
      return coordinator.prepare(mutation.input);
    case "claim":
      return coordinator.claim(mutation.operationId, mutation.context, mutation.now);
    case "retarget":
      return coordinator.retarget(mutation.operationId, mutation.context, mutation.baseline, mutation.now);
    case "record":
      return coordinator.record(mutation.operationId, mutation.state, mutation.details);
    case "rearm":
      return coordinator.rearm(mutation.operationId, mutation.baseline, mutation.fence, mutation.now);
    case "reconcile":
      return coordinator.reconcile(mutation.operationId, mutation.observation);
    default:
      throw new Error("unsupported_submission_mutation");
  }
}

function isAllowedProviderSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id && chrome.runtime.id && sender.id !== chrome.runtime.id) return false;
  if (!sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname.endsWith(".chatgpt.com") || url.hostname === "chat.openai.com");
  } catch {
    return false;
  }
}

function isSubmissionOperationMutation(value: unknown): value is SubmissionOperationMutation {
  if (!value || typeof value !== "object") return false;
  const mutation = value as Partial<SubmissionOperationMutation>;
  if (typeof mutation.type !== "string") return false;
  if (mutation.type === "list") return true;
  if (mutation.type === "initialize_authority") return isClaimContext(mutation.context);
  if (mutation.type === "recover") return Boolean(isOperationId(mutation.operationId) && isFiniteInteger(mutation.now) && isClaimContext(mutation.context));
  if (mutation.type === "claim") return Boolean(isOperationId(mutation.operationId) && isFiniteInteger(mutation.now) && isClaimContext(mutation.context));
  if (mutation.type === "retarget") return Boolean(isOperationId(mutation.operationId) && isFiniteInteger(mutation.now) && isClaimContext(mutation.context) && isBaseline(mutation.baseline));
  if (mutation.type === "prepare") return isPrepareInput(mutation.input);
  if (mutation.type === "record") return Boolean(isOperationId(mutation.operationId) && isRecordableState(mutation.state) && isRecordDetails(mutation.details));
  if (mutation.type === "rearm") return Boolean(isOperationId(mutation.operationId) && isFiniteInteger(mutation.now) && isBaseline(mutation.baseline) && isDispatchFence(mutation.fence));
  if (mutation.type === "reconcile") return Boolean(isOperationId(mutation.operationId) && isObservation(mutation.observation));
  return false;
}

function isPrepareInput(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return isOperationId(input.operationId) &&
    ["GO", "REANCHOR_GOAL", "BOOTSTRAP", "REVIEW_DISPATCH", "SEDIMENT", "DELIVER_CHILD_RESULT", "OUTBOX_MESSAGE"].includes(input.operationKind as string) &&
    isNonEmptyString(input.workItemId) &&
    isNonEmptyString(input.logicalThreadId) &&
    isNonEmptyString(input.targetCarrierRef) &&
    isNonEmptyString(input.providerConversationRef) &&
    isDispatchFence(input.dispatchFence) &&
    (input.dispatchFence as Record<string, unknown>).providerConversationRef === input.providerConversationRef &&
    (input.dispatchFence as Record<string, unknown>).targetCarrierRef === input.targetCarrierRef &&
    isNonEmptyString(input.payloadFingerprint) &&
    (input.payload === undefined || typeof input.payload === "string") &&
    (input.parentEpoch === undefined || (isFiniteInteger(input.parentEpoch) && input.parentEpoch >= 0)) &&
    isBaseline(input.preSubmitBaseline);
}

function isClaimContext(value: unknown): boolean {
  if (!isDispatchFence(value)) return false;
  const context = value as Record<string, unknown>;
  return typeof context.logicalThreadId === "string" && context.logicalThreadId.trim().length > 0 &&
    context.carrierState === "READY" && context.logicalControl === "CONTINUE" && context.explicitGo === true &&
    isFiniteInteger(context.sourceEpoch) && context.sourceEpoch >= 0 &&
    isFiniteInteger(context.sourceObservedAt) && context.sourceObservedAt >= 0;
}

function isDispatchFence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const fence = value as Record<string, unknown>;
  return typeof fence.providerConversationRef === "string" &&
    fence.providerConversationRef.length > 0 &&
    isFiniteInteger(fence.bindingEpoch) &&
    fence.bindingEpoch >= 0 &&
    isFiniteInteger(fence.leaseGeneration) &&
    fence.leaseGeneration >= 0 &&
    typeof fence.leaseOwnerRef === "string" &&
    fence.leaseOwnerRef.length > 0 &&
    typeof fence.targetCarrierRef === "string" &&
    fence.targetCarrierRef.length > 0;
}

function isBaseline(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const baseline = value as Record<string, unknown>;
  return typeof baseline.routeRef === "string" &&
    isFiniteInteger(baseline.assistantMessageCount) &&
    baseline.assistantMessageCount >= 0 &&
    isFiniteInteger(baseline.userMessageCount) &&
    baseline.userMessageCount >= 0 &&
    isFiniteInteger(baseline.observedAt) &&
    (baseline.conversationRef === undefined || typeof baseline.conversationRef === "string") &&
    (baseline.lastUserMessageFingerprint === undefined || typeof baseline.lastUserMessageFingerprint === "string") &&
    (baseline.lastAssistantMessageFingerprint === undefined || typeof baseline.lastAssistantMessageFingerprint === "string") &&
    (baseline.headFingerprint === undefined || typeof baseline.headFingerprint === "string");
}

function isObservation(value: unknown): boolean {
  if (!isBaseline(value)) return false;
  const observation = value as Record<string, unknown>;
  return (observation.conversationRef === undefined || typeof observation.conversationRef === "string") &&
    isFiniteInteger(observation.sourceEpoch) &&
    observation.sourceEpoch >= 0 &&
    isDispatchFence(observation.dispatchFence) &&
    (observation.generationActive === undefined || typeof observation.generationActive === "boolean") &&
    (observation.stableSince === undefined || (isFiniteInteger(observation.stableSince) && observation.stableSince >= 0)) &&
    (observation.providerFailure === undefined || typeof observation.providerFailure === "boolean") &&
    (observation.assistantMessageCount === undefined || isFiniteInteger(observation.assistantMessageCount)) &&
    (observation.userMessageCount === undefined || isFiniteInteger(observation.userMessageCount)) &&
    (observation.lastUserMessageFingerprint === undefined || typeof observation.lastUserMessageFingerprint === "string") &&
    (observation.lastAssistantMessageFingerprint === undefined || typeof observation.lastAssistantMessageFingerprint === "string") &&
    (observation.headFingerprint === undefined || typeof observation.headFingerprint === "string");
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}

function isRecordableState(value: unknown): boolean {
  return value === "DISPATCHING" || value === "COMPLETED" || value === "UNCERTAIN" || value === "CANCELLED";
}

function isRecordDetails(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const details = value as Record<string, unknown>;
  return (details.now === undefined || isFiniteInteger(details.now)) &&
    (details.error === undefined || typeof details.error === "string") &&
    (details.resultingTurnRef === undefined || typeof details.resultingTurnRef === "string") &&
    (details.dispatchReceipt === undefined || isDispatchReceipt(details.dispatchReceipt));
}

function isDispatchReceipt(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return isFiniteInteger(receipt.claimedAt) && receipt.claimedAt >= 0 &&
    isFiniteInteger(receipt.attemptedAt) && receipt.attemptedAt >= receipt.claimedAt &&
    (receipt.outcome === "dispatched" || receipt.outcome === "uncertain") &&
    isDispatchFence(receipt.fence);
}

interface VaultSaveMessage {
  type: "NOOS_SAVE_HANDOFF_TO_VAULT";
  filename: string;
  content: string;
}

type WorkItemAction =
  | "snapshot"
  | "challenge"
  | "confirm-authorization"
  | "cancel-authorization"
  | "create"
  | "capture-thread"
  | "capture-crystal"
  | "accept-absorb"
  | "save-candidate-proposal"
  | "reject-candidate-diff"
  | "update-review"
  | "prepare-cold-start"
  | "reject"
  | "cancel"
  | "discard"
  | "promote"
  | "activate";

interface WorkItemMessage {
  type: "NOOS_WORK_ITEM";
  action: WorkItemAction;
  workItemId?: string;
  inboxItemId?: string;
  expectedRevision?: number;
  inboxItemIds?: string[];
  reason?: string;
  input?: CreateWorkItemInput;
  thread?: NoosThread;
  crystal?: NoosCrystal;
  options?: AbsorbOptions;
  changes?: { reviewNotes?: string[]; openQuestions?: string[]; blockingOpenQuestions?: string[] };
  candidate?: { baseRevision: number; diff: string };
  proposal?: Omit<CandidateProposal, "proposalId" | "workItemId" | "updatedAt" | "state">;
  proposalId?: string;
  conversationId?: string;
  carrierRef?: string;
  authorizationToken?: string;
  challengeToken?: string;
  confirmed?: true;
  authorizationAction?: "activate" | "prepare-cold-start";
}

interface WorkItemAuthorization {
  token: string;
  action: "activate" | "prepare-cold-start";
  workItemId: string;
  expectedRevision: number;
  conversationId: string;
  tabId: number;
  expiresAt: number;
  state: "CHALLENGED" | "AVAILABLE" | "CLAIMED";
}

const workItemAuthorizations = new Map<string, WorkItemAuthorization>();
const WORK_ITEM_AUTHORIZATION_TTL_MS = 60_000;

function senderConversationId(sender?: chrome.runtime.MessageSender): string | undefined {
  return extractProviderConversationId(sender?.tab?.url);
}

function requireSenderConversation(
  message: WorkItemMessage,
  sender?: chrome.runtime.MessageSender
): string {
  const observed = senderConversationId(sender);
  if (!observed) {
    const error = new Error("The sender tab has no confirmed provider conversation.");
    Object.assign(error, { code: "conversation_identity_required" });
    throw error;
  }
  if (message.conversationId !== observed) {
    const error = new Error("The message conversation does not match the sender tab.");
    Object.assign(error, { code: "conversation_binding_mismatch" });
    throw error;
  }
  return observed;
}

function requireCreateBindingFromSender(
  input: CreateWorkItemInput | undefined,
  sender?: chrome.runtime.MessageSender
): void {
  const requested = input?.binding;
  if (!requested?.conversationId) return;
  const observed = senderConversationId(sender);
  const expectedCarrier = sender?.tab?.id === undefined ? undefined : `browser-tab:${sender.tab.id}`;
  if (
    !observed ||
    requested.conversationId !== observed ||
    (requested.carrierRef !== undefined && requested.carrierRef !== expectedCarrier)
  ) {
    const error = new Error("The Work Item binding does not match the sender tab.");
    Object.assign(error, { code: "conversation_binding_mismatch" });
    throw error;
  }
}

function authorizationToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `work-item-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function purgeExpiredAuthorizations(now = Date.now()): void {
  for (const [token, authorization] of workItemAuthorizations) {
    if (authorization.expiresAt <= now) workItemAuthorizations.delete(token);
  }
}

function isWorkItemMessage(value: unknown): value is WorkItemMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Partial<WorkItemMessage>;
  return (
    message.type === "NOOS_WORK_ITEM" &&
    typeof message.action === "string" &&
    [
      "snapshot",
      "challenge",
      "confirm-authorization",
      "cancel-authorization",
      "create",
      "capture-thread",
      "capture-crystal",
      "accept-absorb",
      "save-candidate-proposal",
      "reject-candidate-diff",
      "update-review",
      "prepare-cold-start",
      "reject",
      "cancel",
      "discard",
      "promote",
      "activate"
    ].includes(message.action)
  );
}

async function handleWorkItemMessage(
  message: WorkItemMessage,
  sender?: chrome.runtime.MessageSender
): Promise<{ ok: true; data: unknown }> {
  purgeExpiredAuthorizations();
  const activeId = message.workItemId ?? (await workItemInbox.snapshot()).activeWorkItemId;
  if (message.action !== "snapshot" && message.action !== "create" && !activeId) {
    throw new Error("No active Work Item is selected.");
  }
  if (message.action === "create") {
    requireCreateBindingFromSender(message.input, sender);
  }
  const needsConversation = message.action !== "snapshot" && message.action !== "create";
  const conversationId = needsConversation ? requireSenderConversation(message, sender) : undefined;
  const binding: WorkItemBinding = {
    conversationId,
    carrierRef: sender?.tab?.id === undefined ? undefined : `browser-tab:${sender.tab.id}`
  };

  if (message.action === "challenge") {
    if (
      sender?.tab?.id === undefined ||
      (message.authorizationAction !== "activate" && message.authorizationAction !== "prepare-cold-start") ||
      message.expectedRevision === undefined
    ) {
      throw new WorkItemValidationError("authorization_challenge_invalid", "An authorization challenge needs a tab, action, and revision.");
    }
    const snapshot = await workItemInbox.snapshot();
    const target = snapshot.workItems.find((item) => item.workItemId === activeId);
    if (!target || target.revision !== message.expectedRevision) {
      throw new WorkItemConflictError();
    }
    if (message.authorizationAction === "prepare-cold-start") {
      await workItemInbox.validateBinding(target.workItemId, binding);
    } else if (
      target.binding &&
      (target.binding.conversationId !== binding.conversationId || target.binding.carrierRef !== binding.carrierRef)
    ) {
      throw new WorkItemValidationError("conversation_binding_mismatch", "This Work Item is bound to a different conversation.");
    }
    const token = authorizationToken();
    workItemAuthorizations.set(token, {
      token,
      action: message.authorizationAction,
      workItemId: target.workItemId,
      expectedRevision: target.revision,
      conversationId: conversationId as string,
      tabId: sender.tab.id,
      expiresAt: Date.now() + WORK_ITEM_AUTHORIZATION_TTL_MS,
      state: "CHALLENGED"
    });
    return {
      ok: true,
      data: { challengeToken: token, workItemId: target.workItemId, expectedRevision: target.revision, action: message.authorizationAction }
    };
  }

  if (message.action === "confirm-authorization") {
    const challenge = message.challengeToken ? workItemAuthorizations.get(message.challengeToken) : undefined;
    const now = Date.now();
    if (
      message.confirmed !== true ||
      !challenge ||
      challenge.state !== "CHALLENGED" ||
      challenge.expiresAt <= now ||
      challenge.action !== message.authorizationAction ||
      challenge.workItemId !== activeId ||
      challenge.expectedRevision !== message.expectedRevision ||
      challenge.tabId !== sender?.tab?.id ||
      challenge.conversationId !== conversationId
    ) {
      if (challenge?.expiresAt !== undefined && challenge.expiresAt <= now && message.challengeToken) {
        workItemAuthorizations.delete(message.challengeToken);
      }
      throw new WorkItemValidationError("authorization_confirmation_required", "A confirmed background authorization is required.");
    }
    workItemAuthorizations.delete(challenge.token);
    const token = authorizationToken();
    workItemAuthorizations.set(token, { ...challenge, token, state: "AVAILABLE", expiresAt: now + WORK_ITEM_AUTHORIZATION_TTL_MS });
    return {
      ok: true,
      data: { authorizationToken: token, workItemId: challenge.workItemId, expectedRevision: challenge.expectedRevision, action: challenge.action }
    };
  }

  if (message.action === "cancel-authorization") {
    const challenge = message.challengeToken ? workItemAuthorizations.get(message.challengeToken) : undefined;
    if (
      !challenge ||
      challenge.state !== "CHALLENGED" ||
      challenge.action !== message.authorizationAction ||
      challenge.workItemId !== activeId ||
      challenge.expectedRevision !== message.expectedRevision ||
      challenge.tabId !== sender?.tab?.id ||
      challenge.conversationId !== conversationId
    ) {
      throw new WorkItemValidationError("authorization_confirmation_required", "The authorization challenge is no longer available.");
    }
    workItemAuthorizations.delete(challenge.token);
    return { ok: true, data: { cancelled: true } };
  }

  if (message.action !== "snapshot" && message.action !== "create") {
    if (message.action !== "activate" && message.action !== "prepare-cold-start") {
      await workItemInbox.validateBinding(activeId as string, binding);
    }
  }

  let authorization: WorkItemAuthorization | undefined;
  if (message.action === "activate" || message.action === "prepare-cold-start") {
    const token = message.authorizationToken;
    authorization = token ? workItemAuthorizations.get(token) : undefined;
    const now = Date.now();
    if (authorization?.state === "CLAIMED") {
      throw new WorkItemValidationError("authorization_in_flight", "This authorization is already being consumed.");
    }
    if (
      !authorization ||
      authorization.expiresAt <= now ||
      authorization.state !== "AVAILABLE" ||
      authorization.action !== message.action ||
      authorization.workItemId !== activeId ||
      authorization.expectedRevision !== message.expectedRevision ||
      authorization.tabId !== sender?.tab?.id ||
      authorization.conversationId !== conversationId
    ) {
      if (authorization?.expiresAt !== undefined && authorization.expiresAt <= now && token) {
        workItemAuthorizations.delete(token);
      }
      throw new WorkItemValidationError("authorization_required", "A valid one-time background authorization is required.");
    }
    authorization.state = "CLAIMED";
  }
  switch (message.action) {
    case "snapshot":
      return { ok: true, data: await workItemInbox.snapshot() };
    case "create":
      return { ok: true, data: await workItemInbox.createWorkItem(message.input as CreateWorkItemInput) };
    case "capture-thread":
      return { ok: true, data: await workItemInbox.captureThread(activeId as string, message.thread as NoosThread, undefined, binding) };
    case "capture-crystal":
      return { ok: true, data: await workItemInbox.captureCrystal(activeId as string, message.crystal as NoosCrystal, undefined, binding) };
    case "accept-absorb":
      return {
        ok: true,
        data: await workItemInbox.acceptAbsorb(
          activeId as string,
          message.inboxItemIds ?? [],
          message.expectedRevision as number,
          { ...message.options, candidate: message.candidate ?? message.options?.candidate }
        )
      };
    case "save-candidate-proposal":
      return {
        ok: true,
        data: await workItemInbox.saveCandidateProposal(
          activeId as string,
          message.expectedRevision as number,
          message.proposal as Omit<CandidateProposal, "proposalId" | "workItemId" | "updatedAt" | "state">
        )
      };
    case "reject-candidate-diff":
      return {
        ok: true,
        data: await workItemInbox.rejectCandidateDiff(
          activeId as string,
          message.proposalId as string,
          message.reason as string,
          message.expectedRevision as number
        )
      };
    case "update-review":
      return {
        ok: true,
        data: await workItemInbox.updateReview(
          activeId as string,
          message.expectedRevision as number,
          message.changes ?? {}
        )
      };
    case "prepare-cold-start":
      try {
        const result = await workItemInbox.prepareColdStart(
          activeId as string,
          message.expectedRevision as number,
          {
            confirmed: true,
            eventId: authorization!.token,
            issuedAt: new Date().toISOString(),
            issuedBy: "background-human-confirmation",
            ...(sender?.tab?.id === undefined ? {} : { tabId: sender.tab.id })
          } as ColdStartApprovalEvent
        );
        workItemAuthorizations.delete(authorization!.token);
        return { ok: true, data: result };
      } catch (error) {
        authorization!.state = "AVAILABLE";
        throw error;
      }
    case "reject":
    case "cancel":
    case "discard":
      return {
        ok: true,
        data: await workItemInbox[message.action](
          activeId as string,
          message.inboxItemId as string,
          message.reason as string,
          message.expectedRevision as number
        )
      };
    case "promote":
      return {
        ok: true,
        data: await workItemInbox.promote(
          activeId as string,
          message.expectedRevision as number,
          message.reason as string
        )
      };
    case "activate":
      try {
        const result = await workItemInbox.activate(
          activeId as string,
          message.expectedRevision as number,
          binding,
          {
            confirmed: true,
            eventId: authorization!.token,
            issuedAt: new Date().toISOString(),
            issuedBy: "background-human-adoption",
            ...(sender?.tab?.id === undefined ? {} : { tabId: sender.tab.id })
          } as WorkItemAdoptionEvent
        );
        workItemAuthorizations.delete(authorization!.token);
        return { ok: true, data: result };
      } catch (error) {
        authorization!.state = "AVAILABLE";
        throw error;
      }
  }
}

interface CrystalSaveMessage {
  type: "NOOS_SAVE_CRYSTAL_TO_VAULT";
  filename: string;
  content: string;
}

interface ContextPackSaveMessage {
  type: "NOOS_SAVE_CONTEXT_PACK_TO_VAULT";
  directory: string;
  files: Array<{ path: string; content: string }>;
  sourceUrl?: string;
}

interface ArtifactDownloadMessage {
  type: "NOOS_DOWNLOAD_ARTIFACTS";
  directory: string;
  files: Array<{ filename: string; url: string }>;
}

interface VaultStatusMessage {
  type: "NOOS_GET_VAULT_STATUS";
}

interface VaultRecentMessage {
  type: "NOOS_GET_VAULT_RECENT";
}

interface VaultBrowseMessage {
  type: "NOOS_BROWSE_VAULT";
  folder?: string;
  query?: string;
}

interface VaultObjectMessage {
  type: "NOOS_GET_VAULT_OBJECT";
  lookupKey: string;
}

interface WikiTargetMessage {
  type: "NOOS_GET_WIKI_TARGET";
}

interface FeishuWikiActionMessage {
  type: "NOOS_FEISHU_WIKI_ACTION";
  action:
    | "export_md"
    | "export_folder_md"
    | "change_category"
    | "organize_wiki"
    | "export_md_and_organize"
    | "export_folder_md_and_organize"
    | "open_markdown_folder"
    | "open_wiki_folder"
    | "sync_markdown"
    | "sync_markdown_and_organize";
  url: string;
  title?: string;
  wikiProjectPath?: string;
  categoryPath?: string;
  folderToken?: string;
  folderName?: string;
}

interface FeishuPublishMarkdownMessage {
  type: "NOOS_FEISHU_PUBLISH_MARKDOWN";
  action: "publish_markdown";
  sourceKey: string;
  mode: "create" | "overwrite";
  destinationKind: "drive_root" | "drive_folder" | "current_doc";
  url: string;
  title?: string;
  folderToken?: string;
  folderName?: string;
}

interface VaultStatusResponse {
  ok: boolean;
  backend: "hub_local" | "downloads_mirror";
  hubAvailable: boolean;
  paired: boolean;
  message: string;
}

function isVaultSaveMessage(value: unknown): value is VaultSaveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<VaultSaveMessage>;
  return message.type === "NOOS_SAVE_HANDOFF_TO_VAULT" && typeof message.filename === "string" && typeof message.content === "string";
}

function isCrystalSaveMessage(value: unknown): value is CrystalSaveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<CrystalSaveMessage>;
  return message.type === "NOOS_SAVE_CRYSTAL_TO_VAULT" && typeof message.filename === "string" && typeof message.content === "string";
}

function isContextPackSaveMessage(value: unknown): value is ContextPackSaveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ContextPackSaveMessage>;
  return (
    message.type === "NOOS_SAVE_CONTEXT_PACK_TO_VAULT" &&
    typeof message.directory === "string" &&
    Array.isArray(message.files) &&
    message.files.every((file) => typeof file?.path === "string" && typeof file?.content === "string")
  );
}

function isArtifactDownloadMessage(value: unknown): value is ArtifactDownloadMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ArtifactDownloadMessage>;
  return (
    message.type === "NOOS_DOWNLOAD_ARTIFACTS" &&
    typeof message.directory === "string" &&
    Array.isArray(message.files) &&
    message.files.every((file) => typeof file?.filename === "string" && typeof file?.url === "string")
  );
}

function isVaultStatusMessage(value: unknown): value is VaultStatusMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<VaultStatusMessage>).type === "NOOS_GET_VAULT_STATUS";
}

function isVaultRecentMessage(value: unknown): value is VaultRecentMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<VaultRecentMessage>).type === "NOOS_GET_VAULT_RECENT";
}

function isVaultBrowseMessage(value: unknown): value is VaultBrowseMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<VaultBrowseMessage>;
  return (
    message.type === "NOOS_BROWSE_VAULT" &&
    (message.folder === undefined || typeof message.folder === "string") &&
    (message.query === undefined || typeof message.query === "string")
  );
}

function isVaultObjectMessage(value: unknown): value is VaultObjectMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<VaultObjectMessage>;
  return message.type === "NOOS_GET_VAULT_OBJECT" && typeof message.lookupKey === "string";
}

function isWikiTargetMessage(value: unknown): value is WikiTargetMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<WikiTargetMessage>).type === "NOOS_GET_WIKI_TARGET";
}

function isFeishuWikiActionMessage(value: unknown): value is FeishuWikiActionMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<FeishuWikiActionMessage>;
  return (
    message.type === "NOOS_FEISHU_WIKI_ACTION" &&
    (message.action === "export_md" ||
      message.action === "export_folder_md" ||
      message.action === "change_category" ||
      message.action === "sync_markdown" ||
      message.action === "organize_wiki" ||
      message.action === "export_md_and_organize" ||
      message.action === "export_folder_md_and_organize" ||
      message.action === "sync_markdown_and_organize" ||
      message.action === "open_markdown_folder" ||
      message.action === "open_wiki_folder") &&
    typeof message.url === "string" &&
    (message.title === undefined || typeof message.title === "string") &&
    (message.wikiProjectPath === undefined || typeof message.wikiProjectPath === "string") &&
    (message.categoryPath === undefined || typeof message.categoryPath === "string") &&
    (message.folderToken === undefined || typeof message.folderToken === "string") &&
    (message.folderName === undefined || typeof message.folderName === "string")
  );
}

function isFeishuPublishMarkdownMessage(value: unknown): value is FeishuPublishMarkdownMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<FeishuPublishMarkdownMessage>;
  return (
    message.type === "NOOS_FEISHU_PUBLISH_MARKDOWN" &&
    message.action === "publish_markdown" &&
    typeof message.sourceKey === "string" &&
    (message.mode === "create" || message.mode === "overwrite") &&
    (message.destinationKind === "drive_root" || message.destinationKind === "drive_folder" || message.destinationKind === "current_doc") &&
    typeof message.url === "string" &&
    (message.title === undefined || typeof message.title === "string") &&
    (message.folderToken === undefined || typeof message.folderToken === "string") &&
    (message.folderName === undefined || typeof message.folderName === "string")
  );
}

async function getVaultRecentObjects(): Promise<unknown> {
  return getAuthorizedHubJson(HUB_VAULT_RECENT_URL);
}

async function getVaultBrowseObjects(folder?: string, query?: string): Promise<unknown> {
  const params = new URLSearchParams();
  if (folder) {
    params.set("folder", folder);
  }
  if (query) {
    params.set("q", query);
  }
  const suffix = params.toString();
  return getAuthorizedHubJson(suffix ? `${HUB_VAULT_BROWSE_URL}?${suffix}` : HUB_VAULT_BROWSE_URL);
}

async function getVaultObject(lookupKey: string): Promise<unknown> {
  return getAuthorizedHubJson(`${HUB_VAULT_OBJECT_URL}?key=${encodeURIComponent(lookupKey)}`);
}

async function getWikiTarget(): Promise<unknown> {
  return normalizeHubPayload(await getAuthorizedHubJson(HUB_WIKI_TARGET_URL));
}

async function runFeishuWikiAction(message: FeishuWikiActionMessage): Promise<unknown> {
  const payload = await postAuthorizedHubJson(HUB_ACTION_URL, {
    command: feishuCommandForAction(message.action),
    url: message.url,
    title: message.title,
    wiki_project_path: message.wikiProjectPath,
    category_path: message.categoryPath,
    folder_token: message.folderToken,
    folder_name: message.folderName,
    force: message.action === "organize_wiki"
  });
  return normalizeHubPayload(payload);
}

async function runFeishuPublishMarkdown(message: FeishuPublishMarkdownMessage): Promise<unknown> {
  const payload = await postAuthorizedHubJson(HUB_ACTION_URL, {
    command: feishuPublishCommandForAction(message.action),
    source_key: message.sourceKey,
    mode: message.mode,
    destination_kind: message.destinationKind,
    url: message.url,
    title: message.title,
    folder_token: message.folderToken,
    folder_name: message.folderName
  });
  return normalizeHubPayload(payload);
}

export function feishuPublishCommandForAction(action: FeishuPublishMarkdownMessage["action"]): string {
  const commandByAction: Record<FeishuPublishMarkdownMessage["action"], string> = {
    publish_markdown: "feishu.publishMarkdown"
  };
  return commandByAction[action];
}

export function feishuCommandForAction(action: FeishuWikiActionMessage["action"]): string {
  const commandByAction: Record<FeishuWikiActionMessage["action"], string> = {
    export_md: "feishu.exportMd",
    export_folder_md: "feishu.exportFolderMd",
    change_category: "wiki.setFeishuCategory",
    sync_markdown: "feishu.syncMarkdown",
    organize_wiki: "wiki.organizeSource",
    export_md_and_organize: "feishu.exportMdAndOrganize",
    export_folder_md_and_organize: "feishu.exportFolderMdAndOrganize",
    sync_markdown_and_organize: "feishu.syncMarkdownAndOrganize",
    open_markdown_folder: "wiki.openFeishuSourceFolder",
    open_wiki_folder: "wiki.openProjectFolder"
  };
  return commandByAction[action];
}

async function getAuthorizedHubJson(url: string): Promise<unknown> {
  const token = await getOrPairHubToken();
  if (!token) {
    return {
      ok: false,
      errorCode: "hub_unavailable",
      message: "NOOS Hub is not reachable."
    };
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      ...(typeof payload === "object" && payload ? payload : {}),
      errorCode: (payload as { error_code?: string }).error_code ?? (response.status === 401 ? "unauthorized" : "hub_request_failed")
    };
  }
  return payload;
}

async function postAuthorizedHubJson(url: string, body: unknown): Promise<unknown> {
  const token = await getOrPairHubToken();
  if (!token) {
    return {
      ok: false,
      status: "hub_unavailable",
      errorCode: "hub_unavailable",
      message: "NOOS Hub is not reachable."
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      ...(typeof payload === "object" && payload ? payload : {}),
      errorCode: (payload as { error_code?: string }).error_code ?? (response.status === 401 ? "unauthorized" : "hub_request_failed")
    };
  }
  return payload;
}

/** Authorized Hub GET with one re-pair attempt after an unauthorized reply (mirrors saveMarkdownToHub). */
async function fetchHubJsonWithRepair(url: string): Promise<unknown> {
  const first = await getAuthorizedHubJson(url);
  if ((first as { errorCode?: string })?.errorCode === "unauthorized") {
    await clearHubToken();
    if (await pairWithHub()) {
      return getAuthorizedHubJson(url);
    }
  }
  return first;
}

/** Authorized Hub POST with one re-pair attempt after an unauthorized reply (mirrors saveMarkdownToHub). */
async function postHubJsonWithRepair(url: string, body: unknown): Promise<unknown> {
  const first = await postAuthorizedHubJson(url, body);
  if ((first as { errorCode?: string })?.errorCode === "unauthorized") {
    await clearHubToken();
    if (await pairWithHub()) {
      return postAuthorizedHubJson(url, body);
    }
  }
  return first;
}

function normalizeHubPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const value = payload as Record<string, unknown>;
  return {
    ...value,
    errorCode: value.errorCode ?? value.error_code,
    projectPath: value.projectPath ?? value.project_path,
    wikiProjectPath: value.wikiProjectPath ?? value.wiki_project_path,
    currentCategoryPath: value.currentCategoryPath ?? value.current_category_path,
    recentCategoryPaths: value.recentCategoryPaths ?? value.recent_category_paths,
    sourcePath: value.sourcePath ?? value.source_path,
    documentUrl: value.documentUrl ?? value.document_url,
    folderName: value.folderName ?? value.folder_name
  };
}

async function getVaultStatus(): Promise<VaultStatusResponse> {
  try {
    const response = await fetch(HUB_HEALTH_URL);
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; paired?: boolean };
    if (response.ok && payload.ok) {
      const token = await getOrPairHubToken();
      const paired = Boolean(token);
      return {
        ok: true,
        backend: paired ? "hub_local" : "downloads_mirror",
        hubAvailable: true,
        paired,
        message: paired ? "Hub local write connected." : "NOOS Hub is running, but Browser Shuttle could not connect."
      };
    }
  } catch {
    // Fall through to the mirror status.
  }

  return {
    ok: true,
    backend: "downloads_mirror",
    hubAvailable: false,
    paired: false,
    message: "NOOS Hub is not reachable. Saves will use the Browser Vault Mirror."
  };
}

async function saveMarkdownToVault(
  filename: string,
  content: string,
  kind: "handoff" | "crystal" | "context_pack_file",
  sourceUrl?: string
): Promise<{ ok: boolean; backend: string; location: string; importHint: string; message: string; lookupKey?: string; key?: string; objectId?: string }> {
  const hubResult = await saveMarkdownToHub(filename, content, kind, sourceUrl);
  if (hubResult.ok) {
    return {
      ok: true,
      backend: "hub_local",
      location: hubResult.location ?? "",
      lookupKey: hubResult.lookupKey,
      key: hubResult.key,
      objectId: hubResult.objectId,
      importHint: "Saved directly to the local NOOS Vault.",
      message: hubResult.lookupKey
        ? `${hubResult.message ?? "Saved directly to the local NOOS Vault."} Key: ${hubResult.lookupKey}`
        : hubResult.message ?? "Saved directly to the local NOOS Vault."
    };
  }

  const safeFilename = sanitizeFilename(filename);
  const artifactLabel = kind === "crystal" ? "crystal" : kind === "context_pack_file" ? "context pack file" : "handoff";
  const relativePath =
    kind === "context_pack_file"
      ? `NOOS/vault/context-packs/${sanitizeRelativePath(filename)}`
      : `NOOS/vault/${kind === "crystal" ? "crystals" : "handoffs"}/active/${safeFilename}`;
  await chrome.downloads.download({
    url: `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`,
    filename: relativePath,
    conflictAction: "uniquify",
    saveAs: false
  });

  return {
    ok: true,
    backend: "downloads_mirror",
    location: `Downloads/${relativePath}`,
    importHint: `Open NOOS Hub and run Import Browser Mirror to move this ${artifactLabel} into the local NOOS Vault.`,
    message: `Saved to Downloads/${relativePath}. Import it in NOOS Hub.`
  };
}

async function saveMarkdownToHub(
  filename: string,
  content: string,
  kind: "handoff" | "crystal" | "context_pack_file",
  sourceUrl?: string
): Promise<{ ok: boolean; location?: string; message?: string; errorCode?: string; lookupKey?: string; key?: string; objectId?: string }> {
  const firstAttempt = await postMarkdownToHub(filename, content, kind, await getOrPairHubToken(), sourceUrl);
  if (firstAttempt.ok) {
    return firstAttempt;
  }
  if (firstAttempt.errorCode !== "unauthorized") {
    return firstAttempt;
  }

  await clearHubToken();
  const pairedToken = await pairWithHub();
  if (!pairedToken) {
    return firstAttempt;
  }

  return postMarkdownToHub(filename, content, kind, pairedToken, sourceUrl);
}

async function postMarkdownToHub(
  filename: string,
  content: string,
  kind: "handoff" | "crystal" | "context_pack_file",
  token: string | null,
  sourceUrl?: string
): Promise<{ ok: boolean; location?: string; message?: string; errorCode?: string; lookupKey?: string; key?: string; objectId?: string }> {
  try {
    const response = await fetch(HUB_LOCAL_WRITE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        protocol_version: 1,
        request_id: crypto.randomUUID(),
        idempotency_key: await createIdempotencyKey(kind, sourceUrl ?? "", content),
        object_type: kind,
        source: {
          app: "browser-shuttle",
          url: sourceUrl,
          conversation_id: extractProviderConversationId(sourceUrl),
          captured_at: new Date().toISOString()
        },
        suggested: {
          filename,
          status: "active"
        },
        content: {
          media_type: "text/markdown",
          text: content
        }
      })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      location?: string;
      message?: string;
      error_code?: string;
      lookup_key?: string;
      key?: string;
      object_id?: string;
      path?: string;
    };
    return {
      ok: response.ok && payload.ok === true,
      location: payload.location ?? payload.path,
      message: payload.message,
      errorCode: payload.error_code ?? (response.status === 401 ? "unauthorized" : undefined),
      lookupKey: payload.lookup_key ?? payload.key,
      key: payload.lookup_key ?? payload.key,
      objectId: payload.object_id
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "hub_unavailable",
      message: error instanceof Error ? error.message : "NOOS Hub local write unavailable."
    };
  }
}

async function createIdempotencyKey(kind: string, sourceUrl: string, content: string): Promise<string> {
  const input = new TextEncoder().encode(`${kind}\n${sourceUrl}\n${content}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function saveContextPackToVault(
  directory: string,
  files: Array<{ path: string; content: string }>,
  sourceUrl?: string
): Promise<{ ok: boolean; backend: string; location: string; message: string; errorCode?: string }> {
  const safeDirectory = sanitizePathSegment(directory) || "context-pack";
  const results = [];

  for (const file of files) {
    const relativeFilePath = `${safeDirectory}/${sanitizeRelativePath(file.path)}`;
    results.push(await saveMarkdownToVault(relativeFilePath, file.content, "context_pack_file", sourceUrl));
  }

  const ok = results.every((result) => result.ok);
  const backend = results.find((result) => result.backend === "hub_local") ? "hub_local" : "downloads_mirror";
  const location =
    backend === "hub_local"
      ? results.find((result) => result.backend === "hub_local")?.location ?? ""
      : `Downloads/NOOS/vault/context-packs/${safeDirectory}`;

  return {
    ok,
    backend,
    location,
    errorCode: ok ? undefined : "context_pack_partial_save",
    message: ok
      ? `Context Pack saved to ${backend === "hub_local" ? "local NOOS Vault" : "Downloads Browser Vault Mirror"}: ${location}`
      : `Context Pack save finished with issues. Check ${location}. Source: ${sourceUrl ?? "current page"}`
  };
}

async function downloadArtifactsToMirror(
  directory: string,
  files: Array<{ filename: string; url: string }>
): Promise<{ ok: boolean; backend: string; location: string; message: string; count: number }> {
  const safeDirectory = sanitizeRelativePath(directory) || "chatgpt-images";
  const basePath = `NOOS/vault/artifacts/files/${safeDirectory}`;
  let count = 0;

  for (const file of files) {
    const filename = sanitizeFilename(file.filename);
    await chrome.downloads.download({
      url: file.url,
      filename: `${basePath}/${filename}`,
      conflictAction: "uniquify",
      saveAs: false
    });
    count += 1;
  }

  return {
    ok: true,
    backend: "downloads_mirror",
    location: `Downloads/${basePath}`,
    message: `Downloaded ${count} artifact(s) to Downloads/${basePath}.`,
    count
  };
}

async function pairWithHub(): Promise<string | null> {
  try {
    const response = await fetch(HUB_PAIR_URL);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { token?: string };
    if (!payload.token) {
      return null;
    }
    await chrome.storage.local.set({ [HUB_TOKEN_STORAGE_KEY]: payload.token });
    return payload.token;
  } catch {
    return null;
  }
}

async function getOrPairHubToken(): Promise<string | null> {
  return (await getHubToken()) ?? (await pairWithHub());
}

async function getHubToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(HUB_TOKEN_STORAGE_KEY);
    const token = result[HUB_TOKEN_STORAGE_KEY];
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}

async function clearHubToken(): Promise<void> {
  try {
    await chrome.storage.local.remove(HUB_TOKEN_STORAGE_KEY);
  } catch {
    // A failed token cleanup should not block the Downloads mirror fallback.
  }
}

function sanitizeFilename(filename: string): string {
  const base = filename
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();

  return base.endsWith(".md") && base.length > 3 ? base : "noos-thread.md";
}

function sanitizeRelativePath(path: string): string {
  const parts = path.split(/[\\/]/).map(sanitizePathSegment).filter(Boolean);
  return parts.length > 0 ? parts.join("/") : "file.md";
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[\\/:]/g, "-")
    .replace(/^\.+/, "")
    .trim();
}
