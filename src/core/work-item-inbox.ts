import type { NoosCrystal } from "./noos-crystal";
import type { NoosThread } from "./noos-thread";
import { normalizeProviderConversationId } from "../shared/provider-identity";

export type WorkItemStatus = "DRAFT" | "ACTIVE" | "PROMOTED" | "ARCHIVED";
export type InboxItemState = "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED" | "DISCARDED";
export type InboxSourceKind = "thread" | "crystal";

export interface WorkItemReadiness {
  goalSet: boolean;
  scopeSet: boolean;
  reviewNotesReviewed: boolean;
  openQuestionsReviewed: boolean;
  coldStartReady: boolean;
}

export interface ColdStartState {
  state: "NEEDS_BOOTSTRAP" | "READY";
  preparedAt?: string;
  preparedFromInboxItemIds: string[];
  evidence?: ColdStartEvidence;
}

export interface ColdStartEvidence {
  version: "work-item-cold-start/v2";
  report: string;
  ref: string;
  hash: string;
  evidenceRefs: Array<{
    inboxItemId: string;
    sourceKind: InboxSourceKind;
    capturedId: string;
    rawMarkdown: string;
    bodyMarkdown: string;
    sourceUrl?: string;
    capturedAt: string;
    revision: number;
  }>;
  candidateRevision: number;
  readinessResult: WorkItemReadiness;
  approvalEvent: {
    type: "cold_start_prepared";
    at: string;
    actor: "human";
    source: "background-human-confirmation";
    eventId: string;
    tabId?: number;
  };
}

export interface ColdStartApprovalEvent {
  confirmed: true;
  eventId: string;
  issuedAt: string;
  issuedBy: "background-human-confirmation";
  tabId?: number;
}

export interface WorkItemAdoptionEvent {
  confirmed: true;
  eventId: string;
  issuedAt: string;
  issuedBy: "background-human-adoption";
  tabId?: number;
}

export interface WorkItemBinding {
  conversationId?: string;
  carrierRef?: string;
}

export interface WorkItem {
  workItemId: string;
  primaryLogicalThreadId: string;
  title: string;
  goal: string;
  scope: string;
  nonGoals: string[];
  status: WorkItemStatus;
  revision: number;
  candidateRevision: number;
  candidateBaseRevision: number;
  candidateDiff: string;
  candidateProposal?: CandidateProposal;
  binding?: WorkItemBinding;
  reviewNotes: string[];
  openQuestions: string[];
  blockingOpenQuestions: string[];
  readiness: WorkItemReadiness;
  coldStart: ColdStartState;
  absorbedInboxItemIds: string[];
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  promotionReason?: string;
}

export interface InboxItem {
  inboxItemId: string;
  workItemId: string;
  sourceKind: InboxSourceKind;
  capturedId: string;
  title: string;
  rawMarkdown: string;
  bodyMarkdown: string;
  sourceUrl?: string;
  capturedAt: string;
  state: InboxItemState;
  decisionReason?: string;
  revision: number;
}

export interface WorkItemInboxState {
  revision: number;
  activeWorkItemId?: string;
  workItems: WorkItem[];
  inboxItems: InboxItem[];
}

export interface AtomicWorkItemStore {
  read(): Promise<WorkItemInboxState | undefined>;
  compareAndSet(expectedRevision: number, next: WorkItemInboxState): Promise<boolean>;
}

export class WorkItemConflictError extends Error {
  readonly code = "stale_revision";

  constructor(message = "The Work Item changed. Reload it before applying this action.") {
    super(message);
    this.name = "WorkItemConflictError";
  }
}

export class WorkItemValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkItemValidationError";
    this.code = code;
  }
}

const WORK_ITEM_STATE_KEY = "noosWorkItemInbox";
const MAX_COMMIT_RETRIES = 8;

const emptyReadiness = (): WorkItemReadiness => ({
  goalSet: false,
  scopeSet: false,
  reviewNotesReviewed: false,
  openQuestionsReviewed: false,
  coldStartReady: false
});

function emptyState(): WorkItemInboxState {
  return { revision: 0, workItems: [], inboxItems: [] };
}

