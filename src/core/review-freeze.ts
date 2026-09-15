/**
 * Storage-agnostic immutable review artifacts.
 *
 * The store is deliberately supplied by the caller so the same contracts can
 * be recovered from extension storage, a Hub repository, or a test double.
 */

export interface ReviewArtifactStore {
  getSnapshot(snapshotId: string): Promise<ReviewSnapshot | undefined>;
  /** Atomic create-if-absent; implementations must never overwrite a winner. */
  createSnapshotIfAbsent(snapshot: ReviewSnapshot): Promise<ReviewSnapshot>;
  getReport(reportId: string): Promise<ReviewReport | undefined>;
  /** Atomic create-if-absent; implementations must never overwrite a winner. */
  createReportIfAbsent(report: ReviewReport): Promise<ReviewReport>;
  getWorkerResult(resultId: string): Promise<WorkerResult | undefined>;
  /** Atomic create-if-absent; implementations must never overwrite a winner. */
  createWorkerResultIfAbsent(result: WorkerResult): Promise<WorkerResult>;
  getPromotion(resultId: string): Promise<PromotionDecision | undefined>;
  /** Atomic create-if-absent; implementations must never overwrite a winner. */
  createPromotionIfAbsent(decision: PromotionDecision): Promise<PromotionDecision>;
}

export interface HumanAuthority {
  actorId: string;
  approved: true;
  approvedAt: string;
  eventId: string;
  source: string;
  targetKind: "REVIEW_SNAPSHOT" | "WORKER_RESULT";
  targetId: string;
}

export interface CandidateRevision {
  revisionId: string;
  body: string;
  bodyFingerprint: string;
}

export interface ReviewSnapshotInput {
  snapshotId: string;
  workItemId: string;
  logicalThreadId: string;
  candidate: CandidateRevision;
  includedRefs: readonly string[];
  excludedMaterialCounts: Readonly<Record<string, number>>;
  readinessChecklist: Readonly<Record<string, boolean>>;
  openQuestions: readonly string[];
  sourceProvenance: Readonly<Record<string, string>>;
}

export interface ReviewSnapshot extends ReviewSnapshotInput {
  readonly kind: "REVIEW_SNAPSHOT";
  readonly frozenAt: string;
  readonly freezeAuthority: HumanAuthority;
  readonly snapshotFingerprint: string;
}

export interface ReviewReportInput {
  reportId: string;
  snapshotId: string;
  workItemId: string;
  reviewerLogicalThreadId: string;
  parentLogicalThreadId: string;
  reviewerInstructionProvenance: Readonly<Record<string, string>>;
  findings: readonly string[];
  completedAt: string;
}

export interface ReviewReport extends ReviewReportInput {
  readonly kind: "REVIEW_REPORT";
  readonly reportFingerprint: string;
}

export interface WorkerResultInput {
  resultId: string;
  reportId: string;
  snapshotId: string;
  workItemId: string;
  childLogicalThreadId: string;
  parentLogicalThreadId: string;
  relevantRevisionId: string;
  completionReceipt: Readonly<Record<string, string>>;
  completedAt: string;
}

export interface WorkerResult extends WorkerResultInput {
  readonly kind: "WORKER_RESULT";
  readonly resultFingerprint: string;
}

export interface PromotionDecision {
  readonly kind: "HUMAN_PROMOTION";
  readonly resultId: string;
  readonly reportId: string;
  readonly snapshotId: string;
  readonly workItemId: string;
  readonly authority: HumanAuthority;
  readonly decidedAt: string;
  readonly promotionFingerprint: string;
}

export class ReviewArtifactInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewArtifactInvariantError";
  }
}

const encoder = new TextEncoder();

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
}

export async function fingerprint(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(canonicalize(value)));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireHumanAuthority(authority: HumanAuthority): void {
  if (!authority || authority.approved !== true || !authority.actorId || !authority.eventId || !authority.approvedAt ||
    !authority.source || !authority.targetKind || !authority.targetId || Number.isNaN(Date.parse(authority.approvedAt))) {
    throw new ReviewArtifactInvariantError("human_authority_required");
  }
}

