import { describe, expect, it } from "vitest";
import {
  buildResultEnvelope,
  compileLaunchInstructions,
  CrossAgentMailbox,
  emptyMailboxState,
  extractMarkerBlocks,
  findForbiddenEnvelopeFields,
  InMemoryMailboxStore,
  MailboxConflictError,
  MailboxInvariantError,
  parseEnvelopeJson,
  type AtomicMailboxStore,
  type CrossAgentMailboxState,
  type MailboxHandoffPacket,
  type OpenMailboxEscalationInput,
  type RawMailboxComment,
  type RenderedEnvelope,
  type ResultEnvelopeWire
} from "../src/core/cross-agent-mailbox";

const PROVENANCE = {
  repository: "futouyiba/noos-shuttle",
  issueRef: "futouyiba/noos-shuttle#10",
  pullRequestRef: "futouyiba/noos-shuttle#20",
  pullRequestHeadSha: "a49303cabf436f3398a596685d36d2792e6a08a1",
  commitSha: "9ed74f263126ac43a1a4c1f926633594b2abf5c6",
  pathRefs: ["docs/deliberation-harness/cross-agent-handoff-escalation-contract-v3.md@9ed74f263126ac43a1a4c1f926633594b2abf5c6"],
  blobRefs: []
};

function escalationInput(overrides: Partial<OpenMailboxEscalationInput> = {}): OpenMailboxEscalationInput {
  return {
    escalationId: "esc-mailbox-1",
    workItemRef: "futouyiba/noos-shuttle#10",
    sourceOperationRef: "futouyiba/noos-shuttle#20",
    sourceRole: "IMPLEMENTATION",
    destinationRole: "PRIMARY_DESIGN",
    kind: "NEEDS_DESIGN",
    blockerSummary: "Contract conflict between delivery ledger and reducer interpretation.",
    question: "Is DELIVER_CHILD_RESULT a SubmissionOperation specialization or a parallel ledger?",
    authorityBasisRef: "futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1",
    authorityRefs: ["futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1/docs/harness/state-delta-reducer-contract.md"],
    evidenceRefs: ["futouyiba/noos-shuttle#20/files"],
    provenance: PROVENANCE,
    ...overrides
  };
}

function packetInput(escalationId: string, overrides: Record<string, unknown> = {}) {
  return {
    escalationId,
    reason: "Adjudication needed before implementation continues.",
    goal: "Close the delivery-vs-reducer interpretation conflict.",
    scope: "Deliver-child-result identity only; no new transport protocol.",
    nonGoals: ["No second result ledger"],
    implementationArtifactRefs: ["src/core/deliver-child-result.ts"],
    boundedContextRefs: ["docs/deliberation-harness/w5-delivery-wiring-design.md"],
    expectedReturnContract: "One ESCALATION_RESULT marker with exact authority refs and decision rationale.",
    stopCondition: "Stop after posting the result marker; do not modify contracts.",
    ...overrides
  };
}

function resultEnvelopeWire(envelope: RenderedEnvelope): ResultEnvelopeWire {
  return envelope.envelope as ResultEnvelopeWire;
}

function markerComment(ref: string, rendered: RenderedEnvelope, updatedAt = "2026-09-16T00:00:00Z"): RawMailboxComment {
  return { commentRef: ref, author: "design-agent", updatedAt, body: rendered.body };
}

async function openedMailbox(): Promise<{ mailbox: CrossAgentMailbox; store: InMemoryMailboxStore }> {
  const store = new InMemoryMailboxStore();
  const mailbox = new CrossAgentMailbox(store);
  await mailbox.openEscalation(escalationInput());
  return { mailbox, store };
}