function normalizeState(value: WorkItemInboxState | undefined): WorkItemInboxState {
  const state = value ?? emptyState();
  const requestedActiveId =
    (state.activeWorkItemId &&
    state.workItems.some(
      (item) =>
        item.workItemId === state.activeWorkItemId && item.status !== "PROMOTED" && item.status !== "ARCHIVED"
    )
      ? state.activeWorkItemId
      : undefined) ?? state.workItems.find((item) => item.status === "ACTIVE")?.workItemId;
  const workItems = state.workItems.map((item) => ({
    ...item,
    candidateRevision: item.candidateRevision ?? 0,
    candidateBaseRevision: item.candidateBaseRevision ?? 0,
    candidateDiff: item.candidateDiff ?? "",
    blockingOpenQuestions: item.blockingOpenQuestions ?? [],
    candidateProposal:
      item.candidateProposal &&
      (item.candidateProposal.state === "DRAFT" || item.candidateProposal.state === "SUBMITTED") &&
      (item.candidateProposal.baseCandidateRevision !== (item.candidateRevision ?? 0) ||
        item.candidateProposal.selectedInboxItemIds.some((inboxItemId) => {
          const inboxItem = state.inboxItems.find(
            (candidate) => candidate.inboxItemId === inboxItemId && candidate.workItemId === item.workItemId
          );
          return !inboxItem || inboxItem.state !== "PENDING";
        }))
        ? { ...item.candidateProposal, state: "STALE" as const, reason: "A selected Inbox item is no longer pending." }
        : item.candidateProposal,
    status:
      item.workItemId === requestedActiveId
        ? ("ACTIVE" as const)
        : item.status === "ACTIVE"
          ? ("DRAFT" as const)
          : item.status
  }));
  return {
    ...state,
    activeWorkItemId: requestedActiveId,
    workItems
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function isReady(readiness: WorkItemReadiness, blockingOpenQuestions: string[]): boolean {
  return blockingOpenQuestions.length === 0 && Object.values(readiness).every(Boolean);
}

function assertNonEmpty(value: string, code: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new WorkItemValidationError(code, message);
  }
  return normalized;
}

function assertCanonicalConversationRef(binding: WorkItemBinding | undefined): void {
  const conversationId = binding?.conversationId ? normalizeProviderConversationId(binding.conversationId) : undefined;
  if (conversationId?.startsWith("WEB:")) {
    throw new WorkItemValidationError(
      "temporary_conversation_identity",
      "A provisional WEB conversation identity cannot be persisted."
    );
  }
}

export class InMemoryWorkItemStore implements AtomicWorkItemStore {
  private state: WorkItemInboxState;
  private queue: Promise<void> = Promise.resolve();

  constructor(initial?: WorkItemInboxState) {
    this.state = clone(initial ?? emptyState());
  }

  async read(): Promise<WorkItemInboxState> {
    return clone(this.state);
  }

  async compareAndSet(expectedRevision: number, next: WorkItemInboxState): Promise<boolean> {
    let result = false;
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.state.revision === expectedRevision) {
        this.state = clone(next);
        result = true;
      }
    } finally {
      release();
    }
    return result;
  }
}

export interface ChromeStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

export interface WorkItemCoordinator {
  update(expectedRevision: number, next: WorkItemInboxState): Promise<boolean>;
}

export function createChromeWorkItemStore(
  storage: ChromeStorageLike,
  coordinator?: WorkItemCoordinator
): AtomicWorkItemStore {
  return {
    async read() {
      const result = await storage.get(WORK_ITEM_STATE_KEY);
      const value = result[WORK_ITEM_STATE_KEY];
      return value && typeof value === "object" ? clone(value as WorkItemInboxState) : undefined;
    },
    async compareAndSet(expectedRevision, next) {
      if (coordinator) {
        return coordinator.update(expectedRevision, clone(next));
      }
      // A plain storage adapter cannot provide cross-context CAS. Fail closed
      // instead of claiming atomicity that Chrome storage.local does not offer.
      throw new WorkItemValidationError(
        "atomic_store_required",
        "A Work Item coordinator is required for atomic persistence."
      );
    }
  };
}

export interface CreateWorkItemInput {
  title: string;
  goal: string;
  scope: string;
  nonGoals?: string[];
  primaryLogicalThreadId?: string;
  now?: string;
  binding?: WorkItemBinding;
}

export interface AbsorbOptions {
  reviewNotes?: string[];
  openQuestions?: string[];
  incorporatedInboxItemIds?: string[];
  candidate?: CandidateChange;
  proposalId?: string;
}

export interface CandidateChange {
  baseRevision: number;
  diff: string;
}

export type CandidateProposalState = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "STALE" | "DISCARDED";

export interface CandidateProposal {
  proposalId: string;
  workItemId: string;
  baseCandidateRevision: number;
  selectedInboxItemIds: string[];
  incorporatedInboxItemIds: string[];
  diff: string;
  state: CandidateProposalState;
  reason?: string;
  updatedAt: string;
}

export class WorkItemInbox {
  constructor(
    private readonly store: AtomicWorkItemStore,
    private readonly clock: () => string = nowIso
  ) {}

  async snapshot(): Promise<WorkItemInboxState> {
    return clone(normalizeState(await this.store.read()));
  }