function snapshotFingerprintInput(input: ReviewSnapshotInput): ReviewSnapshotInput {
  return clone({
    snapshotId: input.snapshotId,
    workItemId: input.workItemId,
    logicalThreadId: input.logicalThreadId,
    candidate: input.candidate,
    includedRefs: input.includedRefs,
    excludedMaterialCounts: input.excludedMaterialCounts,
    readinessChecklist: input.readinessChecklist,
    openQuestions: input.openQuestions,
    sourceProvenance: input.sourceProvenance,
  });
}

function reportFingerprintInput(input: ReviewReportInput): ReviewReportInput {
  return clone({
    reportId: input.reportId,
    snapshotId: input.snapshotId,
    workItemId: input.workItemId,
    reviewerLogicalThreadId: input.reviewerLogicalThreadId,
    parentLogicalThreadId: input.parentLogicalThreadId,
    reviewerInstructionProvenance: input.reviewerInstructionProvenance,
    findings: input.findings,
    completedAt: input.completedAt,
  });
}

function workerResultFingerprintInput(input: WorkerResultInput): WorkerResultInput {
  return clone({
    resultId: input.resultId,
    reportId: input.reportId,
    snapshotId: input.snapshotId,
    workItemId: input.workItemId,
    childLogicalThreadId: input.childLogicalThreadId,
    parentLogicalThreadId: input.parentLogicalThreadId,
    relevantRevisionId: input.relevantRevisionId,
    completionReceipt: input.completionReceipt,
    completedAt: input.completedAt,
  });
}

async function snapshotIdentityFingerprint(input: ReviewSnapshotInput, authority: HumanAuthority): Promise<string> {
  return fingerprint({ kind: "REVIEW_SNAPSHOT", ...snapshotFingerprintInput(input), freezeAuthority: authority });
}

export async function validateReviewSnapshot(snapshot: ReviewSnapshot): Promise<void> {
  requireHumanAuthority(snapshot.freezeAuthority);
  if (snapshot.freezeAuthority.targetKind !== "REVIEW_SNAPSHOT" ||
    snapshot.freezeAuthority.targetId !== snapshot.snapshotId) {
    throw new ReviewArtifactInvariantError("freeze_authority_target_mismatch");
  }
  const bodyFingerprint = await fingerprint(snapshot.candidate.body);
  if (bodyFingerprint !== snapshot.candidate.bodyFingerprint) throw new ReviewArtifactInvariantError("candidate_body_fingerprint_mismatch");
  const expected = await fingerprint({
    kind: "REVIEW_SNAPSHOT",
    ...snapshotFingerprintInput(snapshot),
    frozenAt: snapshot.frozenAt,
    freezeAuthority: snapshot.freezeAuthority,
  });
  if (expected !== snapshot.snapshotFingerprint) throw new ReviewArtifactInvariantError("snapshot_fingerprint_mismatch");
}

export async function validateReviewReport(report: ReviewReport): Promise<void> {
  const expected = await fingerprint({ kind: "REVIEW_REPORT", ...reportFingerprintInput(report) });
  if (expected !== report.reportFingerprint) throw new ReviewArtifactInvariantError("report_fingerprint_mismatch");
}

export async function validateWorkerResult(result: WorkerResult): Promise<void> {
  const expected = await fingerprint({ kind: "WORKER_RESULT", ...workerResultFingerprintInput(result) });
  if (expected !== result.resultFingerprint) throw new ReviewArtifactInvariantError("result_fingerprint_mismatch");
}