describe("escalation identity persisted before post", () => {
  it("persists an OPEN HUMAN_MEDIATED escalation with no posts yet", async () => {
    const { mailbox } = await openedMailbox();
    const state = await mailbox.snapshot();
    expect(state.escalations).toHaveLength(1);
    expect(state.escalations[0].status).toBe("OPEN");
    expect(state.escalations[0].resolutionMode).toBe("HUMAN_MEDIATED");
    expect(state.posts).toHaveLength(0);
    expect(state.scopeRef).toBe("futouyiba/noos-shuttle#10");
  });

  it("create-or-gets by escalation id + fingerprint across a restart", async () => {
    const { mailbox, store } = await openedMailbox();
    const again = await new CrossAgentMailbox(store).openEscalation(escalationInput());
    const state = await mailbox.snapshot();
    expect(state.escalations).toHaveLength(1);
    expect(again.escalationId).toBe("esc-mailbox-1");
    expect(again.escalationFingerprint).toBe(state.escalations[0].escalationFingerprint);
  });

  it("rejects the same id with different semantic content", async () => {
    const { mailbox } = await openedMailbox();
    await expect(
      mailbox.openEscalation(escalationInput({ blockerSummary: "Different blocker." }))
    ).rejects.toMatchObject({ name: "MailboxConflictError", code: "escalation_fingerprint_mismatch" });
  });

  it("rejects automatic template-bound mode (§19 blocked boundary)", async () => {
    const mailbox = new CrossAgentMailbox(new InMemoryMailboxStore());
    await expect(
      mailbox.openEscalation(escalationInput({ resolutionMode: "AUTOMATIC_TEMPLATE_BOUND" }))
    ).rejects.toMatchObject({ name: "MailboxInvariantError", code: "automatic_mode_unavailable" });
  });

  it("requires an exact revision anchor in provenance", async () => {
    const mailbox = new CrossAgentMailbox(new InMemoryMailboxStore());
    await expect(
      mailbox.openEscalation(escalationInput({ provenance: { repository: "futouyiba/noos-shuttle", pathRefs: ["docs/a.md"], blobRefs: [] } }))
    ).rejects.toMatchObject({ code: "exact_revision_required" });
  });

  it("validates repository and sha formats", async () => {
    const mailbox = new CrossAgentMailbox(new InMemoryMailboxStore());
    await expect(mailbox.openEscalation(escalationInput({ provenance: { ...PROVENANCE, repository: "not-a-repo" } }))).rejects.toMatchObject({
      code: "invalid_repository"
    });
    await expect(mailbox.openEscalation(escalationInput({ provenance: { ...PROVENANCE, commitSha: "abc123" } }))).rejects.toMatchObject({
      code: "invalid_sha"
    });
  });

  it("keeps one ledger per work item ref", async () => {
    const { mailbox } = await openedMailbox();
    await expect(
      mailbox.openEscalation(escalationInput({ escalationId: "esc-mailbox-2", workItemRef: "futouyiba/noos-shuttle#11" }))
    ).rejects.toMatchObject({ code: "scope_mismatch" });
  });

  it("mints an escalation id when none is supplied", async () => {
    const mailbox = new CrossAgentMailbox(new InMemoryMailboxStore());
    const escalation = await mailbox.openEscalation(escalationInput({ escalationId: undefined }));
    expect(escalation.escalationId.startsWith("esc-")).toBe(true);
  });
});