  async validateBinding(workItemId: string, binding: WorkItemBinding): Promise<void> {
    assertCanonicalConversationRef(binding);
    const state = normalizeState(await this.store.read());
    const workItem = this.requireWorkItem(state, workItemId);
    this.requireActiveWorkItem(state, workItem, binding);
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    assertCanonicalConversationRef(input.binding);
    const title = assertNonEmpty(input.title, "title_required", "A Work Item title is required.");
    const goal = assertNonEmpty(input.goal, "goal_required", "A Work Item goal is required.");
    const scope = assertNonEmpty(input.scope, "scope_required", "A Work Item scope is required.");
    const createdAt = input.now ?? this.clock();
    const workItem: WorkItem = {
      workItemId: id("work-item"),
      primaryLogicalThreadId: input.primaryLogicalThreadId ?? id("logical-thread"),
      title,
      goal,
      scope,
      nonGoals: normalizeList(input.nonGoals),
      status: "DRAFT",
      revision: 1,
      candidateRevision: 0,
      candidateBaseRevision: 0,
      candidateDiff: "",
      reviewNotes: [],
      openQuestions: [],
      blockingOpenQuestions: [],
      readiness: { ...emptyReadiness(), goalSet: true, scopeSet: true },
      coldStart: { state: "NEEDS_BOOTSTRAP", preparedFromInboxItemIds: [] },
      absorbedInboxItemIds: [],
      binding: input.binding,
      createdAt,
      updatedAt: createdAt
    };

    await this.commit((state) => ({
      ...state,
      activeWorkItemId: state.activeWorkItemId ?? workItem.workItemId,
      workItems: [
        ...state.workItems,
        state.activeWorkItemId ? workItem : { ...workItem, status: "ACTIVE" as const }
      ],
      revision: state.revision + 1
    }));
    return clone(workItem);
  }

  async captureThread(
    workItemId: string,
    thread: NoosThread,
    capturedAt = this.clock(),
    binding?: WorkItemBinding
  ): Promise<InboxItem> {
    return this.capture(workItemId, {
      sourceKind: "thread",
      capturedId: thread.id,
      title: thread.title,
      rawMarkdown: thread.rawMarkdown,
      bodyMarkdown: thread.bodyMarkdown,
      sourceUrl: thread.frontmatter?.source_url,
      capturedAt
    }, binding);
  }

  async captureCrystal(
    workItemId: string,
    crystal: NoosCrystal,
    capturedAt = this.clock(),
    binding?: WorkItemBinding
  ): Promise<InboxItem> {
    return this.capture(workItemId, {
      sourceKind: "crystal",
      capturedId: crystal.id,
      title: crystal.title,
      rawMarkdown: crystal.rawMarkdown,
      bodyMarkdown: crystal.bodyMarkdown,
      sourceUrl: crystal.frontmatter?.source_url,
      capturedAt
    }, binding);
  }

  async saveCandidateProposal(
    workItemId: string,
    expectedRevision: number,
    input: Omit<CandidateProposal, "proposalId" | "workItemId" | "updatedAt" | "state">
  ): Promise<CandidateProposal> {
    if (input.selectedInboxItemIds.length === 0) {
      throw new WorkItemValidationError("selection_required", "Select at least one Inbox item for the Candidate.");
    }
    if (!input.diff.trim()) {
      throw new WorkItemValidationError("candidate_diff_required", "Candidate diff is required before saving.");
    }
    return this.commitWithExpected(workItemId, expectedRevision, (state) => {
      const workItem = this.requireWorkItem(state, workItemId);
      this.requireActiveWorkItem(state, workItem);
      this.assertRevision(workItem, expectedRevision);
      if (input.baseCandidateRevision !== workItem.candidateRevision) {
        throw new WorkItemConflictError("The Candidate changed. Rebase this proposal before saving.");
      }
      const selected = normalizeList(input.selectedInboxItemIds);
      const incorporated = normalizeList(input.incorporatedInboxItemIds);
      if (incorporated.some((itemId) => !selected.includes(itemId))) {
        throw new WorkItemValidationError("incorporated_not_selected", "Only selected Inbox items can be incorporated.");
      }
      const selectedItems = state.inboxItems.filter(
        (item) => selected.includes(item.inboxItemId) && item.workItemId === workItemId
      );
      if (selectedItems.length !== selected.length || selectedItems.some((item) => item.state !== "PENDING")) {
        throw new WorkItemValidationError("inbox_item_not_pending", "Only pending Inbox items can be proposed.");
      }
      const proposal: CandidateProposal = {
        proposalId: id("candidate-proposal"),
        workItemId,
        baseCandidateRevision: input.baseCandidateRevision,
        selectedInboxItemIds: selected,
        incorporatedInboxItemIds: incorporated,
        diff: input.diff.trim(),
        state: "DRAFT",
        updatedAt: this.clock()
      };
      const nextWorkItem = {
        ...workItem,
        candidateProposal: proposal,
        revision: workItem.revision + 1,
        coldStart: { state: "NEEDS_BOOTSTRAP" as const, preparedFromInboxItemIds: [] },
        readiness: { ...workItem.readiness, coldStartReady: false },
        updatedAt: this.clock()
      };
      return {
        next: { ...state, revision: state.revision + 1, workItems: this.replaceWorkItem(state, nextWorkItem) },
        result: proposal
      };
    });
  }

