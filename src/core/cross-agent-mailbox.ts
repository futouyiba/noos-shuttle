/**
 * Cross-agent GitHub mailbox — Issue #10 prototype (restricted mailbox/provenance scope).
 *
 * Implements the GitHub-transport durability semantics of the Cross-Agent
 * Handoff / Escalation Contract v3 §15/§19: persisted Escalation identity
 * before post, immutable HandoffPacket identity/revision/fingerprint, marker
 * discovery, create-or-get, immutable comment observation capture, and result
 * dedup/provenance.
 *
 * Deliberately out of scope (contract §19: #11/#12 automatic resume blocked):
 * resolution/withdrawal lifecycle, ResolutionRequirementTemplates, resolution
 * policy, and any automatic resume trigger. Every escalation in this ledger is
 * HUMAN_MEDIATED and OPEN; resume stays Human-mediated.
 *
 * Marker envelopes MUST NOT carry `result_kind` or any destination-authored
 * sufficiency field (contract §3.6/§18). Rendering builds envelopes only from
 * validated records, and parsing rejects any marker containing a forbidden
 * field before it can be imported as a result observation.
 *
 * The module is self-contained and uses erasable TypeScript syntax only so the
 * `scripts/noos-mailbox.mjs` CLI can import it directly under Node's native
 * type stripping.
 */

export const MAILBOX_ENVELOPE_VERSION = 1;
export const MAILBOX_FENCE = "noos-mailbox";

export type MailboxEscalationKind = "NEEDS_DESIGN" | "NEEDS_EVIDENCE" | "NEEDS_HUMAN";
export type MailboxCompletionStatus = "COMPLETE" | "PARTIAL" | "BLOCKED" | "FAILED_SAFE";
export type MailboxMarkerKind = "ESCALATION_PACKET" | "ESCALATION_RESULT";

export const MAILBOX_ESCALATION_KINDS: readonly MailboxEscalationKind[] = [
  "NEEDS_DESIGN",
  "NEEDS_EVIDENCE",
  "NEEDS_HUMAN"
];
export const MAILBOX_COMPLETION_STATUSES: readonly MailboxCompletionStatus[] = [
  "COMPLETE",
  "PARTIAL",
  "BLOCKED",
  "FAILED_SAFE"
];

export class MailboxInvariantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MailboxInvariantError";
    this.code = code;
  }
}

export class MailboxConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MailboxConflictError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Fingerprints and forbidden envelope fields
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
}

async function fingerprint(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(canonicalize(value)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const FORBIDDEN_ENVELOPE_KEYS = new Set(["result_kind"]);

function isForbiddenEnvelopeKey(key: string): boolean {
  return FORBIDDEN_ENVELOPE_KEYS.has(key) || key.toLowerCase().includes("sufficien");
}

/** Returns dotted paths of every forbidden key (contract §3.6/§18) in the value. */
export function findForbiddenEnvelopeFields(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenEnvelopeFields(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key;
      return isForbiddenEnvelopeKey(key) ? [childPath] : findForbiddenEnvelopeFields(child, childPath);
    });
  }
  return [];
}

// ---------------------------------------------------------------------------
// Provenance and escalation records
// ---------------------------------------------------------------------------

export interface MailboxProvenance {
  readonly repository: string;
  readonly issueRef?: string;
  readonly pullRequestRef?: string;
  readonly pullRequestHeadSha?: string;
  readonly commitSha?: string;
  readonly pathRefs: readonly string[];
  readonly blobRefs: readonly string[];
}

const SHA_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function nonEmpty(value: string | undefined, code: string, message: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new MailboxInvariantError(code, message);
  }
  return normalized;
}

function normalizeIssueLikeRef(value: string, provenanceRepository: string, field: string): string {
  const normalized = value.trim();
  const full = normalized.startsWith("#")
    ? `${provenanceRepository}${normalized}`
    : normalized;
  if (!new RegExp(`^[\\w.-]+\\/[\\w.-]+#\\d+$`).test(full)) {
    throw new MailboxInvariantError(
      "invalid_ref_format",
      `${field} must be "owner/name#number" (or "#number" for the provenance repository): ${value}`
    );
  }
  return full;
}