export async function validatePromotionDecision(
  decision: PromotionDecision,
  result?: WorkerResult,
  report?: ReviewReport,
  snapshot?: ReviewSnapshot,
): Promise<void> {
  requireHumanAuthority(decision.authority);
  if (decision.authority.targetKind !== "WORKER_RESULT" || decision.authority.targetId !== decision.resultId) {
    throw new ReviewArtifactInvariantError("promotion_authority_target_mismatch");
  }
  if (result && (decision.resultId !== result.resultId || decision.reportId !== result.reportId ||
    decision.snapshotId !== result.snapshotId || decision.workItemId !== result.workItemId)) {
    throw new ReviewArtifactInvariantError("promotion_provenance_mismatch");
  }
  if (report && (decision.reportId !== report.reportId || decision.snapshotId !== report.snapshotId ||
    decision.workItemId !== report.workItemId)) {
    throw new ReviewArtifactInvariantError("promotion_provenance_mismatch");
  }
  if (snapshot && (decision.snapshotId !== snapshot.snapshotId || decision.workItemId !== snapshot.workItemId)) {
    throw new ReviewArtifactInvariantError("promotion_provenance_mismatch");
  }
  const { promotionFingerprint: _ignored, ...input } = decision;
  const expected = await fingerprint(input);
  if (expected !== decision.promotionFingerprint) throw new ReviewArtifactInvariantError("promotion_fingerprint_mismatch");
}

export async function freezeReviewTarget(
  input: ReviewSnapshotInput,
  authority: HumanAuthority,
  store: ReviewArtifactStore,
  frozenAt = new Date().toISOString(),
): Promise<ReviewSnapshot> {
  requireHumanAuthority(authority);
  if (authority.targetKind !== "REVIEW_SNAPSHOT" || authority.targetId !== input.snapshotId) {
    throw new ReviewArtifactInvariantError("freeze_authority_target_mismatch");
  }
  const expectedBodyFingerprint = await fingerprint(input.candidate.body);
  if (expectedBodyFingerprint !== input.candidate.bodyFingerprint) {
    throw new ReviewArtifactInvariantError("candidate_body_fingerprint_mismatch");
  }
  const snapshotFingerprint = await fingerprint({ kind: "REVIEW_SNAPSHOT", ...snapshotFingerprintInput(input), frozenAt, freezeAuthority: authority });
  const snapshot = freezeDeep({ kind: "REVIEW_SNAPSHOT" as const, ...clone(input), frozenAt, freezeAuthority: clone(authority), snapshotFingerprint });
  const existing = await store.getSnapshot(input.snapshotId);
  if (existing) {
    await validateReviewSnapshot(existing);
    if ((await snapshotIdentityFingerprint(input, authority)) !== (await snapshotIdentityFingerprint(existing, existing.freezeAuthority))) {
      throw new ReviewArtifactInvariantError("snapshot_id_reused_with_different_fingerprint");
    }
    return freezeDeep(clone(existing));
  }
  const stored = await store.createSnapshotIfAbsent(clone(snapshot));
  await validateReviewSnapshot(stored);
  if (stored.snapshotFingerprint !== snapshotFingerprint) {
    throw new ReviewArtifactInvariantError("snapshot_id_reused_with_different_fingerprint");
  }
  return freezeDeep(clone(stored));
}