  async acceptAbsorb(
    workItemId: string,
    inboxItemIds: string[],
    expectedRevision: number,
    options: AbsorbOptions = {}
  ): Promise<WorkItem> {
    const requestedSelected = normalizeList(inboxItemIds);
    if (requestedSelected.length === 0) {
      throw new WorkItemValidationError("selection_required", "Select at least one Inbox item to absorb.");
    }

    return this.commitWithExpected(workItemId, expectedRevision, (state) => {
      const workItem = this.requireWorkItem(state, workItemId);
      this.requireActiveWorkItem(state, workItem);
      this.assertRevision(workItem, expectedRevision);
      const proposal = options.proposalId
        ? workItem.candidateProposal?.proposalId === options.proposalId
          ? workItem.candidateProposal
          : undefined
        : undefined;
      if (options.proposalId && (!proposal || (proposal.state !== "DRAFT" && proposal.state !== "SUBMITTED"))) {
        throw new WorkItemConflictError("The Candidate proposal is no longer available. Reload it before accepting.");
      }
      const selected = normalizeList(proposal?.selectedInboxItemIds ?? requestedSelected);
      const selectedSet = new Set(selected);
      const selectedItems = state.inboxItems.filter(
        (item) => selectedSet.has(item.inboxItemId) && item.workItemId === workItemId
      );
      if (selectedItems.length !== selected.length) {
        throw new WorkItemValidationError("inbox_item_not_found", "One or more selected Inbox items are unavailable.");
      }
      if (selectedItems.some((item) => item.state !== "PENDING")) {
        throw new WorkItemValidationError("inbox_item_not_pending", "Only pending Inbox items can be absorbed.");
      }
      const incorporated = normalizeList(proposal?.incorporatedInboxItemIds ?? options.incorporatedInboxItemIds ?? selected);
      if (incorporated.some((itemId) => !selectedSet.has(itemId))) {
        throw new WorkItemValidationError("incorporated_not_selected", "Only selected Inbox items can be incorporated.");
      }
      const incorporatedItems = selectedItems.filter((item) => incorporated.includes(item.inboxItemId));
      const candidate = proposal
        ? { baseRevision: proposal.baseCandidateRevision, diff: proposal.diff }
        : options.candidate ?? {
        baseRevision: workItem.candidateRevision,
        diff: incorporatedItems.map((item) => item.bodyMarkdown).join("\n\n---\n\n")
      };
      if (candidate.baseRevision !== workItem.candidateRevision) {
        throw new WorkItemConflictError("The Candidate changed. Reload it before absorbing this material.");
      }
      if (incorporated.length > 0 && !candidate.diff.trim()) {
        throw new WorkItemValidationError("candidate_diff_required", "Candidate diff is required before absorbing.");
      }
      const candidateChanged = incorporated.length > 0;

      const updatedWorkItem: WorkItem = {
        ...workItem,
        status: workItem.status === "DRAFT" ? "ACTIVE" : workItem.status,
        revision: workItem.revision + 1,
        candidateRevision: workItem.candidateRevision + (incorporated.length > 0 ? 1 : 0),
        candidateBaseRevision: candidateChanged ? candidate.baseRevision : workItem.candidateBaseRevision,
        candidateDiff: candidateChanged ? candidate.diff : workItem.candidateDiff,
        candidateProposal:
          proposal && candidateChanged
            ? { ...proposal, state: "ACCEPTED", updatedAt: this.clock() }
            : workItem.candidateProposal,
        reviewNotes: [...new Set([...workItem.reviewNotes, ...normalizeList(options.reviewNotes)])],
        openQuestions: [...new Set([...workItem.openQuestions, ...normalizeList(options.openQuestions)])],
        blockingOpenQuestions: workItem.blockingOpenQuestions,
        coldStart: candidateChanged
          ? { state: "NEEDS_BOOTSTRAP", preparedFromInboxItemIds: [] }
          : workItem.coldStart,
        readiness: candidateChanged ? { ...workItem.readiness, coldStartReady: false } : workItem.readiness,
        absorbedInboxItemIds: [...new Set([...workItem.absorbedInboxItemIds, ...incorporated])],
        updatedAt: this.clock()
      };
      const next: WorkItemInboxState = {
        ...state,
        revision: state.revision + 1,
        activeWorkItemId: updatedWorkItem.status === "ACTIVE" ? workItemId : state.activeWorkItemId,
        workItems: state.workItems.map((item) => (item.workItemId === workItemId ? updatedWorkItem : item)),
        inboxItems: state.inboxItems.map((item) =>
          incorporated.includes(item.inboxItemId) ? { ...item, state: "ACCEPTED", revision: item.revision + 1 } : item
        )
      };
      if (updatedWorkItem.status === "ACTIVE") {
        next.workItems = next.workItems.map((item) =>
          item.workItemId === workItemId
            ? item
            : item.status === "ACTIVE"
              ? { ...item, status: "DRAFT" as const, revision: item.revision + 1, updatedAt: this.clock() }
              : item
        );
      }
      return { next, result: updatedWorkItem };
    });
  }

