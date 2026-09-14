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
import { SubmissionOperationLedger, createChromeSubmissionStore, type SubmissionOperationMutation } from "../core/submission-operation";

chrome.runtime.onInstalled.addListener(() => {
  console.info("NOOS Shuttle installed.");
});

const HUB_LOCAL_WRITE_URL = "http://127.0.0.1:17642/v1/ingest";
const HUB_HEALTH_URL = "http://127.0.0.1:17642/health";
const HUB_PAIR_URL = "http://127.0.0.1:17642/pair";
const HUB_VAULT_RECENT_URL = "http://127.0.0.1:17642/v1/vault/recent";
const HUB_VAULT_BROWSE_URL = "http://127.0.0.1:17642/v1/vault/browse";
const HUB_VAULT_OBJECT_URL = "http://127.0.0.1:17642/v1/vault/object";
const HUB_WIKI_TARGET_URL = "http://127.0.0.1:17642/v1/wiki/default-target";
const HUB_ACTION_URL = "http://127.0.0.1:17642/v1/actions";
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

function getSubmissionOperationCoordinator(): SubmissionOperationLedger | undefined {
  const storage = chrome.storage?.local;
  if (!storage) return undefined;
  submissionOperationCoordinator ??= new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false }));
  return submissionOperationCoordinator;
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
    ["GO", "BOOTSTRAP", "REVIEW_DISPATCH", "SEDIMENT", "DELIVER_CHILD_RESULT"].includes(input.operationKind as string) &&
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