export async function createReviewReport(input: ReviewReportInput, store: ReviewArtifactStore): Promise<ReviewReport> {
  const snapshot = await store.getSnapshot(input.snapshotId);
  if (!snapshot) throw new ReviewArtifactInvariantError("review_snapshot_not_found");
  await validateReviewSnapshot(snapshot);
  if (snapshot.workItemId !== input.workItemId) throw new ReviewArtifactInvariantError("report_work_item_mismatch");
  if (snapshot.logicalThreadId !== input.parentLogicalThreadId) throw new ReviewArtifactInvariantError("report_parent_thread_mismatch");
  if (input.reviewerLogicalThreadId === input.parentLogicalThreadId) throw new ReviewArtifactInvariantError("reviewer_must_be_fresh");
  const reportFingerprint = await fingerprint({ kind: "REVIEW_REPORT", ...reportFingerprintInput(input) });
  const report = freezeDeep({ kind: "REVIEW_REPORT" as const, ...clone(input), reportFingerprint });
  const existing = await store.getReport(input.reportId);
  if (existing) {
    await validateReviewReport(existing);
    if (existing.snapshotId !== snapshot.snapshotId || existing.workItemId !== snapshot.workItemId ||
      existing.parentLogicalThreadId !== snapshot.logicalThreadId || existing.reviewerLogicalThreadId === existing.parentLogicalThreadId) {
      throw new ReviewArtifactInvariantError("report_provenance_mismatch");
    }
    if (existing.reportFingerprint !== reportFingerprint) throw new ReviewArtifactInvariantError("report_id_reused_with_different_fingerprint");
    return freezeDeep(clone(existing));
  }
  const stored = await store.createReportIfAbsent(clone(report));
  await validateReviewReport(stored);
  if (stored.reportFingerprint !== reportFingerprint) {
    throw new ReviewArtifactInvariantError("report_id_reused_with_different_fingerprint");
  }
  return freezeDeep(clone(stored));
}

export async function createWorkerResult(input: WorkerResultInput, store: ReviewArtifactStore): Promise<WorkerResult> {
  const [snapshot, report] = await Promise.all([store.getSnapshot(input.snapshotId), store.getReport(input.reportId)]);
  if (!snapshot) throw new ReviewArtifactInvariantError("review_snapshot_not_found");
  if (!report) throw new ReviewArtifactInvariantError("review_report_not_found");
  await Promise.all([validateReviewSnapshot(snapshot), validateReviewReport(report)]);
  if (report.snapshotId !== input.snapshotId || report.workItemId !== input.workItemId) throw new ReviewArtifactInvariantError("worker_result_provenance_mismatch");
  if (report.reviewerLogicalThreadId !== input.childLogicalThreadId || report.parentLogicalThreadId !== input.parentLogicalThreadId) {
    throw new ReviewArtifactInvariantError("worker_result_thread_mismatch");
  }
  if (snapshot.candidate.revisionId !== input.relevantRevisionId) throw new ReviewArtifactInvariantError("worker_result_revision_mismatch");
  const workerResultFingerprint = await fingerprint({ kind: "WORKER_RESULT", ...workerResultFingerprintInput(input) });
  const result = freezeDeep({ kind: "WORKER_RESULT" as const, ...clone(input), resultFingerprint: workerResultFingerprint });
  const existing = await store.getWorkerResult(input.resultId);
  if (existing) {
    await validateWorkerResult(existing);
    if (existing.reportId !== report.reportId || existing.snapshotId !== snapshot.snapshotId ||
      existing.workItemId !== snapshot.workItemId || existing.relevantRevisionId !== snapshot.candidate.revisionId ||
      existing.childLogicalThreadId !== report.reviewerLogicalThreadId || existing.parentLogicalThreadId !== report.parentLogicalThreadId) {
      throw new ReviewArtifactInvariantError("worker_result_provenance_mismatch");
    }
    if (existing.resultFingerprint !== workerResultFingerprint) throw new ReviewArtifactInvariantError("result_id_reused_with_different_fingerprint");
    return freezeDeep(clone(existing));
  }
  const stored = await store.createWorkerResultIfAbsent(clone(result));
  await validateWorkerResult(stored);
  if (stored.resultFingerprint !== workerResultFingerprint) {
    throw new ReviewArtifactInvariantError("result_id_reused_with_different_fingerprint");
  }
  return freezeDeep(clone(stored));
}