  async reject(workItemId: string, inboxItemId: string, reason: string, expectedRevision: number): Promise<InboxItem> {
    return this.decideInbox(workItemId, inboxItemId, "REJECTED", reason, expectedRevision);
  }

  async rejectCandidateDiff(workItemId: string, proposalId: string, reason: string, expectedRevision: number): Promise<CandidateProposal> {
    const rejectionReason = assertNonEmpty(reason, "decision_reason_required", "A reason is required for rejecting a Candidate.");
    return this.commitWithExpected(workItemId, expectedRevision, (state) => {
      const workItem = this.requireWorkItem(state, workItemId);
      this.requireActiveWorkItem(state, workItem);
      const proposal = workItem.candidateProposal;
      if (!proposal || proposal.proposalId !== proposalId || (proposal.state !== "DRAFT" && proposal.state !== "SUBMITTED")) {
        throw new WorkItemConflictError("The Candidate proposal is no longer available.");
      }
      const rejected = { ...proposal, state: "DISCARDED" as const, reason: rejectionReason, updatedAt: this.clock() };
      const nextWorkItem = { ...workItem, candidateProposal: rejected, revision: workItem.revision + 1, updatedAt: this.clock() };
      return {
        next: { ...state, revision: state.revision + 1, workItems: this.replaceWorkItem(state, nextWorkItem) },
        result: rejected
      };
    });
  }

  async cancel(workItemId: string, inboxItemId: string, reason: string, expectedRevision: number): Promise<InboxItem> {
    return this.decideInbox(workItemId, inboxItemId, "CANCELLED", reason, expectedRevision);
  }

  async discard(workItemId: string, inboxItemId: string, reason: string, expectedRevision: number): Promise<InboxItem> {
    return this.decideInbox(workItemId, inboxItemId, "DISCARDED", reason, expectedRevision);
  }

  async updateReview(
    workItemId: string,
    expectedRevision: number,
    changes: { reviewNotes?: string[]; openQuestions?: string[]; blockingOpenQuestions?: string[] }
  ): Promise<WorkItem> {
    return this.commitWithExpected(workItemId, expectedRevision, (state) => {
      const workItem = this.requireWorkItem(state, workItemId);
      this.requireActiveWorkItem(state, workItem);
      this.assertRevision(workItem, expectedRevision);
      const nextWorkItem: WorkItem = {
        ...workItem,
        revision: workItem.revision + 1,
        reviewNotes: changes.reviewNotes === undefined ? workItem.reviewNotes : normalizeList(changes.reviewNotes),
        openQuestions: changes.openQuestions === undefined ? workItem.openQuestions : normalizeList(changes.openQuestions),
        blockingOpenQuestions:
          changes.blockingOpenQuestions === undefined
            ? workItem.blockingOpenQuestions
            : normalizeList(changes.blockingOpenQuestions),
        coldStart:
          changes.reviewNotes === undefined &&
          changes.openQuestions === undefined &&
          changes.blockingOpenQuestions === undefined
            ? workItem.coldStart
            : { state: "NEEDS_BOOTSTRAP", preparedFromInboxItemIds: [] },
        readiness: {
          ...workItem.readiness,
          ...(changes.reviewNotes === undefined ? {} : { reviewNotesReviewed: true }),
          ...(changes.openQuestions === undefined ? {} : { openQuestionsReviewed: true }),
          ...(changes.reviewNotes === undefined &&
          changes.openQuestions === undefined &&
          changes.blockingOpenQuestions === undefined
            ? {}
            : { coldStartReady: false })
        },
        updatedAt: this.clock()
      };
      return {
        next: { ...state, revision: state.revision + 1, workItems: this.replaceWorkItem(state, nextWorkItem) },
        result: nextWorkItem
      };
    });
  }