describe("commit fence: concurrent writers cannot silently lose records", () => {
  // Parks the first N reads so two commits interleave on the same base state
  // before either CAS runs — the exact lost-update window the revision fence
  // must close (F1 regression).
  class InterleavingMailboxStore implements AtomicMailboxStore {
    private delegate = new InMemoryMailboxStore();
    private readCount = 0;
    private gate: Promise<void>;
    private openGate!: () => void;

    constructor(private readonly parkFirstReads: number) {
      this.gate = new Promise((resolve) => {
        this.openGate = resolve;
      });
    }

    async waitForReads(count: number): Promise<void> {
      while (this.readCount < count) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    release(): void {
      this.openGate();
    }

    async read(): Promise<CrossAgentMailboxState> {
      this.readCount += 1;
      const shouldPark = this.readCount <= this.parkFirstReads;
      const value = await this.delegate.read();
      if (shouldPark) {
        await this.gate;
      }
      return value;
    }

    async compareAndSet(expectedRevision: number, next: CrossAgentMailboxState): Promise<boolean> {
      return this.delegate.compareAndSet(expectedRevision, next);
    }
  }

  it("serializes interleaved opens through the revision fence", async () => {
    const store = new InterleavingMailboxStore(2);
    const mailbox = new CrossAgentMailbox(store);
    const openA = mailbox.openEscalation(escalationInput({ escalationId: "esc-a" }));
    const openB = mailbox.openEscalation(escalationInput({ escalationId: "esc-b" }));
    await store.waitForReads(2);
    store.release();
    await Promise.all([openA, openB]);
    const state = await mailbox.snapshot();
    expect(state.escalations.map((item) => item.escalationId).sort()).toEqual(["esc-a", "esc-b"]);
    expect(state.revision).toBeGreaterThanOrEqual(2);
  });
});

describe("immutable packet identity, revision, fingerprint", () => {
  it("compiles r1 with deterministic id and defaults from the escalation", async () => {
    const { mailbox } = await openedMailbox();
    const packet = await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    expect(packet.packetId).toBe("esc-mailbox-1/packet/r1");
    expect(packet.packetRevision).toBe(1);
    expect(packet.supersedesPacketId).toBeUndefined();
    expect(packet.preciseQuestions).toEqual([escalationInput().question]);
    expect(packet.exactAuthorityRefs[0]).toBe(escalationInput().authorityBasisRef);
  });

  it("re-compiling identical content create-or-gets the latest packet", async () => {
    const { mailbox } = await openedMailbox();
    const first = await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    const rerun = await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    expect(rerun.packetId).toBe(first.packetId);
    expect((await mailbox.snapshot()).packets).toHaveLength(1);
  });

  it("changed content mints the next revision with supersedes lineage", async () => {
    const { mailbox } = await openedMailbox();
    const r1 = await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    const r2 = await mailbox.compilePacket(packetInput("esc-mailbox-1", { scope: "Narrowed scope after partial adjudication." }));
    expect(r2.packetId).toBe("esc-mailbox-1/packet/r2");
    expect(r2.packetRevision).toBe(2);
    expect(r2.supersedesPacketId).toBe(r1.packetId);
    expect((await mailbox.snapshot()).packets.map((packet: MailboxHandoffPacket) => packet.packetId)).toEqual([r1.packetId, r2.packetId]);
  });

  it("renders a deterministic marker body without forbidden fields", async () => {
    const { mailbox } = await openedMailbox();
    const packet = await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    const first = await mailbox.renderPacketEnvelope("esc-mailbox-1", packet.packetId);
    const second = await mailbox.renderPacketEnvelope("esc-mailbox-1", packet.packetId);
    expect(second.envelopeFingerprint).toBe(first.envelopeFingerprint);
    expect(first.body).toContain("```noos-mailbox");
    expect(extractMarkerBlocks(first.body)).toHaveLength(1);
    expect(findForbiddenEnvelopeFields(first.envelope)).toEqual([]);
    const parsed = await parseEnvelopeJson(extractMarkerBlocks(first.body)[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.envelope.marker_kind === "ESCALATION_PACKET") {
      expect(parsed.envelope.packet.packet_id).toBe(packet.packetId);
      expect(parsed.envelope.escalation.status).toBe("OPEN");
      expect(parsed.envelope.escalation.provenance.pull_request_head_sha).toBe(PROVENANCE.pullRequestHeadSha);
    }
  });

  it("rejects content that cannot round-trip through the fenced marker", async () => {
    const { mailbox } = await openedMailbox();
    const packet = await mailbox.compilePacket(packetInput("esc-mailbox-1", { goal: "Uses a ``` fenced block inside" }));
    await expect(mailbox.renderPacketEnvelope("esc-mailbox-1", packet.packetId)).rejects.toMatchObject({
      code: "marker_unsafe_content"
    });
    await expect(
      buildResultEnvelope({
        resultId: "res-unsafe",
        sourceEscalationId: "esc-mailbox-1",
        sourceRole: "PRIMARY_DESIGN",
        authorityRole: "PRIMARY_DESIGN",
        completionStatus: "COMPLETE",
        summary: "Contains ``` which would terminate the marker fence.",
        recommendedNextAction: "Continue."
      })
    ).rejects.toMatchObject({ code: "marker_unsafe_content" });
  });
});

describe("marker post records", () => {
  it("create-or-gets by comment ref and reuses identities after a lost acknowledgement", async () => {
    const { mailbox, store } = await openedMailbox();
    const packet = await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    const rendered = await mailbox.renderPacketEnvelope("esc-mailbox-1", packet.packetId);
    const post = await mailbox.recordPost({
      markerKind: "ESCALATION_PACKET",
      packetId: packet.packetId,
      commentRef: "futouyiba/noos-shuttle#10/comment/111",
      envelopeFingerprint: rendered.envelopeFingerprint
    });
    const replay = await new CrossAgentMailbox(store).recordPost({
      markerKind: "ESCALATION_PACKET",
      packetId: packet.packetId,
      commentRef: "futouyiba/noos-shuttle#10/comment/111",
      envelopeFingerprint: rendered.envelopeFingerprint
    });
    expect(replay.postId).toBe(post.postId);
    expect((await mailbox.snapshot()).posts).toHaveLength(1);
  });

  it("rejects a divergent fingerprint for the same comment ref or packet identity", async () => {
    const { mailbox } = await openedMailbox();
    const packet = await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    await mailbox.recordPost({
      markerKind: "ESCALATION_PACKET",
      packetId: packet.packetId,
      commentRef: "futouyiba/noos-shuttle#10/comment/111",
      envelopeFingerprint: "sha256:" + "a".repeat(64)
    });
    await expect(
      mailbox.recordPost({
        markerKind: "ESCALATION_PACKET",
        packetId: packet.packetId,
        commentRef: "futouyiba/noos-shuttle#10/comment/111",
        envelopeFingerprint: "sha256:" + "b".repeat(64)
      })
    ).rejects.toMatchObject({ code: "post_fingerprint_mismatch" });
    await expect(
      mailbox.recordPost({
        markerKind: "ESCALATION_PACKET",
        packetId: packet.packetId,
        commentRef: "futouyiba/noos-shuttle#10/comment/222",
        envelopeFingerprint: "sha256:" + "b".repeat(64)
      })
    ).rejects.toMatchObject({ code: "envelope_fingerprint_mismatch" });
  });
});

describe("result envelopes never carry result_kind or sufficiency fields", () => {
  it("builds a result envelope with a descriptive completion_status only", async () => {
    const rendered = await buildResultEnvelope({
      resultId: "res-adjudication-1",
      sourceEscalationId: "esc-mailbox-1",
      sourcePacketId: "esc-mailbox-1/packet/r1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "DELIVER_CHILD_RESULT is a SubmissionOperation specialization.",
      artifactRefs: ["futouyiba/noos_docs@a49303ca/docs/harness/state-delta-reducer-contract.md"],
      recommendedNextAction: "Refactor deliver-child-result to reference submissionOperationId."
    });
    expect(findForbiddenEnvelopeFields(rendered.envelope)).toEqual([]);
    const wire = resultEnvelopeWire(rendered);
    expect(wire.result.completion_status).toBe("COMPLETE");
    expect(Object.keys(wire.result)).not.toContain("result_kind");
    expect(JSON.stringify(wire)).not.toMatch(/sufficien/i);
  });

  it("rejects marker envelopes carrying result_kind or sufficiency fields", async () => {
    const forbiddenKinds = await Promise.all(
      [
        { result_kind: "ADJUDICATION" },
        { sufficient: true },
        { is_sufficient: true },
        { sufficiency: "declared" }
      ].map(async (extra) =>
        parseEnvelopeJson(
          JSON.stringify({
            noos_mailbox: 1,
            marker_kind: "ESCALATION_RESULT",
            result: {
              result_id: "res-1",
              result_fingerprint: "sha256:" + "0".repeat(64),
              source_escalation_id: "esc-1",
              source_packet_id: null,
              source_role: "PRIMARY_DESIGN",
              authority_role: "PRIMARY_DESIGN",
              completion_status: "COMPLETE",
              summary: "ok",
              recommended_next_action: "continue",
              ...extra
            }
          })
        )
      )
    );
    for (const parsed of forbiddenKinds) {
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toBe("forbidden_field");
      }
    }
  });

  it("rejects unknown versions and malformed markers deterministically", async () => {
    const unknownVersion = await parseEnvelopeJson(
      JSON.stringify({ noos_mailbox: 99, marker_kind: "ESCALATION_RESULT", result: {} })
    );
    expect(unknownVersion).toMatchObject({ ok: false, reason: "unknown_version" });
    const malformed = await parseEnvelopeJson("{not json");
    expect(malformed).toMatchObject({ ok: false, reason: "not_json" });
    const unknownKind = await parseEnvelopeJson(JSON.stringify({ noos_mailbox: 1, marker_kind: "CHAT", result: {} }));
    expect(unknownKind).toMatchObject({ ok: false, reason: "unknown_marker_kind" });
  });
});

describe("immutable observation capture and result dedup", () => {
  it("freezes a result observation once and skips unchanged re-observation", async () => {
    const { mailbox } = await openedMailbox();
    const rendered = await buildResultEnvelope({
      resultId: "res-adjudication-1",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Decision recorded.",
      recommendedNextAction: "Continue implementation."
    });
    const outcome = await mailbox.observeComments([markerComment("futouyiba/noos-shuttle#10/comment/111", rendered)]);
    expect(outcome.commentObservations[0].markerStatus).toBe("VALID_RESULT");
    expect(outcome.resultObservations).toHaveLength(1);
    const replay = await mailbox.observeComments([markerComment("futouyiba/noos-shuttle#10/comment/111", rendered)]);
    expect(replay.skippedAlreadyObserved).toEqual(["futouyiba/noos-shuttle#10/comment/111"]);
    const state = await mailbox.snapshot();
    expect(state.commentObservations).toHaveLength(1);
    expect(state.resultObservations).toHaveLength(1);
  });

  it("deduplicates the same result id + fingerprint across comments", async () => {
    const { mailbox } = await openedMailbox();
    const rendered = await buildResultEnvelope({
      resultId: "res-adjudication-1",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Decision recorded.",
      recommendedNextAction: "Continue."
    });
    await mailbox.observeComments([markerComment("futouyiba/noos-shuttle#10/comment/111", rendered)]);
    const mirrored = await mailbox.observeComments([markerComment("futouyiba/noos-shuttle#10/comment/222", rendered)]);
    expect(mirrored.resultObservations).toHaveLength(0);
    expect(mirrored.resultFingerprintConflicts).toHaveLength(0);
    expect((await mailbox.snapshot()).resultObservations).toHaveLength(1);
  });

  it("records an edited comment as a new observation plus a fingerprint conflict, never rewriting history", async () => {
    const { mailbox } = await openedMailbox();
    const original = await buildResultEnvelope({
      resultId: "res-adjudication-1",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Original adjudication.",
      recommendedNextAction: "Continue."
    });
    await mailbox.observeComments([markerComment("futouyiba/noos-shuttle#10/comment/111", original)]);
    const edited = await buildResultEnvelope({
      resultId: "res-adjudication-1",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "EDITED after consumption.",
      recommendedNextAction: "Continue differently."
    });
    const outcome = await mailbox.observeComments([
      markerComment("futouyiba/noos-shuttle#10/comment/111", edited, "2026-09-16T01:00:00Z")
    ]);
    expect(outcome.commentObservations[0].editedAfterObservation).toBe(true);
    expect(outcome.resultFingerprintConflicts).toHaveLength(1);
    const conflict = outcome.resultFingerprintConflicts[0];
    expect(conflict.resultId).toBe("res-adjudication-1");
    expect(conflict.status).toBe("PENDING_TRIAGE");
    const state = await mailbox.snapshot();
    expect(state.commentObservations).toHaveLength(2);
    expect(state.resultObservations).toHaveLength(1);
    expect(state.resultObservations[0].resultFingerprint).toBe(resultEnvelopeWire(original).result.result_fingerprint);
  });

  it("records competing distinct results without adjudicating them", async () => {
    const { mailbox } = await openedMailbox();
    const first = await buildResultEnvelope({
      resultId: "res-adjudication-1",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "First adjudication.",
      recommendedNextAction: "Continue."
    });
    const second = await buildResultEnvelope({
      resultId: "res-adjudication-2",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "PARTIAL",
      summary: "Competing adjudication.",
      recommendedNextAction: "Seek human triage."
    });
    await mailbox.observeComments([
      markerComment("futouyiba/noos-shuttle#10/comment/111", first),
      markerComment("futouyiba/noos-shuttle#10/comment/222", second)
    ]);
    const state = await mailbox.snapshot();
    expect(state.resultObservations.map((observation) => observation.resultId).sort()).toEqual([
      "res-adjudication-1",
      "res-adjudication-2"
    ]);
  });

  it("fails closed on forbidden-field markers and ignores marker-free comments", async () => {
    const { mailbox } = await openedMailbox();
    const smuggled = await buildResultEnvelope({
      resultId: "res-smuggled",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Attempt to smuggle sufficiency.",
      recommendedNextAction: "Resume automatically."
    });
    const smuggledWire = JSON.parse(JSON.stringify(smuggled.envelope)) as Record<string, unknown>;
    (smuggledWire.result as Record<string, unknown>).result_kind = "SUFFICIENT_ADJUDICATION";
    const smuggledBody = "```noos-mailbox\n" + JSON.stringify(smuggledWire, null, 2) + "\n```";
    const outcome = await mailbox.observeComments([
      { commentRef: "futouyiba/noos-shuttle#10/comment/333", author: "design-agent", updatedAt: "2026-09-16T00:00:00Z", body: smuggledBody },
      { commentRef: "futouyiba/noos-shuttle#10/comment/334", author: "human", updatedAt: "2026-09-16T00:00:00Z", body: "Plain review comment." }
    ]);
    expect(outcome.commentObservations).toHaveLength(1);
    expect(outcome.commentObservations[0].markerStatus).toBe("FORBIDDEN_FIELD");
    expect(outcome.resultObservations).toHaveLength(0);
    expect((await mailbox.snapshot()).resultObservations).toHaveLength(0);
  });
});

describe("restart-safe marker discovery", () => {
  async function preparedMailboxWithPostedPacket() {
    const opened = await openedMailbox();
    const mailbox = opened.mailbox;
    await mailbox.compilePacket(packetInput("esc-mailbox-1"));
    const state = await mailbox.snapshot();
    const packet = state.packets[0];
    const rendered = await mailbox.renderPacketEnvelope("esc-mailbox-1", packet.packetId);
    await mailbox.recordPost({
      markerKind: "ESCALATION_PACKET",
      packetId: packet.packetId,
      commentRef: "futouyiba/noos-shuttle#10/comment/100",
      envelopeFingerprint: rendered.envelopeFingerprint
    });
    return { mailbox, store: opened.store, rendered, packet };
  }

  it("discovers the blocking escalation and latest packet from the ledger alone", async () => {
    const { mailbox } = await preparedMailboxWithPostedPacket();
    await mailbox.compilePacket(packetInput("esc-mailbox-1", { scope: "Narrowed after partial adjudication." }));
    const report = await mailbox.discover();
    expect(report.escalations).toHaveLength(1);
    const discovered = report.escalations[0];
    expect(discovered.open).toBe(true);
    expect(discovered.blocking).toBe(true);
    expect(discovered.latestPacket?.packetRevision).toBe(2);
    expect(discovered.latestPacket?.postCommentRefs).toEqual([]);
  });

  it("cross-checks live markers: latest revision, fingerprint match, observed vs unobserved results", async () => {
    const { mailbox, rendered } = await preparedMailboxWithPostedPacket();
    const result = await buildResultEnvelope({
      resultId: "res-adjudication-1",
      sourceEscalationId: "esc-mailbox-1",
      sourcePacketId: "esc-mailbox-1/packet/r1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Adjudication returned.",
      recommendedNextAction: "Continue the same operation."
    });
    const live = [
      { commentRef: "futouyiba/noos-shuttle#10/comment/100", author: "impl-agent", updatedAt: "2026-09-16T00:00:00Z", body: rendered.body },
      markerComment("futouyiba/noos-shuttle#10/comment/101", result, "2026-09-16T01:00:00Z")
    ];
    const beforeObservation = await mailbox.discover(live);
    expect(beforeObservation.escalations[0].packetFingerprintMatchesLive).toBe(true);
    expect(beforeObservation.escalations[0].liveResultMarkers[0]).toMatchObject({ resultId: "res-adjudication-1", observed: false });
    await mailbox.observeComments(live);
    const afterObservation = await mailbox.discover(live);
    expect(afterObservation.escalations[0].liveResultMarkers[0].observed).toBe(true);
    expect(afterObservation.escalations[0].observedResults[0].resultId).toBe("res-adjudication-1");
  });

  it("verifies live packet CONTENT, not just the claimed fingerprint field", async () => {
    const { mailbox, rendered, packet } = await preparedMailboxWithPostedPacket();
    const comment = (body: string) => ({
      commentRef: "futouyiba/noos-shuttle#10/comment/100",
      author: "impl-agent",
      updatedAt: "2026-09-16T00:00:00Z",
      body
    });
    // Untampered: content matches ledger and the claim is self-consistent.
    const honest = await mailbox.discover([comment(rendered.body)]);
    expect(honest.escalations[0].packetFingerprintMatchesLive).toBe(true);
    expect(honest.escalations[0].livePacketClaimIntegrity).toBe(true);
    // Content edited while the claimed fingerprint string is left untouched:
    // recomputed content fingerprint no longer matches the ledger.
    const editedGoal = rendered.body.replace("Close the delivery-vs-reducer interpretation conflict.", "TAMPERED goal");
    const contentTampered = await mailbox.discover([comment(editedGoal)]);
    expect(contentTampered.escalations[0].packetFingerprintMatchesLive).toBe(false);
    expect(contentTampered.escalations[0].livePacketClaimIntegrity).toBe(false);
    // Only the claimed fingerprint string is replaced: content still matches
    // the ledger, but the marker's own claim is inconsistent.
    const claimedTampered = rendered.body.replace(packet.packetFingerprint, "sha256:" + "c".repeat(64));
    const claimTampered = await mailbox.discover([comment(claimedTampered)]);
    expect(claimTampered.escalations[0].packetFingerprintMatchesLive).toBe(true);
    expect(claimTampered.escalations[0].livePacketClaimIntegrity).toBe(false);
  });

  it("surfaces foreign ESCALATION_RESULT markers targeting unknown escalations", async () => {
    const { mailbox, rendered } = await preparedMailboxWithPostedPacket();
    const foreignResult = await buildResultEnvelope({
      resultId: "res-foreign-1",
      sourceEscalationId: "esc-not-in-ledger",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Answered an escalation this ledger does not know.",
      recommendedNextAction: "Route manually."
    });
    const report = await mailbox.discover([
      { commentRef: "futouyiba/noos-shuttle#10/comment/100", author: "impl-agent", updatedAt: "2026-09-16T00:00:00Z", body: rendered.body },
      markerComment("futouyiba/noos-shuttle#10/comment/120", foreignResult, "2026-09-16T03:00:00Z")
    ]);
    expect(report.foreignEscalations).toHaveLength(1);
    expect(report.foreignEscalations[0]).toMatchObject({ escalationId: "esc-not-in-ledger", resultId: "res-foreign-1" });
  });

  it("surfaces foreign escalations, malformed markers, and pending conflicts", async () => {
    const { mailbox, rendered } = await preparedMailboxWithPostedPacket();
    const foreign = rendered.body.replaceAll("esc-mailbox-1", "esc-foreign-9");
    const malformed = "```noos-mailbox\n{broken\n```";
    const original = await buildResultEnvelope({
      resultId: "res-edit-1",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Original.",
      recommendedNextAction: "Continue."
    });
    const edited = await buildResultEnvelope({
      resultId: "res-edit-1",
      sourceEscalationId: "esc-mailbox-1",
      sourceRole: "PRIMARY_DESIGN",
      authorityRole: "PRIMARY_DESIGN",
      completionStatus: "COMPLETE",
      summary: "Edited.",
      recommendedNextAction: "Continue."
    });
    await mailbox.observeComments([markerComment("futouyiba/noos-shuttle#10/comment/111", original)]);
    await mailbox.observeComments([markerComment("futouyiba/noos-shuttle#10/comment/111", edited, "2026-09-16T02:00:00Z")]);
    const report = await mailbox.discover([
      { commentRef: "futouyiba/noos-shuttle#10/comment/100", author: "impl-agent", updatedAt: "2026-09-16T00:00:00Z", body: rendered.body },
      { commentRef: "futouyiba/noos-shuttle#10/comment/105", author: "other-agent", updatedAt: "2026-09-16T00:00:00Z", body: foreign },
      { commentRef: "futouyiba/noos-shuttle#10/comment/106", author: "anyone", updatedAt: "2026-09-16T00:00:00Z", body: malformed }
    ]);
    expect(report.foreignEscalations).toHaveLength(1);
    expect(report.foreignEscalations[0].escalationId).toBe("esc-foreign-9");
    expect(report.malformedMarkers).toHaveLength(1);
    expect(report.malformedMarkers[0].reason).toBe("not_json");
    expect(report.pendingConflicts).toHaveLength(1);
    expect(report.escalations[0].conflictIds).toEqual([report.pendingConflicts[0].conflictId]);
  });

  it("derives the same report from durable state after a restart", async () => {
    const { mailbox, store, rendered } = await preparedMailboxWithPostedPacket();
    const reportBefore = await mailbox.discover([
      { commentRef: "futouyiba/noos-shuttle#10/comment/100", author: "impl-agent", updatedAt: "2026-09-16T00:00:00Z", body: rendered.body }
    ]);
    const restarted = new CrossAgentMailbox(store);
    const reportAfter = await restarted.discover([
      { commentRef: "futouyiba/noos-shuttle#10/comment/100", author: "impl-agent", updatedAt: "2026-09-16T00:00:00Z", body: rendered.body }
    ]);
    expect(reportAfter).toEqual(reportBefore);
  });
});

describe("short launch instructions", () => {
  it("compile destination and resume instructions from durable refs only", () => {
    const instructions = compileLaunchInstructions({
      workItemRef: "futouyiba/noos-shuttle#10",
      escalationId: "esc-mailbox-1",
      packetCommentRef: "futouyiba/noos-shuttle#10/comment/100",
      latestPacket: { packetId: "esc-mailbox-1/packet/r1", packetRevision: 1 },
      latestResult: { resultId: "res-adjudication-1", commentRef: "futouyiba/noos-shuttle#10/comment/101" }
    });
    expect(instructions.destinationInstruction).toContain("esc-mailbox-1/packet/r1");
    expect(instructions.destinationInstruction).toContain("futouyiba/noos-shuttle#10/comment/100");
    expect(instructions.resumeInstruction).toContain("res-adjudication-1");
    expect(instructions.resumeInstruction).toContain("futouyiba/noos-shuttle#10/comment/101");
    expect(instructions.resumeInstruction).toContain("SAME source operation");
    expect(instructions.resumeInstruction).toContain("never auto-resumes");
    expect(instructions.resumeInstruction).not.toMatch(/sufficien/i);
  });

  it("states that no result has been observed when none exists", () => {
    const instructions = compileLaunchInstructions({
      workItemRef: "futouyiba/noos-shuttle#10",
      escalationId: "esc-mailbox-1"
    });
    expect(instructions.resumeInstruction).toContain("No adjudication result has been observed");
  });
});

describe("error surface", () => {
  it("exposes typed errors with stable codes", async () => {
    const mailbox = new CrossAgentMailbox(new InMemoryMailboxStore());
    await expect(mailbox.compilePacket(packetInput("esc-missing"))).rejects.toBeInstanceOf(MailboxInvariantError);
    await expect(mailbox.compilePacket(packetInput("esc-missing"))).rejects.toMatchObject({ code: "escalation_not_found" });
    expect(new MailboxConflictError("x", "y").name).toBe("MailboxConflictError");
  });
});