function requireSha(value: string, field: string): string {
  const normalized = value.trim();
  if (!SHA_RE.test(normalized)) {
    throw new MailboxInvariantError("invalid_sha", `${field} must be a full 40-hex SHA: ${value}`);
  }
  return normalized.toLowerCase();
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function validateProvenance(input: MailboxProvenance): MailboxProvenance {
  const repository = nonEmpty(input.repository, "repository_required", "provenance.repository is required.");
  if (!REPO_RE.test(repository)) {
    throw new MailboxInvariantError("invalid_repository", `provenance.repository must be "owner/name": ${repository}`);
  }
  const provenance: MailboxProvenance = {
    repository,
    issueRef: input.issueRef ? normalizeIssueLikeRef(input.issueRef, repository, "provenance.issueRef") : undefined,
    pullRequestRef: input.pullRequestRef
      ? normalizeIssueLikeRef(input.pullRequestRef, repository, "provenance.pullRequestRef")
      : undefined,
    pullRequestHeadSha: input.pullRequestHeadSha ? requireSha(input.pullRequestHeadSha, "provenance.pullRequestHeadSha") : undefined,
    commitSha: input.commitSha ? requireSha(input.commitSha, "provenance.commitSha") : undefined,
    pathRefs: normalizeList(input.pathRefs),
    blobRefs: normalizeList(input.blobRefs)
  };
  for (const pathRef of provenance.pathRefs) {
    const at = pathRef.lastIndexOf("@");
    if (at >= 0 && !SHA_RE.test(pathRef.slice(at + 1))) {
      throw new MailboxInvariantError("invalid_path_ref", `provenance.pathRefs entries must be "path" or "path@<40-hex sha>": ${pathRef}`);
    }
  }
  if (!provenance.commitSha && !provenance.pullRequestHeadSha && provenance.blobRefs.length === 0) {
    throw new MailboxInvariantError(
      "exact_revision_required",
      "provenance must pin at least one exact revision (commitSha, pullRequestHeadSha, or blobRefs)."
    );
  }
  return provenance;
}

export interface OpenMailboxEscalationInput {
  escalationId?: string;
  workItemRef: string;
  sourceOperationRef: string;
  sourceRole: string;
  destinationRole: string;
  kind: MailboxEscalationKind;
  resolutionMode?: "HUMAN_MEDIATED" | "AUTOMATIC_TEMPLATE_BOUND";
  blockerSummary: string;
  question: string;
  authorityBasisRef: string;
  authorityRefs?: readonly string[];
  evidenceRefs?: readonly string[];
  provenance: MailboxProvenance;
  now?: string;
}

export interface MailboxEscalation {
  readonly escalationId: string;
  readonly workItemRef: string;
  readonly sourceOperationRef: string;
  readonly sourceRole: string;
  readonly destinationRole: string;
  readonly kind: MailboxEscalationKind;
  readonly resolutionMode: "HUMAN_MEDIATED";
  readonly blockerSummary: string;
  readonly question: string;
  readonly authorityBasisRef: string;
  readonly authorityRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly provenance: MailboxProvenance;
  readonly escalationFingerprint: string;
  readonly status: "OPEN";
  readonly createdAt: string;
}

async function escalationSemanticFingerprint(input: {
  escalationId: string;
  workItemRef: string;
  sourceOperationRef: string;
  sourceRole: string;
  destinationRole: string;
  kind: MailboxEscalationKind;
  resolutionMode: "HUMAN_MEDIATED";
  blockerSummary: string;
  question: string;
  authorityBasisRef: string;
  authorityRefs: readonly string[];
  evidenceRefs: readonly string[];
  provenance: MailboxProvenance;
}): Promise<string> {
  return fingerprint(input);
}

// ---------------------------------------------------------------------------
// Handoff packet records
// ---------------------------------------------------------------------------

export interface CompileMailboxPacketInput {
  escalationId: string;
  reason: string;
  goal: string;
  scope: string;
  nonGoals?: readonly string[];
  exactAuthorityRefs?: readonly string[];
  implementationArtifactRefs?: readonly string[];
  evidenceRefs?: readonly string[];
  boundedContextRefs?: readonly string[];
  preciseQuestions?: readonly string[];
  expectedReturnContract: string;
  stopCondition: string;
  now?: string;
}

export interface MailboxHandoffPacket {
  readonly packetId: string;
  readonly packetRevision: number;
  readonly supersedesPacketId?: string;
  readonly escalationId: string;
  readonly reason: string;
  readonly goal: string;
  readonly scope: string;
  readonly nonGoals: readonly string[];
  readonly exactAuthorityRefs: readonly string[];
  readonly implementationArtifactRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly boundedContextRefs: readonly string[];
  readonly preciseQuestions: readonly string[];
  readonly expectedReturnContract: string;
  readonly stopCondition: string;
  readonly packetFingerprint: string;
  readonly compiledAt: string;
}

// ---------------------------------------------------------------------------
// Wire envelopes (snake_case transport format inside the fenced marker)
// ---------------------------------------------------------------------------

export interface WireProvenance {
  repository: string;
  issue_ref?: string;
  pull_request_ref?: string;
  pull_request_head_sha?: string;
  commit_sha?: string;
  path_refs: string[];
  blob_refs: string[];
}

export interface PacketEnvelopeWire {
  noos_mailbox: number;
  marker_kind: "ESCALATION_PACKET";
  escalation: {
    escalation_id: string;
    escalation_fingerprint: string;
    kind: MailboxEscalationKind;
    resolution_mode: "HUMAN_MEDIATED";
    status: "OPEN";
    work_item_ref: string;
    source_operation_ref: string;
    source_role: string;
    destination_role: string;
    blocker_summary: string;
    question: string;
    authority_basis_ref: string;
    authority_refs: string[];
    evidence_refs: string[];
    provenance: WireProvenance;
  };
  packet: {
    packet_id: string;
    packet_revision: number;
    packet_fingerprint: string;
    supersedes_packet_id: string | null;
    reason: string;
    goal: string;
    scope: string;
    non_goals: string[];
    exact_authority_refs: string[];
    implementation_artifact_refs: string[];
    evidence_refs: string[];
    bounded_context_refs: string[];
    precise_questions: string[];
    expected_return_contract: string;
    stop_condition: string;
  };
}

export interface ResultEnvelopeWire {
  noos_mailbox: number;
  marker_kind: "ESCALATION_RESULT";
  result: {
    result_id: string;
    result_fingerprint: string;
    source_escalation_id: string;
    source_packet_id: string | null;
    source_role: string;
    authority_role: string;
    completion_status: MailboxCompletionStatus;
    summary: string;
    artifact_refs: string[];
    authority_refs: string[];
    evidence_refs: string[];
    unresolved_questions: string[];
    recommended_next_action: string;
  };
}

export type MailboxEnvelopeWire = PacketEnvelopeWire | ResultEnvelopeWire;

export interface RenderedEnvelope {
  body: string;
  envelope: MailboxEnvelopeWire;
  envelopeFingerprint: string;
}

export type EnvelopeParseFailure =
  | { ok: false; reason: "not_json" | "unknown_version" | "unknown_marker_kind" | "invalid_shape"; detail: string }
  | { ok: false; reason: "forbidden_field"; detail: string; forbiddenPaths: string[] };

export type EnvelopeParseResult =
  | { ok: true; envelope: MailboxEnvelopeWire; envelopeFingerprint: string }
  | EnvelopeParseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new MailboxInvariantError("invalid_shape", `Field "${key}" must be a non-empty string.`);
  }
  return value;
}

function requireStringList(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new MailboxInvariantError("invalid_shape", `Field "${key}" must be an array of strings.`);
  }
  return value.map((item) => String(item));
}