export async function promoteReviewResult(
  resultId: string,
  authority: HumanAuthority,
  store: ReviewArtifactStore,
  decidedAt = new Date().toISOString(),
): Promise<PromotionDecision> {
  requireHumanAuthority(authority);
  if (authority.targetKind !== "WORKER_RESULT" || authority.targetId !== resultId) {
    throw new ReviewArtifactInvariantError("promotion_authority_target_mismatch");
  }
  const result = await store.getWorkerResult(resultId);
  if (!result) throw new ReviewArtifactInvariantError("worker_result_not_found");
  await validateWorkerResult(result);
  const report = await store.getReport(result.reportId);
  if (!report || report.snapshotId !== result.snapshotId || report.workItemId !== result.workItemId) {
    throw new ReviewArtifactInvariantError("promotion_provenance_mismatch");
  }
  await validateReviewReport(report);
  const snapshot = await store.getSnapshot(result.snapshotId);
  if (!snapshot) throw new ReviewArtifactInvariantError("review_snapshot_not_found");
  await validateReviewSnapshot(snapshot);
  if (result.relevantRevisionId !== snapshot.candidate.revisionId || report.parentLogicalThreadId !== snapshot.logicalThreadId) {
    throw new ReviewArtifactInvariantError("promotion_provenance_mismatch");
  }
  const decisionInput = {
    kind: "HUMAN_PROMOTION" as const,
    resultId: result.resultId,
    reportId: result.reportId,
    snapshotId: result.snapshotId,
    workItemId: result.workItemId,
    authority: clone(authority),
    decidedAt,
  };
  const promotionFingerprint = await fingerprint(decisionInput);
  const decision = freezeDeep({ ...decisionInput, promotionFingerprint });
  const stored = await store.createPromotionIfAbsent(clone(decision));
  await validatePromotionDecision(stored, result, report, snapshot);
  if (stored.authority.eventId !== authority.eventId || stored.authority.actorId !== authority.actorId ||
    stored.authority.approvedAt !== authority.approvedAt || stored.authority.source !== authority.source ||
    stored.authority.targetKind !== authority.targetKind || stored.authority.targetId !== authority.targetId ||
    stored.resultId !== decision.resultId || stored.reportId !== decision.reportId ||
    stored.snapshotId !== decision.snapshotId || stored.workItemId !== decision.workItemId) {
    throw new ReviewArtifactInvariantError("promotion_already_recorded");
  }
  return freezeDeep(clone(stored));
}

export class InMemoryReviewArtifactStore implements ReviewArtifactStore {
  private readonly snapshots = new Map<string, ReviewSnapshot>();
  private readonly reports = new Map<string, ReviewReport>();
  private readonly results = new Map<string, WorkerResult>();
  private readonly promotions = new Map<string, PromotionDecision>();

  async getSnapshot(id: string): Promise<ReviewSnapshot | undefined> { const value = this.snapshots.get(id); return value && clone(value); }
  async createSnapshotIfAbsent(value: ReviewSnapshot): Promise<ReviewSnapshot> {
    const existing = this.snapshots.get(value.snapshotId);
    if (existing) return clone(existing);
    this.snapshots.set(value.snapshotId, clone(value));
    return clone(value);
  }
  async getReport(id: string): Promise<ReviewReport | undefined> { const value = this.reports.get(id); return value && clone(value); }
  async createReportIfAbsent(value: ReviewReport): Promise<ReviewReport> {
    const existing = this.reports.get(value.reportId);
    if (existing) return clone(existing);
    this.reports.set(value.reportId, clone(value));
    return clone(value);
  }
  async getWorkerResult(id: string): Promise<WorkerResult | undefined> { const value = this.results.get(id); return value && clone(value); }
  async createWorkerResultIfAbsent(value: WorkerResult): Promise<WorkerResult> {
    const existing = this.results.get(value.resultId);
    if (existing) return clone(existing);
    this.results.set(value.resultId, clone(value));
    return clone(value);
  }
  async getPromotion(id: string): Promise<PromotionDecision | undefined> { const value = this.promotions.get(id); return value && clone(value); }
  async createPromotionIfAbsent(value: PromotionDecision): Promise<PromotionDecision> {
    const existing = this.promotions.get(value.resultId);
    if (existing) return clone(existing);
    this.promotions.set(value.resultId, clone(value));
    return clone(value);
  }
}
