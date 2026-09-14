import { describe, expect, it } from "vitest";
import {
  InMemoryReviewArtifactStore,
  type ReviewSnapshot,
  ReviewArtifactInvariantError,
  createReviewReport,
  createWorkerResult,
  freezeReviewTarget,
  promoteReviewResult,
} from "../src/core/review-freeze";

class AsyncCasSnapshotStore extends InMemoryReviewArtifactStore {
  private createCalls = 0;
  private releaseSecondCreate?: () => void;

  async createSnapshotIfAbsent(snapshot: ReviewSnapshot): Promise<ReviewSnapshot> {
    this.createCalls += 1;
    if (this.createCalls === 1) {
      await new Promise<void>(resolve => { this.releaseSecondCreate = resolve; });
    } else {
      this.releaseSecondCreate?.();
    }
    return super.createSnapshotIfAbsent(snapshot);
  }
}

class ForgedSnapshotStore extends InMemoryReviewArtifactStore {
  constructor(private readonly forgedSnapshot: ReviewSnapshot) {
    super();
  }

  async getSnapshot(id: string): Promise<ReviewSnapshot | undefined> {
    return id === this.forgedSnapshot.snapshotId ? structuredClone(this.forgedSnapshot) : undefined;
  }
}

const authority = { actorId: "human-1", approved: true as const, approvedAt: "2026-09-12T00:00:00.000Z", eventId: "evt-freeze-1", source: "human-ui", targetKind: "REVIEW_SNAPSHOT" as const, targetId: "snap-1" };
const snapshotInput = {
  snapshotId: "snap-1", workItemId: "wi-1", logicalThreadId: "pdlt-1",
  candidate: { revisionId: "rev-7", body: "candidate body", bodyFingerprint: "sha256:967a76bc347a430d412e7cd6788efdeb4b87cd4f8b2c615c112eff555be47cbf" },
  includedRefs: ["docs/design.md", "docs/contract.md"], excludedMaterialCounts: { open: 2 },
  readinessChecklist: { tests: true, docs: true }, openQuestions: ["Q1"],
  sourceProvenance: { repo: "noos_docs", revision: "abc123" },
};