  async prepareColdStart(
    workItemId: string,
    expectedRevision: number,
    approval: ColdStartApprovalEvent
  ): Promise<WorkItem> {
    if (
      approval?.confirmed !== true ||
      !approval.eventId?.trim() ||
      !approval.issuedAt?.trim() ||
      approval.issuedBy !== "background-human-confirmation"
    ) {
      throw new WorkItemValidationError("human_approval_required", "Cold Start requires an explicit human approval source.");
    }
    return this.commitWithExpected(workItemId, expectedRevision, (state) => {
      const workItem = this.requireWorkItem(state, workItemId);
      this.requireActiveWorkItem(state, workItem);
      this.assertRevision(workItem, expectedRevision);
      const readinessResult = { ...workItem.readiness, coldStartReady: true };
      const evidenceRefs = state.inboxItems
        .filter((item) => item.workItemId === workItem.workItemId && workItem.absorbedInboxItemIds.includes(item.inboxItemId))
        .map((item) => ({
          inboxItemId: item.inboxItemId,
          sourceKind: item.sourceKind,
          capturedId: item.capturedId,
          rawMarkdown: item.rawMarkdown,
          bodyMarkdown: item.bodyMarkdown,
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
          capturedAt: item.capturedAt,
          revision: item.revision
        }));
      const approvalEvent = {
        type: "cold_start_prepared" as const,
        at: approval.issuedAt,
        actor: "human" as const,
        source: approval.issuedBy,
        eventId: approval.eventId.trim(),
        ...(approval.tabId === undefined ? {} : { tabId: approval.tabId })
      };
      const report = `Candidate r${workItem.candidateRevision}; ${evidenceRefs.length} Inbox items incorporated.`;
      const ref = `work-item://${workItem.workItemId}/cold-start/${workItem.revision + 1}`;
      const evidencePayload = {
        version: "work-item-cold-start/v2" as const,
        workItemId: workItem.workItemId,
        candidateRevision: workItem.candidateRevision,
        candidate: { goal: workItem.goal, scope: workItem.scope, nonGoals: workItem.nonGoals, diff: workItem.candidateDiff },
        readiness: readinessResult,
        reviewNotes: workItem.reviewNotes,
        openQuestions: workItem.openQuestions,
        blockingOpenQuestions: workItem.blockingOpenQuestions,
        absorbedInboxItemIds: workItem.absorbedInboxItemIds,
        evidenceRefs,
        report,
        ref,
        approvalEvent
      };
      const nextWorkItem: WorkItem = {
        ...workItem,
        revision: workItem.revision + 1,
        coldStart: {
          state: "READY",
          preparedAt: this.clock(),
          preparedFromInboxItemIds: [...workItem.absorbedInboxItemIds],
          evidence: {
            version: "work-item-cold-start/v2",
            report,
            ref,
            hash: stableHash(JSON.stringify(evidencePayload)),
            evidenceRefs,
            candidateRevision: workItem.candidateRevision,
            readinessResult,
            approvalEvent
          }
        },
        readiness: readinessResult,
        updatedAt: this.clock()
      };
      return {
        next: { ...state, revision: state.revision + 1, workItems: this.replaceWorkItem(state, nextWorkItem) },
        result: nextWorkItem
      };
    });
  }

  async promote(workItemId: string, expectedRevision: number, reason: string): Promise<WorkItem> {
    const promotionReason = assertNonEmpty(reason, "promotion_reason_required", "Human Promote requires a reason.");
    return this.commitWithExpected(workItemId, expectedRevision, (state) => {
      const workItem = this.requireWorkItem(state, workItemId);
      this.requireActiveWorkItem(state, workItem);
      this.assertRevision(workItem, expectedRevision);
      const evidence = workItem.coldStart.evidence;
      if (
        !isReady(workItem.readiness, workItem.blockingOpenQuestions) ||
        workItem.coldStart.state !== "READY" ||
        !evidence ||
        evidence.candidateRevision !== workItem.candidateRevision ||
        JSON.stringify(evidence.readinessResult) !== JSON.stringify(workItem.readiness) ||
        evidence.version !== "work-item-cold-start/v2" ||
        evidence.evidenceRefs.length !== workItem.absorbedInboxItemIds.length ||
        evidence.evidenceRefs.some((ref) => !workItem.absorbedInboxItemIds.includes(ref.inboxItemId)) ||
        evidence.hash !== stableHash(JSON.stringify({
          version: evidence.version,
          workItemId: workItem.workItemId,
          candidateRevision: workItem.candidateRevision,
          candidate: { goal: workItem.goal, scope: workItem.scope, nonGoals: workItem.nonGoals, diff: workItem.candidateDiff },
          readiness: workItem.readiness,
          reviewNotes: workItem.reviewNotes,
          openQuestions: workItem.openQuestions,
          blockingOpenQuestions: workItem.blockingOpenQuestions,
          absorbedInboxItemIds: workItem.absorbedInboxItemIds,
          evidenceRefs: evidence.evidenceRefs,
          report: evidence.report,
          ref: evidence.ref,
          approvalEvent: evidence.approvalEvent
        })) ||
        !evidence.report ||
        !evidence.ref ||
        !evidence.hash ||
        evidence.approvalEvent.type !== "cold_start_prepared" ||
        evidence.approvalEvent.actor !== "human" ||
        evidence.approvalEvent.source !== "background-human-confirmation" ||
        !evidence.approvalEvent.eventId?.trim() ||
        !evidence.approvalEvent.at?.trim()
      ) {
        throw new WorkItemValidationError("work_item_not_ready", "The Work Item is not ready for Human Promote.");
      }
      const nextWorkItem: WorkItem = {
        ...workItem,
        status: "PROMOTED",
        revision: workItem.revision + 1,
        promotedAt: this.clock(),
        promotionReason,
        updatedAt: this.clock()
      };
      const nextDraft: WorkItem = {
        workItemId: id("work-item"),
        primaryLogicalThreadId: workItem.primaryLogicalThreadId,
        title: `Continue: ${workItem.title}`,
        goal: workItem.goal,
        scope: workItem.scope,
        nonGoals: [...workItem.nonGoals],
        status: "ACTIVE",
        revision: 1,
        candidateRevision: 0,
        candidateBaseRevision: 0,
        candidateDiff: "",
        reviewNotes: [],
        openQuestions: [],
        blockingOpenQuestions: [],
        readiness: { ...emptyReadiness(), goalSet: true, scopeSet: true },
        coldStart: { state: "NEEDS_BOOTSTRAP", preparedFromInboxItemIds: [] },
        absorbedInboxItemIds: [],
        binding: undefined,
        createdAt: this.clock(),
        updatedAt: this.clock()
      };
      return {
        next: {
          ...state,
          activeWorkItemId: nextDraft.workItemId,
          revision: state.revision + 1,
          workItems: [...this.replaceWorkItem(state, nextWorkItem), nextDraft]
        },
        result: nextWorkItem
      };
    });
  }