/** Parses and validates one marker envelope JSON. Forbidden fields reject the marker. */
export async function parseEnvelopeJson(json: string): Promise<EnvelopeParseResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, reason: "not_json", detail: `Marker block is not valid JSON: ${String(error)}` };
  }
  const forbiddenPaths = findForbiddenEnvelopeFields(parsed);
  if (forbiddenPaths.length > 0) {
    return {
      ok: false,
      reason: "forbidden_field",
      detail: "Marker envelope carries a forbidden field (result_kind / sufficiency).",
      forbiddenPaths
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "invalid_shape", detail: "Marker envelope must be a JSON object." };
  }
  if (parsed.noos_mailbox !== MAILBOX_ENVELOPE_VERSION) {
    return {
      ok: false,
      reason: "unknown_version",
      detail: `Unsupported noos_mailbox version: ${String(parsed.noos_mailbox)}`
    };
  }
  const markerKind = parsed.marker_kind;
  try {
    if (markerKind === "ESCALATION_PACKET") {
      const escalation = parsed.escalation;
      const packet = parsed.packet;
      if (!isRecord(escalation) || !isRecord(packet)) {
        throw new MailboxInvariantError("invalid_shape", "Packet marker requires 'escalation' and 'packet' objects.");
      }
      const kind = requireString(escalation, "kind");
      if (!MAILBOX_ESCALATION_KINDS.includes(kind as MailboxEscalationKind)) {
        throw new MailboxInvariantError("invalid_shape", `Unknown escalation kind: ${kind}`);
      }
      const packetRevision = packet.packet_revision;
      if (typeof packetRevision !== "number" || !Number.isInteger(packetRevision) || packetRevision < 1) {
        throw new MailboxInvariantError("invalid_shape", "packet.packet_revision must be an integer >= 1.");
      }
      const supersedes = packet.supersedes_packet_id;
      if (supersedes !== null && supersedes !== undefined && typeof supersedes !== "string") {
        throw new MailboxInvariantError("invalid_shape", "packet.supersedes_packet_id must be a string or null.");
      }
      const provenance = escalation.provenance;
      if (!isRecord(provenance)) {
        throw new MailboxInvariantError("invalid_shape", "escalation.provenance must be an object.");
      }
      requireString(provenance, "repository");
      const envelope: PacketEnvelopeWire = {
        noos_mailbox: MAILBOX_ENVELOPE_VERSION,
        marker_kind: "ESCALATION_PACKET",
        escalation: {
          escalation_id: requireString(escalation, "escalation_id"),
          escalation_fingerprint: requireString(escalation, "escalation_fingerprint"),
          kind: kind as MailboxEscalationKind,
          resolution_mode: "HUMAN_MEDIATED",
          status: "OPEN",
          work_item_ref: requireString(escalation, "work_item_ref"),
          source_operation_ref: requireString(escalation, "source_operation_ref"),
          source_role: requireString(escalation, "source_role"),
          destination_role: requireString(escalation, "destination_role"),
          blocker_summary: requireString(escalation, "blocker_summary"),
          question: requireString(escalation, "question"),
          authority_basis_ref: requireString(escalation, "authority_basis_ref"),
          authority_refs: requireStringList(escalation, "authority_refs"),
          evidence_refs: requireStringList(escalation, "evidence_refs"),
          provenance: {
            repository: requireString(provenance, "repository"),
            issue_ref: typeof provenance.issue_ref === "string" ? provenance.issue_ref : undefined,
            pull_request_ref: typeof provenance.pull_request_ref === "string" ? provenance.pull_request_ref : undefined,
            pull_request_head_sha:
              typeof provenance.pull_request_head_sha === "string" ? provenance.pull_request_head_sha : undefined,
            commit_sha: typeof provenance.commit_sha === "string" ? provenance.commit_sha : undefined,
            path_refs: requireStringList(provenance, "path_refs"),
            blob_refs: requireStringList(provenance, "blob_refs")
          }
        },
        packet: {
          packet_id: requireString(packet, "packet_id"),
          packet_revision: packetRevision,
          packet_fingerprint: requireString(packet, "packet_fingerprint"),
          supersedes_packet_id: supersedes ?? null,
          reason: requireString(packet, "reason"),
          goal: requireString(packet, "goal"),
          scope: requireString(packet, "scope"),
          non_goals: requireStringList(packet, "non_goals"),
          exact_authority_refs: requireStringList(packet, "exact_authority_refs"),
          implementation_artifact_refs: requireStringList(packet, "implementation_artifact_refs"),
          evidence_refs: requireStringList(packet, "evidence_refs"),
          bounded_context_refs: requireStringList(packet, "bounded_context_refs"),
          precise_questions: requireStringList(packet, "precise_questions"),
          expected_return_contract: requireString(packet, "expected_return_contract"),
          stop_condition: requireString(packet, "stop_condition")
        }
      };
      return { ok: true, envelope, envelopeFingerprint: await fingerprint(envelope) };
    }
    if (markerKind === "ESCALATION_RESULT") {
      const result = parsed.result;
      if (!isRecord(result)) {
        throw new MailboxInvariantError("invalid_shape", "Result marker requires a 'result' object.");
      }
      const completionStatus = requireString(result, "completion_status");
      if (!MAILBOX_COMPLETION_STATUSES.includes(completionStatus as MailboxCompletionStatus)) {
        throw new MailboxInvariantError("invalid_shape", `Unknown completion_status: ${completionStatus}`);
      }
      const sourcePacketId = result.source_packet_id;
      if (sourcePacketId !== null && sourcePacketId !== undefined && typeof sourcePacketId !== "string") {
        throw new MailboxInvariantError("invalid_shape", "result.source_packet_id must be a string or null.");
      }
      const envelope: ResultEnvelopeWire = {
        noos_mailbox: MAILBOX_ENVELOPE_VERSION,
        marker_kind: "ESCALATION_RESULT",
        result: {
          result_id: requireString(result, "result_id"),
          result_fingerprint: requireString(result, "result_fingerprint"),
          source_escalation_id: requireString(result, "source_escalation_id"),
          source_packet_id: sourcePacketId ?? null,
          source_role: requireString(result, "source_role"),
          authority_role: requireString(result, "authority_role"),
          completion_status: completionStatus as MailboxCompletionStatus,
          summary: requireString(result, "summary"),
          artifact_refs: requireStringList(result, "artifact_refs"),
          authority_refs: requireStringList(result, "authority_refs"),
          evidence_refs: requireStringList(result, "evidence_refs"),
          unresolved_questions: requireStringList(result, "unresolved_questions"),
          recommended_next_action: requireString(result, "recommended_next_action")
        }
      };
      return { ok: true, envelope, envelopeFingerprint: await fingerprint(envelope) };
    }
    return { ok: false, reason: "unknown_marker_kind", detail: `Unknown marker_kind: ${String(markerKind)}` };
  } catch (error) {
    if (error instanceof MailboxInvariantError && error.code === "invalid_shape") {
      return { ok: false, reason: "invalid_shape", detail: error.message };
    }
    throw error;
  }
}

const FENCE_RE = /```noos-mailbox[^\S\n]*\n([\s\S]*?)```/g;