describe("immutable review freeze and provenance", () => {
  it("freezes exact target, survives reload, and is idempotent", async () => {
    const store = new InMemoryReviewArtifactStore();
    const first = await freezeReviewTarget(snapshotInput, authority, store, "2026-09-12T01:00:00.000Z");
    const second = await freezeReviewTarget(snapshotInput, authority, store, "2026-09-12T02:00:00.000Z");
    expect(second.snapshotFingerprint).toBe(first.snapshotFingerprint);
    expect(second.candidate.body).toBe("candidate body");
    expect(Object.isFrozen(second)).toBe(true);
    await expect(freezeReviewTarget({ ...snapshotInput, candidate: { ...snapshotInput.candidate, body: "moving candidate", bodyFingerprint: "sha256:60d0d8bccf605fbc839dc0466377033a24d07519143a4b1507f49958243ff3a4" } }, authority, store, "2026-09-12T02:00:00.000Z")).rejects.toThrow("snapshot_id_reused_with_different_fingerprint");
  });

  it("requires explicit Human authority and never promotes from a report alone", async () => {
    const store = new InMemoryReviewArtifactStore();
    await expect(freezeReviewTarget(snapshotInput, { ...authority, approved: false as never }, store)).rejects.toThrow("human_authority_required");
    await freezeReviewTarget(snapshotInput, authority, store);
    const report = await createReviewReport({ reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", reviewerLogicalThreadId: "reviewer-1", parentLogicalThreadId: "pdlt-1", reviewerInstructionProvenance: { contract: "review-v4", revision: "abc123" }, findings: ["finding"], completedAt: "2026-09-12T03:00:00.000Z" }, store);
    expect(report.snapshotId).toBe("snap-1");
    await expect(promoteReviewResult("missing", { ...authority, targetKind: "WORKER_RESULT", targetId: "missing" }, store)).rejects.toThrow("worker_result_not_found");
  });

  it("keeps report and WorkerResult bound to exact snapshot and reviewer provenance", async () => {
    const store = new InMemoryReviewArtifactStore();
    await freezeReviewTarget(snapshotInput, authority, store);
    await createReviewReport({ reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", reviewerLogicalThreadId: "reviewer-1", parentLogicalThreadId: "pdlt-1", reviewerInstructionProvenance: { contract: "review-v4", revision: "abc123" }, findings: ["finding"], completedAt: "2026-09-12T03:00:00.000Z" }, store);
    const result = await createWorkerResult({ resultId: "result-1", reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", childLogicalThreadId: "reviewer-1", parentLogicalThreadId: "pdlt-1", relevantRevisionId: "rev-7", completionReceipt: { receiptId: "receipt-1", status: "COMPLETED" }, completedAt: "2026-09-12T04:00:00.000Z" }, store);
    const promoted = await promoteReviewResult(result.resultId, { ...authority, targetKind: "WORKER_RESULT", targetId: result.resultId, eventId: "evt-promote-1" }, store, "2026-09-12T05:00:00.000Z");
    expect(promoted.kind).toBe("HUMAN_PROMOTION");
    await expect(createWorkerResult({ resultId: "result-2", reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", childLogicalThreadId: "other-reviewer", parentLogicalThreadId: "pdlt-1", relevantRevisionId: "rev-7", completionReceipt: {}, completedAt: "2026-09-12T04:00:00.000Z" }, store)).rejects.toThrow(ReviewArtifactInvariantError);
  });

  it("rejects same identity with changed immutable content", async () => {
    const store = new InMemoryReviewArtifactStore();
    await freezeReviewTarget(snapshotInput, authority, store);
    await expect(freezeReviewTarget({ ...snapshotInput, openQuestions: ["changed"] }, authority, store)).rejects.toThrow("snapshot_id_reused_with_different_fingerprint");
  });

  it("requires a fresh reviewer and the exact frozen candidate revision", async () => {
    const store = new InMemoryReviewArtifactStore();
    await freezeReviewTarget(snapshotInput, authority, store);
    await expect(createReviewReport({ reportId: "bad-parent", snapshotId: "snap-1", workItemId: "wi-1", reviewerLogicalThreadId: "reviewer-1", parentLogicalThreadId: "other-parent", reviewerInstructionProvenance: {}, findings: [], completedAt: "2026-09-12T03:00:00.000Z" }, store)).rejects.toThrow("report_parent_thread_mismatch");
    await expect(createReviewReport({ reportId: "same-thread", snapshotId: "snap-1", workItemId: "wi-1", reviewerLogicalThreadId: "pdlt-1", parentLogicalThreadId: "pdlt-1", reviewerInstructionProvenance: {}, findings: [], completedAt: "2026-09-12T03:00:00.000Z" }, store)).rejects.toThrow("reviewer_must_be_fresh");
    await createReviewReport({ reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", reviewerLogicalThreadId: "reviewer-1", parentLogicalThreadId: "pdlt-1", reviewerInstructionProvenance: {}, findings: [], completedAt: "2026-09-12T03:00:00.000Z" }, store);
    await expect(createWorkerResult({ resultId: "wrong-revision", reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", childLogicalThreadId: "reviewer-1", parentLogicalThreadId: "pdlt-1", relevantRevisionId: "rev-8", completionReceipt: {}, completedAt: "2026-09-12T04:00:00.000Z" }, store)).rejects.toThrow("worker_result_revision_mismatch");
  });

  it("keeps concurrent same-id writes create-once and persists Human Promote", async () => {
    const store = new InMemoryReviewArtifactStore();
    const [one, two] = await Promise.all([
      freezeReviewTarget(snapshotInput, authority, store, "2026-09-12T01:00:00.000Z"),
      freezeReviewTarget(snapshotInput, authority, store, "2026-09-12T02:00:00.000Z"),
    ]);
    expect(one.snapshotFingerprint).toBe(two.snapshotFingerprint);
    await createReviewReport({ reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", reviewerLogicalThreadId: "reviewer-1", parentLogicalThreadId: "pdlt-1", reviewerInstructionProvenance: {}, findings: [], completedAt: "2026-09-12T03:00:00.000Z" }, store);
    await createWorkerResult({ resultId: "result-1", reportId: "report-1", snapshotId: "snap-1", workItemId: "wi-1", childLogicalThreadId: "reviewer-1", parentLogicalThreadId: "pdlt-1", relevantRevisionId: "rev-7", completionReceipt: {}, completedAt: "2026-09-12T04:00:00.000Z" }, store);
    const promoteAuthority = { ...authority, targetKind: "WORKER_RESULT" as const, targetId: "result-1", eventId: "evt-promote-1" };
    const first = await promoteReviewResult("result-1", promoteAuthority, store, "2026-09-12T05:00:00.000Z");
    const retry = await promoteReviewResult("result-1", promoteAuthority, store, "2026-09-12T06:00:00.000Z");
    expect(retry.promotionFingerprint).toBe(first.promotionFingerprint);
    await expect(promoteReviewResult("result-1", { ...promoteAuthority, actorId: "other-human", eventId: "evt-promote-2" }, store)).rejects.toThrow("promotion_already_recorded");
    expect((await store.getPromotion("result-1"))?.resultId).toBe("result-1");
  });

  it("rejects a concurrent same-id write whose immutable content loses the race", async () => {
    const store = new InMemoryReviewArtifactStore();
    const changed = {
      ...snapshotInput,
      candidate: {
        ...snapshotInput.candidate,
        body: "moving candidate",
        bodyFingerprint: "sha256:60d0d8bccf605fbc839dc0466377033a24d07519143a4b1507f49958243ff3a4",
      },
    };
    const outcomes = await Promise.allSettled([
      freezeReviewTarget(snapshotInput, authority, store, "2026-09-12T01:00:00.000Z"),
      freezeReviewTarget(changed, authority, store, "2026-09-12T01:00:00.000Z"),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    // Which write wins the race is not determined (both await a fingerprint before
    // the CAS), but the stored immutable snapshot must be exactly the winner's
    // content: the loser neither overwrites nor mixes into it.
    const winners = outcomes.filter((outcome): outcome is PromiseFulfilledResult<ReviewSnapshot> => outcome.status === "fulfilled");
    expect((await store.getSnapshot("snap-1"))?.candidate.body).toBe(winners[0].value.candidate.body);
  });

  it("exercises an async CAS race after both requests have read absence", async () => {
    const store = new AsyncCasSnapshotStore();
    const changed = {
      ...snapshotInput,
      candidate: {
        ...snapshotInput.candidate,
        body: "moving candidate",
        bodyFingerprint: "sha256:60d0d8bccf605fbc839dc0466377033a24d07519143a4b1507f49958243ff3a4",
      },
    };
    const outcomes = await Promise.allSettled([
      freezeReviewTarget(snapshotInput, authority, store, "2026-09-12T01:00:00.000Z"),
      freezeReviewTarget(changed, authority, store, "2026-09-12T01:00:00.000Z"),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
  });

  it("rejects forged Human authority on a persisted snapshot during recovery", async () => {
    const baseStore = new InMemoryReviewArtifactStore();
    const snapshot = await freezeReviewTarget(snapshotInput, authority, baseStore);
    const forgedValues = [
      { ...snapshot.freezeAuthority, approved: false as never },
      { ...snapshot.freezeAuthority, source: "" },
      { ...snapshot.freezeAuthority, eventId: "" },
      { ...snapshot.freezeAuthority, approvedAt: "not-a-time" },
      { ...snapshot.freezeAuthority, targetKind: "WORKER_RESULT" as const },
      { ...snapshot.freezeAuthority, targetId: "other-snapshot" },
    ];
    for (const freezeAuthority of forgedValues) {
      const persisted = { ...snapshot, freezeAuthority };
      await expect(createReviewReport({
        reportId: `forged-${forgedValues.indexOf(freezeAuthority)}`,
        snapshotId: snapshot.snapshotId,
        workItemId: snapshot.workItemId,
        reviewerLogicalThreadId: "reviewer-1",
        parentLogicalThreadId: snapshot.logicalThreadId,
        reviewerInstructionProvenance: {},
        findings: [],
        completedAt: "2026-09-12T03:00:00.000Z",
      }, new ForgedSnapshotStore(persisted))).rejects.toThrow(/human_authority_required|freeze_authority_target_mismatch/);
    }
  });
});