  async activate(
    workItemId: string,
    expectedRevision: number,
    binding?: WorkItemBinding,
    adoption?: WorkItemAdoptionEvent
  ): Promise<WorkItem> {
    assertCanonicalConversationRef(binding);
    return this.commitWithExpected(workItemId, expectedRevision, (state) => {
      const target = this.requireWorkItem(state, workItemId);
      if (target.status === "PROMOTED" || target.status === "ARCHIVED") {
        throw new WorkItemValidationError("work_item_not_activatable", "Promoted or archived Work Items cannot be activated.");
      }
      if (
        target.binding &&
        (!binding ||
          target.binding.conversationId !== binding.conversationId ||
          target.binding.carrierRef !== binding.carrierRef)
      ) {
        throw new WorkItemValidationError("conversation_binding_mismatch", "This Work Item is bound to a different conversation.");
      }
      if (!target.binding && binding) {
        if (
          adoption?.confirmed !== true ||
          !adoption.eventId?.trim() ||
          !adoption.issuedAt?.trim() ||
          adoption.issuedBy !== "background-human-adoption"
        ) {
          throw new WorkItemValidationError(
            "human_adoption_required",
            "Activating an unbound Work Item requires explicit human adoption."
          );
        }
      }
      const nextTarget: WorkItem = {
        ...target,
        status: "ACTIVE",
        binding: target.binding ?? binding,
        revision: target.revision + 1,
        updatedAt: this.clock()
      };
      return {
        next: {
          ...state,
          activeWorkItemId: workItemId,
          revision: state.revision + 1,
          workItems: state.workItems.map((item) => {
            if (item.workItemId === workItemId) return nextTarget;
            if (item.status === "ACTIVE") {
              return { ...item, status: "DRAFT" as const, revision: item.revision + 1, updatedAt: this.clock() };
            }
            return item;
          })
        },
        result: nextTarget
      };
    }, false);
  }

  private async capture(
    workItemId: string,
    input: Omit<InboxItem, "inboxItemId" | "workItemId" | "state" | "decisionReason" | "revision">,
    binding?: WorkItemBinding
  ): Promise<InboxItem> {
    assertCanonicalConversationRef(binding);
    const inboxItem: InboxItem = {
      ...input,
      inboxItemId: id("inbox"),
      workItemId,
      state: "PENDING",
      revision: 1
    };
    await this.commit((state) => {
      const workItem = this.requireWorkItem(state, workItemId);
      this.requireActiveWorkItem(state, workItem, binding);
      const boundWorkItem =
        binding && !workItem.binding
          ? { ...workItem, binding, revision: workItem.revision + 1, updatedAt: this.clock() }
          : workItem;
      return {
        ...state,
        revision: state.revision + 1,
        workItems: this.replaceWorkItem(state, boundWorkItem),
        inboxItems: [...state.inboxItems, inboxItem]
      };
    });
    return clone(inboxItem);
  }