/** Extracts raw fenced marker blocks from a comment body. */
export function extractMarkerBlocks(body: string): string[] {
  const blocks: string[] = [];
  for (const match of body.matchAll(FENCE_RE)) {
    blocks.push(match[1]);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Ledger state, posts, and observations
// ---------------------------------------------------------------------------

export interface MarkerPost {
  readonly postId: string;
  readonly markerKind: MailboxMarkerKind;
  readonly packetId?: string;
  readonly resultId?: string;
  readonly commentRef: string;
  readonly envelopeFingerprint: string;
  readonly postedAt: string;
}

export type MailboxMarkerStatus =
  | "VALID_PACKET"
  | "VALID_RESULT"
  | "MALFORMED"
  | "FORBIDDEN_FIELD";

export interface CommentObservation {
  readonly commentObservationId: string;
  readonly commentRef: string;
  readonly author: string;
  readonly observedAt: string;
  readonly commentUpdatedAt: string;
  readonly contentFingerprint: string;
  readonly markerStatus: MailboxMarkerStatus;
  readonly detail?: string;
  readonly parsedEscalationId?: string;
  readonly parsedPacketId?: string;
  readonly parsedResultId?: string;
  readonly parsedResultFingerprint?: string;
  readonly editedAfterObservation: boolean;
}

export interface ResultObservation {
  readonly resultObservationId: string;
  readonly resultId: string;
  readonly resultFingerprint: string;
  readonly escalationId: string;
  readonly authorityRole: string;
  readonly commentObservationId: string;
  readonly firstObservedAt: string;
}

export interface ResultFingerprintConflict {
  readonly conflictId: string;
  readonly escalationId: string;
  readonly resultId: string;
  readonly recordedFingerprint: string;
  readonly observedFingerprint: string;
  readonly commentObservationId: string;
  readonly recordedAt: string;
  readonly status: "PENDING_TRIAGE";
}

export interface CrossAgentMailboxState {
  revision: number;
  scopeRef?: string;
  escalations: MailboxEscalation[];
  packets: MailboxHandoffPacket[];
  posts: MarkerPost[];
  commentObservations: CommentObservation[];
  resultObservations: ResultObservation[];
  resultFingerprintConflicts: ResultFingerprintConflict[];
}

export interface AtomicMailboxStore {
  read(): Promise<CrossAgentMailboxState | undefined>;
  compareAndSet(expectedRevision: number, next: CrossAgentMailboxState): Promise<boolean>;
}

export function emptyMailboxState(): CrossAgentMailboxState {
  return {
    revision: 0,
    escalations: [],
    packets: [],
    posts: [],
    commentObservations: [],
    resultObservations: [],
    resultFingerprintConflicts: []
  };
}

function normalizeState(value: CrossAgentMailboxState | undefined): CrossAgentMailboxState {
  const state = value ?? emptyMailboxState();
  return {
    ...emptyMailboxState(),
    ...state,
    escalations: state.escalations ?? [],
    packets: state.packets ?? [],
    posts: state.posts ?? [],
    commentObservations: state.commentObservations ?? [],
    resultObservations: state.resultObservations ?? [],
    resultFingerprintConflicts: state.resultFingerprintConflicts ?? []
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function newId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

const MAX_COMMIT_RETRIES = 8;

export class InMemoryMailboxStore implements AtomicMailboxStore {
  private state: CrossAgentMailboxState;
  private queue: Promise<void> = Promise.resolve();

  constructor(initial?: CrossAgentMailboxState) {
    this.state = clone(initial ?? emptyMailboxState());
  }

  async read(): Promise<CrossAgentMailboxState> {
    return clone(this.state);
  }

  async compareAndSet(expectedRevision: number, next: CrossAgentMailboxState): Promise<boolean> {
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

// ---------------------------------------------------------------------------
// Live comment parsing (shared by observe and discover)
// ---------------------------------------------------------------------------

export interface RawMailboxComment {
  commentRef: string;
  author: string;
  updatedAt: string;
  body: string;
}

export type ParsedCommentMarker =
  | {
      readonly commentRef: string;
      readonly ok: true;
      readonly envelope: MailboxEnvelopeWire;
      readonly envelopeFingerprint: string;
    }
  | {
      readonly commentRef: string;
      readonly ok: false;
      readonly failure: EnvelopeParseFailure;
    };

export interface ParsedCommentMarkers {
  readonly commentRef: string;
  readonly markers: ParsedCommentMarker[];
}

export async function parseCommentMarkers(comment: RawMailboxComment): Promise<ParsedCommentMarkers> {
  const markers: ParsedCommentMarker[] = [];
  for (const block of extractMarkerBlocks(comment.body)) {
    const parsed = await parseEnvelopeJson(block);
    markers.push(
      parsed.ok
        ? { commentRef: comment.commentRef, ok: true, envelope: parsed.envelope, envelopeFingerprint: parsed.envelopeFingerprint }
        : { commentRef: comment.commentRef, ok: false, failure: parsed }
    );
  }
  return { commentRef: comment.commentRef, markers };
}

// ---------------------------------------------------------------------------
// Mailbox facade
// ---------------------------------------------------------------------------

export interface RecordPostInput {
  markerKind: MailboxMarkerKind;
  packetId?: string;
  resultId?: string;
  commentRef: string;
  envelopeFingerprint: string;
  now?: string;
}

export interface ObserveCommentsOutcome {
  readonly commentObservations: readonly CommentObservation[];
  readonly resultObservations: readonly ResultObservation[];
  readonly resultFingerprintConflicts: readonly ResultFingerprintConflict[];
  readonly skippedAlreadyObserved: readonly string[];
}

function packetIdFor(escalationId: string, revision: number): string {
  return `${escalationId}/packet/r${revision}`;
}

/**
 * Recomputes the packet content fingerprint from a parsed live marker using
 * the same semantic field set as compilePacket, so discovery verifies live
 * CONTENT rather than trusting the marker's claimed fingerprint field.
 */
async function packetContentFingerprintFromWire(
  escalationId: string,
  packet: PacketEnvelopeWire["packet"]
): Promise<string> {
  return fingerprint({
    escalationId,
    reason: packet.reason,
    goal: packet.goal,
    scope: packet.scope,
    nonGoals: packet.non_goals,
    exactAuthorityRefs: packet.exact_authority_refs,
    implementationArtifactRefs: packet.implementation_artifact_refs,
    evidenceRefs: packet.evidence_refs,
    boundedContextRefs: packet.bounded_context_refs,
    preciseQuestions: packet.precise_questions,
    expectedReturnContract: packet.expected_return_contract,
    stopCondition: packet.stop_condition
  });
}

export class CrossAgentMailbox {
  private readonly store: AtomicMailboxStore;
  private readonly clock: () => string;

  constructor(store: AtomicMailboxStore, clock: () => string = () => new Date().toISOString()) {
    this.store = store;
    this.clock = clock;
  }

  async snapshot(): Promise<CrossAgentMailboxState> {
    return clone(normalizeState(await this.store.read()));
  }

  /**
   * Persists the Escalation identity before any transport (contract §15).
   * Create-or-get: same id + same fingerprint returns the existing record;
   * same id + different fingerprint is an invariant conflict.
   */
  async openEscalation(input: OpenMailboxEscalationInput): Promise<MailboxEscalation> {
    if (input.resolutionMode === "AUTOMATIC_TEMPLATE_BOUND") {
      throw new MailboxInvariantError(
        "automatic_mode_unavailable",
        "Automatic template-bound resolution is not implemented (contract §19: #11/#12 blocked); mailbox escalations are HUMAN_MEDIATED."
      );
    }
    const kind = input.kind;
    if (!MAILBOX_ESCALATION_KINDS.includes(kind)) {
      throw new MailboxInvariantError("invalid_kind", `Unknown escalation kind: ${String(kind)}`);
    }
    const escalationId = input.escalationId?.trim() || `esc-${newId("escalation")}`;
    const workItemRef = nonEmpty(input.workItemRef, "work_item_ref_required", "workItemRef is required.");
    const semantic = {
      escalationId,
      workItemRef,
      sourceOperationRef: nonEmpty(input.sourceOperationRef, "source_operation_ref_required", "sourceOperationRef is required."),
      sourceRole: nonEmpty(input.sourceRole, "source_role_required", "sourceRole is required."),
      destinationRole: nonEmpty(input.destinationRole, "destination_role_required", "destinationRole is required."),
      kind,
      resolutionMode: "HUMAN_MEDIATED" as const,
      blockerSummary: nonEmpty(input.blockerSummary, "blocker_summary_required", "blockerSummary is required."),
      question: nonEmpty(input.question, "question_required", "question is required."),
      authorityBasisRef: nonEmpty(input.authorityBasisRef, "authority_basis_ref_required", "authorityBasisRef is required."),
      authorityRefs: normalizeList(input.authorityRefs),
      evidenceRefs: normalizeList(input.evidenceRefs),
      provenance: validateProvenance(input.provenance)
    };
    const escalationFingerprint = await escalationSemanticFingerprint(semantic);

    return this.commit(async (state) => {
      if (state.scopeRef && state.scopeRef !== workItemRef) {
        throw new MailboxInvariantError(
          "scope_mismatch",
          `This ledger tracks ${state.scopeRef}; ${workItemRef} belongs in another ledger.`
        );
      }
      const existing = state.escalations.find((item) => item.escalationId === escalationId);
      if (existing) {
        if (existing.escalationFingerprint !== escalationFingerprint) {
          throw new MailboxConflictError(
            "escalation_fingerprint_mismatch",
            `Escalation ${escalationId} already exists with different semantic content.`
          );
        }
        return { next: state, result: clone(existing) };
      }
      const escalation: MailboxEscalation = {
        ...semantic,
        escalationFingerprint,
        status: "OPEN",
        createdAt: input.now ?? this.clock()
      };
      return {
        next: { ...state, scopeRef: state.scopeRef ?? workItemRef, escalations: [...state.escalations, escalation] },
        result: clone(escalation)
      };
    });
  }

  /**
   * Compiles and persists an immutable HandoffPacket projection. The packet
   * fingerprint covers semantic content only (not revision identity), so
   * re-compiling identical content — e.g. recovering a lost post
   * acknowledgement — create-or-gets the latest packet instead of minting a
   * new revision; changed content mints the next revision with
   * supersedesPacketId preserving lineage. Packet ids are deterministic per
   * (escalation, revision), so transport always reuses the same identity.
   */
  async compilePacket(input: CompileMailboxPacketInput): Promise<MailboxHandoffPacket> {
    const escalationId = nonEmpty(input.escalationId, "escalation_id_required", "escalationId is required.");
    return this.commit(async (state) => {
      const escalation = state.escalations.find((item) => item.escalationId === escalationId);
      if (!escalation) {
        throw new MailboxInvariantError("escalation_not_found", `Escalation ${escalationId} does not exist in this ledger.`);
      }
      const priorPackets = state.packets
        .filter((packet) => packet.escalationId === escalationId)
        .sort((a, b) => a.packetRevision - b.packetRevision);
      const latest = priorPackets[priorPackets.length - 1];
      const semantic = {
        escalationId,
        reason: nonEmpty(input.reason, "packet_reason_required", "Packet reason is required."),
        goal: nonEmpty(input.goal, "packet_goal_required", "Packet goal is required."),
        scope: nonEmpty(input.scope, "packet_scope_required", "Packet scope is required."),
        nonGoals: normalizeList(input.nonGoals),
        exactAuthorityRefs: normalizeList(input.exactAuthorityRefs ?? [escalation.authorityBasisRef, ...escalation.authorityRefs]),
        implementationArtifactRefs: normalizeList(input.implementationArtifactRefs),
        evidenceRefs: normalizeList(input.evidenceRefs ?? escalation.evidenceRefs),
        boundedContextRefs: normalizeList(input.boundedContextRefs),
        preciseQuestions: normalizeList(input.preciseQuestions ?? [escalation.question]),
        expectedReturnContract: nonEmpty(input.expectedReturnContract, "expected_return_contract_required", "expectedReturnContract is required."),
        stopCondition: nonEmpty(input.stopCondition, "stop_condition_required", "stopCondition is required.")
      };
      const packetFingerprint = await fingerprint(semantic);
      if (latest && latest.packetFingerprint === packetFingerprint) {
        return { next: state, result: clone(latest) };
      }
      const packetRevision = (latest?.packetRevision ?? 0) + 1;
      const packetId = packetIdFor(escalationId, packetRevision);
      const existing = state.packets.find((packet) => packet.packetId === packetId);
      if (existing) {
        if (existing.packetFingerprint !== packetFingerprint) {
          throw new MailboxConflictError(
            "packet_fingerprint_mismatch",
            `Packet ${packetId} already exists with different semantic content.`
          );
        }
        return { next: state, result: clone(existing) };
      }
      const packet: MailboxHandoffPacket = {
        ...semantic,
        packetId,
        packetRevision,
        supersedesPacketId: latest?.packetId,
        packetFingerprint,
        compiledAt: input.now ?? this.clock()
      };
      return { next: { ...state, packets: [...state.packets, packet] }, result: clone(packet) };
    });
  }

  /** Renders the durable comment body for a persisted packet. Deterministic from persisted content. */
  async renderPacketEnvelope(escalationId: string, packetId: string): Promise<RenderedEnvelope> {
    const state = await this.snapshot();
    const escalation = state.escalations.find((item) => item.escalationId === escalationId);
    if (!escalation) {
      throw new MailboxInvariantError("escalation_not_found", `Escalation ${escalationId} does not exist in this ledger.`);
    }
    const packet = state.packets.find((item) => item.packetId === packetId && item.escalationId === escalationId);
    if (!packet) {
      throw new MailboxInvariantError("packet_not_found", `Packet ${packetId} does not exist for escalation ${escalationId}.`);
    }
    const envelope: PacketEnvelopeWire = {
      noos_mailbox: MAILBOX_ENVELOPE_VERSION,
      marker_kind: "ESCALATION_PACKET",
      escalation: {
        escalation_id: escalation.escalationId,
        escalation_fingerprint: escalation.escalationFingerprint,
        kind: escalation.kind,
        resolution_mode: escalation.resolutionMode,
        status: escalation.status,
        work_item_ref: escalation.workItemRef,
        source_operation_ref: escalation.sourceOperationRef,
        source_role: escalation.sourceRole,
        destination_role: escalation.destinationRole,
        blocker_summary: escalation.blockerSummary,
        question: escalation.question,
        authority_basis_ref: escalation.authorityBasisRef,
        authority_refs: [...escalation.authorityRefs],
        evidence_refs: [...escalation.evidenceRefs],
        provenance: {
          repository: escalation.provenance.repository,
          issue_ref: escalation.provenance.issueRef,
          pull_request_ref: escalation.provenance.pullRequestRef,
          pull_request_head_sha: escalation.provenance.pullRequestHeadSha,
          commit_sha: escalation.provenance.commitSha,
          path_refs: [...escalation.provenance.pathRefs],
          blob_refs: [...escalation.provenance.blobRefs]
        }
      },
      packet: {
        packet_id: packet.packetId,
        packet_revision: packet.packetRevision,
        packet_fingerprint: packet.packetFingerprint,
        supersedes_packet_id: packet.supersedesPacketId ?? null,
        reason: packet.reason,
        goal: packet.goal,
        scope: packet.scope,
        non_goals: [...packet.nonGoals],
        exact_authority_refs: [...packet.exactAuthorityRefs],
        implementation_artifact_refs: [...packet.implementationArtifactRefs],
        evidence_refs: [...packet.evidenceRefs],
        bounded_context_refs: [...packet.boundedContextRefs],
        precise_questions: [...packet.preciseQuestions],
        expected_return_contract: packet.expectedReturnContract,
        stop_condition: packet.stopCondition
      }
    };
    return renderEnvelope(envelope);
  }

  /**
   * Records a durable marker post. Create-or-get by commentRef; a different
   * envelope fingerprint for an already-recorded comment ref or packet/result
   * identity is an invariant conflict (the durable marker diverged).
   */
  async recordPost(input: RecordPostInput): Promise<MarkerPost> {
    const commentRef = nonEmpty(input.commentRef, "comment_ref_required", "commentRef is required.");
    if (!input.envelopeFingerprint.startsWith("sha256:")) {
      throw new MailboxInvariantError("invalid_envelope_fingerprint", "envelopeFingerprint must be a sha256: fingerprint.");
    }
    if (input.markerKind === "ESCALATION_PACKET" && !input.packetId) {
      throw new MailboxInvariantError("packet_id_required", "ESCALATION_PACKET posts require packetId.");
    }
    if (input.markerKind === "ESCALATION_RESULT" && !input.resultId) {
      throw new MailboxInvariantError("result_id_required", "ESCALATION_RESULT posts require resultId.");
    }
    return this.commit(async (state) => {
      const byCommentRef = state.posts.find((post) => post.commentRef === commentRef);
      if (byCommentRef) {
        if (byCommentRef.envelopeFingerprint !== input.envelopeFingerprint) {
          throw new MailboxConflictError(
            "post_fingerprint_mismatch",
            `Comment ${commentRef} is already recorded with a different envelope fingerprint.`
          );
        }
        return { next: state, result: clone(byCommentRef) };
      }
      const identityKey = input.markerKind === "ESCALATION_PACKET" ? "packetId" : "resultId";
      const identityValue = input.packetId ?? input.resultId;
      const diverged = state.posts.find(
        (post) => post[identityKey] === identityValue && post.envelopeFingerprint !== input.envelopeFingerprint
      );
      if (diverged) {
        throw new MailboxConflictError(
          "envelope_fingerprint_mismatch",
          `${identityValue} is already recorded at ${diverged.commentRef} with a different envelope fingerprint.`
        );
      }
      const post: MarkerPost = {
        postId: newId("post"),
        markerKind: input.markerKind,
        packetId: input.packetId,
        resultId: input.resultId,
        commentRef,
        envelopeFingerprint: input.envelopeFingerprint,
        postedAt: input.now ?? this.clock()
      };
      return { next: { ...state, posts: [...state.posts, post] }, result: clone(post) };
    });
  }

  /**
   * Freezes immutable observations for marker-bearing comments (contract §15).
   * A comment edited after a previous observation is recorded as a NEW
   * observation with editedAfterObservation=true; history is never rewritten.
   * Valid result markers are deduplicated by (result_id, result_fingerprint):
   * same pair is idempotent; a different fingerprint for a known result_id
   * records a PENDING_TRIAGE conflict instead of being silently accepted.
   */
  async observeComments(comments: readonly RawMailboxComment[]): Promise<ObserveCommentsOutcome> {
    const outcome: {
      commentObservations: CommentObservation[];
      resultObservations: ResultObservation[];
      resultFingerprintConflicts: ResultFingerprintConflict[];
      skippedAlreadyObserved: string[];
    } = { commentObservations: [], resultObservations: [], resultFingerprintConflicts: [], skippedAlreadyObserved: [] };

    return this.commit(async (state) => {
      let next = state;
      for (const comment of comments) {
        const commentRef = nonEmpty(comment.commentRef, "comment_ref_required", "commentRef is required.");
        const blocks = extractMarkerBlocks(comment.body ?? "");
        if (blocks.length === 0) {
          continue;
        }
        const contentFingerprint = await fingerprint(comment.body);
        const alreadyObserved = next.commentObservations.some(
          (observation) => observation.commentRef === commentRef && observation.contentFingerprint === contentFingerprint
        );
        if (alreadyObserved) {
          outcome.skippedAlreadyObserved.push(commentRef);
          continue;
        }
        const editedAfterObservation = next.commentObservations.some((observation) => observation.commentRef === commentRef);
        const parsed = await parseCommentMarkers(comment);
        const firstFailure = parsed.markers.find((marker) => !marker.ok)?.failure;
        const firstValid = parsed.markers.find((marker) => marker.ok)?.envelope;
        let markerStatus: MailboxMarkerStatus;
        if (parsed.markers.some((marker) => !marker.ok && marker.failure?.reason === "forbidden_field")) {
          markerStatus = "FORBIDDEN_FIELD";
        } else if (parsed.markers.some((marker) => !marker.ok)) {
          markerStatus = "MALFORMED";
        } else if (firstValid?.marker_kind === "ESCALATION_RESULT") {
          markerStatus = "VALID_RESULT";
        } else {
          markerStatus = "VALID_PACKET";
        }
        const commentObservation: CommentObservation = {
          commentObservationId: newId("observation"),
          commentRef,
          author: comment.author ?? "",
          observedAt: this.clock(),
          commentUpdatedAt: comment.updatedAt ?? "",
          contentFingerprint,
          markerStatus,
          detail: firstFailure
            ? firstFailure.reason === "forbidden_field"
              ? `${firstFailure.detail} Paths: ${firstFailure.forbiddenPaths.join(", ")}`
              : firstFailure.detail
            : undefined,
          parsedEscalationId:
            firstValid?.marker_kind === "ESCALATION_PACKET"
              ? firstValid.escalation.escalation_id
              : firstValid?.marker_kind === "ESCALATION_RESULT"
                ? firstValid.result.source_escalation_id
                : undefined,
          parsedPacketId:
            firstValid?.marker_kind === "ESCALATION_PACKET"
              ? firstValid.packet.packet_id
              : firstValid?.marker_kind === "ESCALATION_RESULT"
                ? firstValid.result.source_packet_id ?? undefined
                : undefined,
          parsedResultId: firstValid?.marker_kind === "ESCALATION_RESULT" ? firstValid.result.result_id : undefined,
          parsedResultFingerprint:
            firstValid?.marker_kind === "ESCALATION_RESULT" ? firstValid.result.result_fingerprint : undefined,
          editedAfterObservation
        };
        next = { ...next, commentObservations: [...next.commentObservations, commentObservation] };
        outcome.commentObservations.push(clone(commentObservation));

        for (const marker of parsed.markers) {
          if (!marker.ok || marker.envelope.marker_kind !== "ESCALATION_RESULT") {
            continue;
          }
          const result = marker.envelope.result;
          const recorded = next.resultObservations.find((observation) => observation.resultId === result.result_id);
          if (recorded) {
            if (recorded.resultFingerprint === result.result_fingerprint) {
              continue;
            }
            const conflict: ResultFingerprintConflict = {
              conflictId: newId("conflict"),
              escalationId: result.source_escalation_id,
              resultId: result.result_id,
              recordedFingerprint: recorded.resultFingerprint,
              observedFingerprint: result.result_fingerprint,
              commentObservationId: commentObservation.commentObservationId,
              recordedAt: this.clock(),
              status: "PENDING_TRIAGE"
            };
            next = { ...next, resultFingerprintConflicts: [...next.resultFingerprintConflicts, conflict] };
            outcome.resultFingerprintConflicts.push(clone(conflict));
            continue;
          }
          const observation: ResultObservation = {
            resultObservationId: newId("result-observation"),
            resultId: result.result_id,
            resultFingerprint: result.result_fingerprint,
            escalationId: result.source_escalation_id,
            authorityRole: result.authority_role,
            commentObservationId: commentObservation.commentObservationId,
            firstObservedAt: this.clock()
          };
          next = { ...next, resultObservations: [...next.resultObservations, observation] };
          outcome.resultObservations.push(clone(observation));
        }
      }
      return { next, result: clone(outcome) };
    });
  }

  /**
   * Restart-safe rediscovery (contract §19). With live comments, cross-checks
   * the durable GitHub markers against the ledger: latest packet revision per
   * escalation, fingerprint matches, observed vs unobserved result markers,
   * malformed/forbidden markers, and foreign escalations not in this ledger.
   */
  async discover(comments?: readonly RawMailboxComment[]): Promise<MailboxDiscoveryReport> {
    const state = await this.snapshot();
    const parsedComments = comments ? await Promise.all(comments.map((comment) => parseCommentMarkers(comment))) : [];
    const escalations: DiscoveredEscalation[] = await Promise.all(state.escalations.map(async (escalation) => {
      const packets = state.packets
        .filter((packet) => packet.escalationId === escalation.escalationId)
        .sort((a, b) => a.packetRevision - b.packetRevision);
      const latestPacket = packets[packets.length - 1];
      const posts = state.posts.filter((post) => post.packetId && post.packetId === latestPacket?.packetId);
      const observedResults = state.resultObservations.filter(
        (observation) => observation.escalationId === escalation.escalationId
      );
      const conflicts = state.resultFingerprintConflicts.filter(
        (conflict) => conflict.escalationId === escalation.escalationId
      );
      let liveMaxRevision = 0;
      let liveMaxClaimedFingerprint: string | undefined;
      let liveMaxContentFingerprint: string | undefined;
      const sameRevisionDivergences: DiscoveredPacketDivergence[] = [];
      const liveResultMarkers: DiscoveredResultMarker[] = [];
      for (const parsed of parsedComments) {
        for (const marker of parsed.markers) {
          if (!marker.ok || !marker.envelope) {
            continue;
          }
          if (
            marker.envelope.marker_kind === "ESCALATION_PACKET" &&
            marker.envelope.escalation.escalation_id === escalation.escalationId
          ) {
            const claimed = marker.envelope.packet.packet_fingerprint;
            // Verify the live CONTENT, not just the claimed fingerprint field:
            // a tampered copy can leave the claimed string untouched.
            const content = await packetContentFingerprintFromWire(escalation.escalationId, marker.envelope.packet);
            const revision = marker.envelope.packet.packet_revision;
            if (revision > liveMaxRevision) {
              liveMaxRevision = revision;
              liveMaxClaimedFingerprint = claimed;
              liveMaxContentFingerprint = content;
            } else if (
              revision === liveMaxRevision &&
              (claimed !== liveMaxClaimedFingerprint || content !== liveMaxContentFingerprint)
            ) {
              // Two live copies claim the same max revision but diverge; surface
              // the divergence instead of silently checking only the first one.
              sameRevisionDivergences.push({
                commentRef: parsed.commentRef,
                packetId: marker.envelope.packet.packet_id,
                claimedFingerprint: claimed,
                contentFingerprint: content
              });
            }
          }
          if (marker.envelope.marker_kind === "ESCALATION_RESULT" && marker.envelope.result.source_escalation_id === escalation.escalationId) {
            const result = marker.envelope.result;
            const observed = observedResults.some(
              (observation) => observation.resultId === result.result_id && observation.resultFingerprint === result.result_fingerprint
            );
            liveResultMarkers.push({
              resultId: result.result_id,
              resultFingerprint: result.result_fingerprint,
              commentRef: parsed.commentRef,
              authorityRole: result.authority_role,
              observed
            });
          }
        }
      }
      return {
        escalationId: escalation.escalationId,
        kind: escalation.kind,
        status: escalation.status,
        workItemRef: escalation.workItemRef,
        sourceOperationRef: escalation.sourceOperationRef,
        sourceRole: escalation.sourceRole,
        destinationRole: escalation.destinationRole,
        open: true,
        blocking: true,
        latestPacket: latestPacket
          ? {
              packetId: latestPacket.packetId,
              packetRevision: latestPacket.packetRevision,
              packetFingerprint: latestPacket.packetFingerprint,
              supersedesPacketId: latestPacket.supersedesPacketId,
              postCommentRefs: posts.map((post) => post.commentRef)
            }
          : undefined,
        packetFingerprintMatchesLive:
          liveMaxContentFingerprint === undefined ? undefined : liveMaxContentFingerprint === latestPacket?.packetFingerprint,
        livePacketClaimIntegrity:
          liveMaxClaimedFingerprint === undefined || liveMaxContentFingerprint === undefined
            ? undefined
            : liveMaxClaimedFingerprint === liveMaxContentFingerprint,
        sameRevisionDivergences,
        observedResults: observedResults.map((observation) => ({
          resultId: observation.resultId,
          resultFingerprint: observation.resultFingerprint,
          commentObservationId: observation.commentObservationId,
          authorityRole: observation.authorityRole
        })),
        liveResultMarkers,
        conflictIds: conflicts.map((conflict) => conflict.conflictId)
      };
    }));
    const malformedMarkers: DiscoveredMalformedMarker[] = [];
    const forbiddenFieldMarkers: DiscoveredForbiddenMarker[] = [];
    const knownEscalationIds = new Set(state.escalations.map((escalation) => escalation.escalationId));
    const foreignEscalations: DiscoveredForeignEscalation[] = [];
    for (const parsed of parsedComments) {
      for (const marker of parsed.markers) {
        if (marker.ok) {
          const envelope = marker.envelope;
          if (
            envelope.marker_kind === "ESCALATION_PACKET" &&
            !knownEscalationIds.has(envelope.escalation.escalation_id)
          ) {
            foreignEscalations.push({
              escalationId: envelope.escalation.escalation_id,
              workItemRef: envelope.escalation.work_item_ref,
              packetId: envelope.packet.packet_id,
              commentRef: parsed.commentRef
            });
          }
          if (
            envelope.marker_kind === "ESCALATION_RESULT" &&
            !knownEscalationIds.has(envelope.result.source_escalation_id)
          ) {
            foreignEscalations.push({
              escalationId: envelope.result.source_escalation_id,
              resultId: envelope.result.result_id,
              commentRef: parsed.commentRef
            });
          }
          continue;
        }
        if (marker.failure?.reason === "forbidden_field") {
          forbiddenFieldMarkers.push({
            commentRef: parsed.commentRef,
            paths: marker.failure.forbiddenPaths
          });
        } else {
          malformedMarkers.push({
            commentRef: parsed.commentRef,
            reason: marker.failure?.reason ?? "unknown",
            detail: marker.failure?.detail ?? ""
          });
        }
      }
    }
    return {
      scopeRef: state.scopeRef,
      escalations,
      foreignEscalations,
      malformedMarkers,
      forbiddenFieldMarkers,
      pendingConflicts: state.resultFingerprintConflicts.filter((conflict) => conflict.status === "PENDING_TRIAGE")
    };
  }

  private async commit<T>(
    mutator: (state: CrossAgentMailboxState) => Promise<{ next: CrossAgentMailboxState; result: T }> | { next: CrossAgentMailboxState; result: T }
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_COMMIT_RETRIES; attempt += 1) {
      const current = normalizeState(await this.store.read());
      const mutated = await mutator(clone(current));
      // The ledger revision is the durable commit fence: every applied commit
      // advances it, so concurrent writers lose CAS and retry instead of
      // silently overwriting each other's persisted records.
      const next: CrossAgentMailboxState = { ...mutated.next, revision: current.revision + 1 };
      if (await this.store.compareAndSet(current.revision, next)) {
        return mutated.result;
      }
    }
    throw new MailboxConflictError("stale_revision", "The mailbox ledger changed concurrently. Retry.");
  }
}

// ---------------------------------------------------------------------------
// Envelope rendering (shared)
// ---------------------------------------------------------------------------

async function renderEnvelope(envelope: MailboxEnvelopeWire): Promise<RenderedEnvelope> {
  const forbiddenPaths = findForbiddenEnvelopeFields(envelope);
  if (forbiddenPaths.length > 0) {
    throw new MailboxInvariantError(
      "forbidden_field",
      `Refusing to render an envelope with forbidden fields: ${forbiddenPaths.join(", ")}`
    );
  }
  const envelopeFingerprint = await fingerprint(envelope);
  const body = [
    "<!-- noos:mailbox -->",
    "",
    "NOOS cross-agent handoff marker. The fenced block below is machine-readable;",
    "the durable GitHub refs inside are the transport identity. Do not edit the fenced block.",
    "",
    "```" + MAILBOX_FENCE,
    JSON.stringify(envelope, null, 2),
    "```",
    ""
  ].join("\n");
  // Round-trip guard: text containing a fenced-block terminator (e.g. ```)
  // would truncate the marker. Reject content that cannot survive transport.
  const blocks = extractMarkerBlocks(body);
  if (blocks.length !== 1) {
    throw new MailboxInvariantError(
      "marker_unsafe_content",
      "Envelope content breaks the fenced marker encoding (e.g. contains ```); remove or rephrase it."
    );
  }
  const parsedBack = await parseEnvelopeJson(blocks[0]);
  if (!parsedBack.ok || canonicalize(parsedBack.envelope) !== canonicalize(envelope)) {
    throw new MailboxInvariantError(
      "marker_unsafe_content",
      "Envelope does not round-trip through the fenced marker unchanged; remove or rephrase unsafe content."
    );
  }
  return { body, envelope, envelopeFingerprint };
}

// ---------------------------------------------------------------------------
// Result envelope construction (destination side; store-free by design)
// ---------------------------------------------------------------------------

export interface BuildResultEnvelopeInput {
  resultId?: string;
  sourceEscalationId: string;
  sourcePacketId?: string;
  sourceRole: string;
  authorityRole: string;
  completionStatus: MailboxCompletionStatus;
  summary: string;
  artifactRefs?: readonly string[];
  authorityRefs?: readonly string[];
  evidenceRefs?: readonly string[];
  unresolvedQuestions?: readonly string[];
  recommendedNextAction: string;
}

/**
 * Builds an ESCALATION_RESULT marker for the destination side. Carries claims,
 * refs and a descriptive completion_status only — no `result_kind` and no
 * destination-authored sufficiency field (contract §3.6/§9/§18).
 */
export async function buildResultEnvelope(input: BuildResultEnvelopeInput): Promise<RenderedEnvelope> {
  const resultId = nonEmpty(input.resultId, "result_id_required", "resultId is required.");
  const semantic = {
    result_id: resultId,
    source_escalation_id: nonEmpty(input.sourceEscalationId, "source_escalation_id_required", "sourceEscalationId is required."),
    source_packet_id: input.sourcePacketId?.trim() || null,
    source_role: nonEmpty(input.sourceRole, "source_role_required", "sourceRole is required."),
    authority_role: nonEmpty(input.authorityRole, "authority_role_required", "authorityRole is required."),
    completion_status: (() => {
      const status = input.completionStatus;
      if (!MAILBOX_COMPLETION_STATUSES.includes(status)) {
        throw new MailboxInvariantError("invalid_completion_status", `Unknown completionStatus: ${String(status)}`);
      }
      return status;
    })(),
    summary: nonEmpty(input.summary, "summary_required", "summary is required."),
    artifact_refs: normalizeList(input.artifactRefs),
    authority_refs: normalizeList(input.authorityRefs),
    evidence_refs: normalizeList(input.evidenceRefs),
    unresolved_questions: normalizeList(input.unresolvedQuestions),
    recommended_next_action: nonEmpty(input.recommendedNextAction, "recommended_next_action_required", "recommendedNextAction is required.")
  };
  const resultFingerprint = await fingerprint(semantic);
  const envelope: ResultEnvelopeWire = {
    noos_mailbox: MAILBOX_ENVELOPE_VERSION,
    marker_kind: "ESCALATION_RESULT",
    result: { ...semantic, result_fingerprint: resultFingerprint }
  };
  return renderEnvelope(envelope);
}

// ---------------------------------------------------------------------------
// Launch instructions (acceptance: durable GitHub refs + short instructions)
// ---------------------------------------------------------------------------

export interface LaunchInstructionParams {
  workItemRef: string;
  escalationId: string;
  packetCommentRef?: string;
  latestPacket?: { packetId: string; packetRevision: number };
  latestResult?: { resultId: string; commentRef: string };
}

export interface LaunchInstructions {
  destinationInstruction: string;
  resumeInstruction: string;
}

export function compileLaunchInstructions(params: LaunchInstructionParams): LaunchInstructions {
  const packetPart = params.latestPacket
    ? `packet ${params.latestPacket.packetId} (r${params.latestPacket.packetRevision})`
    : "no packet yet";
  const packetAt = params.packetCommentRef ? `, posted at ${params.packetCommentRef}` : "";
  const destinationInstruction =
    `NEEDS-clarification escalation ${params.escalationId} is OPEN on ${params.workItemRef} (${packetPart}${packetAt}). ` +
    `Read the fenced ${MAILBOX_FENCE} marker, adjudicate against the exact authority refs it pins, then post ONE ` +
    `ESCALATION_RESULT marker comment answering that packet (build it with: npm run mailbox -- render-result ...). ` +
    `Do not edit the escalation marker; post a new result marker instead.`;
  const resumeInstruction = params.latestResult
    ? `Adjudication result ${params.latestResult.resultId} for escalation ${params.escalationId} is durably posted at ` +
      `${params.latestResult.commentRef} on ${params.workItemRef}. Resume the SAME source operation under it; do not open ` +
      `a new work item. Freeze the observation first (npm run mailbox -- observe ...). Escalation resolution is ` +
      `Human-mediated; this mailbox never auto-resumes.`
    : `No adjudication result has been observed yet for escalation ${params.escalationId} on ${params.workItemRef}. ` +
      `Freeze current observations (npm run mailbox -- observe ...) and keep waiting; this mailbox never auto-resumes.`;
  return { destinationInstruction, resumeInstruction };
}

// ---------------------------------------------------------------------------
// Discovery report types
// ---------------------------------------------------------------------------

export interface DiscoveredResultMarker {
  resultId: string;
  resultFingerprint: string;
  commentRef: string;
  authorityRole: string;
  observed: boolean;
}

export interface DiscoveredPacketDivergence {
  commentRef: string;
  packetId: string;
  claimedFingerprint: string;
  contentFingerprint: string;
}

export interface DiscoveredEscalation {
  escalationId: string;
  kind: MailboxEscalationKind;
  status: "OPEN";
  workItemRef: string;
  sourceOperationRef: string;
  sourceRole: string;
  destinationRole: string;
  open: boolean;
  blocking: boolean;
  latestPacket?: {
    packetId: string;
    packetRevision: number;
    packetFingerprint: string;
    supersedesPacketId?: string;
    postCommentRefs: readonly string[];
  };
  /** Recomputed live content fingerprint equals the ledger packet fingerprint. */
  packetFingerprintMatchesLive?: boolean;
  /** The live marker's claimed fingerprint field matches its own content. */
  livePacketClaimIntegrity?: boolean;
  /** Live packet copies claiming the same max revision but diverging in content or claim. */
  sameRevisionDivergences: readonly DiscoveredPacketDivergence[];
  observedResults: readonly { resultId: string; resultFingerprint: string; commentObservationId: string; authorityRole: string }[];
  liveResultMarkers: readonly DiscoveredResultMarker[];
  conflictIds: readonly string[];
}

export interface DiscoveredForeignEscalation {
  escalationId: string;
  workItemRef?: string;
  packetId?: string;
  resultId?: string;
  commentRef: string;
}

export interface DiscoveredMalformedMarker {
  commentRef: string;
  reason: string;
  detail: string;
}

export interface DiscoveredForbiddenMarker {
  commentRef: string;
  paths: readonly string[];
}

export interface MailboxDiscoveryReport {
  scopeRef?: string;
  escalations: readonly DiscoveredEscalation[];
  foreignEscalations: readonly DiscoveredForeignEscalation[];
  malformedMarkers: readonly DiscoveredMalformedMarker[];
  forbiddenFieldMarkers: readonly DiscoveredForbiddenMarker[];
  pendingConflicts: readonly ResultFingerprintConflict[];
}