  private async decideInbox(
    workItemId: string,
    inboxItemId: string,
    state: Exclude<InboxItemState, "PENDING" | "ACCEPTED">,
    reason: string,
    expectedRevision: number
  ): Promise<InboxItem> {
    const decisionReason = assertNonEmpty(reason, "decision_reason_required", "A reason is required for this Inbox decision.");
    return this.commitWithExpected(workItemId, expectedRevision, (current) => {
      const workItem = this.requireWorkItem(current, workItemId);
      this.requireActiveWorkItem(current, workItem);
      this.assertRevision(workItem, expectedRevision);
      const item = current.inboxItems.find(
        (candidate) => candidate.inboxItemId === inboxItemId && candidate.workItemId === workItemId
      );
      if (!item) {
        throw new WorkItemValidationError("inbox_item_not_found", "The Inbox item does not belong to this Work Item.");
      }
      if (item.state !== "PENDING") {
        throw new WorkItemValidationError("inbox_item_not_pending", "Only pending Inbox items can be decided.");
      }
      const nextItem = { ...item, state, decisionReason, revision: item.revision + 1 };
      const proposal = current.workItems.find((candidate) => candidate.workItemId === workItemId)?.candidateProposal;
      const staleProposal =
        proposal &&
        (proposal.state === "DRAFT" || proposal.state === "SUBMITTED") &&
        proposal.selectedInboxItemIds.includes(inboxItemId)
          ? {
              ...proposal,
              state: "STALE" as const,
              reason: `Selected Inbox item ${inboxItemId} was ${state.toLowerCase()}.`,
              updatedAt: this.clock()
            }
          : proposal;
      const nextWorkItem =
        staleProposal && staleProposal !== proposal
          ? { ...workItem, candidateProposal: staleProposal, revision: workItem.revision + 1, updatedAt: this.clock() }
          : workItem;
      return {
        next: {
          ...current,
          revision: current.revision + 1,
          workItems: this.replaceWorkItem(current, nextWorkItem),
          inboxItems: current.inboxItems.map((candidate) =>
            candidate.inboxItemId === inboxItemId ? nextItem : candidate
          )
        },
        result: nextItem
      };
    });
  }

  private async commit(mutator: (state: WorkItemInboxState) => WorkItemInboxState): Promise<void> {
    for (let attempt = 0; attempt < MAX_COMMIT_RETRIES; attempt += 1) {
      const current = normalizeState(await this.store.read());
      const next = mutator(clone(current));
      if (await this.store.compareAndSet(current.revision, next)) {
        return;
      }
    }
    throw new WorkItemConflictError("The Work Item was updated concurrently. Retry the action.");
  }

  private async commitWithExpected<T>(
    workItemId: string,
    expectedRevision: number,
    mutator: (state: WorkItemInboxState) => { next: WorkItemInboxState; result: T },
    requireActive = true
  ): Promise<T> {
    const current = normalizeState(await this.store.read());
    const workItem = this.requireWorkItem(current, workItemId);
    if (requireActive) {
      this.requireActiveWorkItem(current, workItem);
    }
    this.assertRevision(workItem, expectedRevision);
    const { next, result } = mutator(clone(current));
    if (!(await this.store.compareAndSet(current.revision, next))) {
      throw new WorkItemConflictError();
    }
    return clone(result);
  }

  private requireWorkItem(state: WorkItemInboxState, workItemId: string): WorkItem {
    const workItem = state.workItems.find((item) => item.workItemId === workItemId);
    if (!workItem) {
      throw new WorkItemValidationError("work_item_not_found", "The Work Item does not exist.");
    }
    return workItem;
  }

  private requireActiveWorkItem(state: WorkItemInboxState, workItem: WorkItem, binding?: WorkItemBinding): void {
    assertCanonicalConversationRef(binding);
    if (state.activeWorkItemId !== workItem.workItemId || workItem.status !== "ACTIVE") {
      throw new WorkItemValidationError(
        "work_item_not_active",
        "This Work Item is not the active Work Item. Activate it before continuing."
      );
    }
    if (
      workItem.binding &&
      binding &&
      (workItem.binding.conversationId !== binding.conversationId ||
        workItem.binding.carrierRef !== binding.carrierRef)
    ) {
      throw new WorkItemValidationError(
        "conversation_binding_mismatch",
        "This conversation is bound to a different Work Item."
      );
    }
  }

  private assertRevision(workItem: WorkItem, expectedRevision: number): void {
    if (workItem.revision !== expectedRevision) {
      throw new WorkItemConflictError();
    }
  }

  private replaceWorkItem(state: WorkItemInboxState, workItem: WorkItem): WorkItem[] {
    return state.workItems.map((item) => (item.workItemId === workItem.workItemId ? workItem : item));
  }
}

export { WORK_ITEM_STATE_KEY };
