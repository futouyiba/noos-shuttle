#!/usr/bin/env node
/**
 * NOOS cross-agent GitHub mailbox CLI (Issue #10 prototype, mailbox/provenance scope).
 *
 * Durable transport around `src/core/cross-agent-mailbox.ts` using GitHub
 * Issue comments (via the `gh` CLI) as the mailbox and a local JSON ledger
 * under `.noos/runtime/mailbox/` (gitignored) as the persisted-before-post
 * escalation/packet identity store.
 *
 * Boundary (contract v3 §19): marker envelopes never carry `result_kind` or
 * any destination-authored sufficiency field; no escalation resolution,
 * withdrawal, or automatic resume happens here. Resume stays Human-mediated
 * via the short launch instructions this tool prints.
 *
 * Commands:
 *   init                                     create an empty ledger
 *   open --issue O/R#N ...                   persist escalation + packet r1, render (or --post) the marker
 *   revise-packet --escalation ID ...        compile the next packet revision, render (or --post) it
 *   record-post --issue O/R#N --comment ID --packet ID   record a manually posted marker
 *   render-result --escalation ID ...        build (or --post) an ESCALATION_RESULT marker (destination side)
 *   discover --issue O/R#N                   restart-safe rediscovery from live comments + ledger
 *   observe --issue O/R#N [--comment ID]     freeze immutable comment/result observations (dedup + conflicts)
 *   show --escalation ID                     dump one escalation's durable mailbox records
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CrossAgentMailbox,
  buildResultEnvelope,
  compileLaunchInstructions,
  emptyMailboxState,
  MAILBOX_ESCALATION_KINDS,
  MAILBOX_COMPLETION_STATUSES
} from "../src/core/cross-agent-mailbox.ts";

const MULTI_VALUE_FLAGS = new Set(["authority", "evidence", "artifact", "non-goal", "context", "open-question"]);

function usage(exitCode = 0) {
  const text = `Usage:
  npm run mailbox -- init --ledger <path>
  npm run mailbox -- open --issue owner/name#N --escalation-id <id> \\
      --kind NEEDS_DESIGN|NEEDS_EVIDENCE|NEEDS_HUMAN \\
      --source-role R --destination-role R --source-operation <durable-ref> \\
      --authority-basis <ref> --blocker <text|@file|-> --question <text|@file|-> \\
      --provenance <json|@file|-> [--authority <ref>]... [--evidence <ref>]... \\
      [--reason ...] [--goal ...] [--scope ...] \\
      [--non-goal <text>]... [--return ...] [--stop ...] [--artifact <ref>]... [--context <ref>]... \\
      [--post] [--ledger <path>]
  npm run mailbox -- revise-packet --escalation <id> --reason ... --goal ... --scope ... \\
      --return ... --stop ... [--non-goal <text>]... [--artifact <ref>]... [--context <ref>]... [--post] [--ledger <path>]
  npm run mailbox -- render-result --escalation <id> --result-id <id> --source-role R --authority-role R \\
      --status COMPLETE|PARTIAL|BLOCKED|FAILED_SAFE --summary <text|@file|-> --next-action <text> \\
      [--packet <id>] [--artifact <ref>]... [--authority <ref>]... [--evidence <ref>]... [--open-question <q>]... \\
      [--post --issue owner/name#N]
  npm run mailbox -- discover --issue owner/name#N [--ledger <path>]
  npm run mailbox -- observe --issue owner/name#N [--comment <id>] [--ledger <path>]
  npm run mailbox -- show --escalation <id> [--ledger <path>]

Text values accept "@file" to read from a file and "-" to read from stdin.
The ledger defaults to .noos/runtime/mailbox/<owner>__<repo>__issue-<n>.json under the cwd.
`;
  process.stdout.write(text);
  process.exit(exitCode);
}

function fail(message) {
  process.stderr.write(`noos-mailbox: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage(command ? 0 : 1);
  }
  const values = new Map();
  const flags = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      fail(`Unexpected argument "${token}".`);
    }
    const key = token.slice(2);
    if (MULTI_VALUE_FLAGS.has(key)) {
      const list = values.get(key) ?? [];
      const value = argv[index + 1];
      if (value === undefined) fail(`--${key} requires a value.`);
      list.push(value);
      values.set(key, list);
      index += 1;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    values.set(key, next);
    index += 1;
  }
  return { command, values, flags };
}

function requireValue(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) {
    fail(`--${key} is required.`);
  }
  return value;
}

function textValue(value) {
  if (value === "-") {
    return fs.readFileSync(0, "utf8");
  }
  if (value.startsWith("@")) {
    return fs.readFileSync(value.slice(1), "utf8");
  }
  return value;
}

function parseIssueRef(ref) {
  const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref.trim());
  if (!match) {
    fail(`Issue ref must be "owner/name#number": ${ref}`);
  }
  return { repo: match[1], number: Number(match[2]) };
}

function defaultLedgerPath(issueRef) {
  const { repo, number } = parseIssueRef(issueRef);
  return path.join(".noos", "runtime", "mailbox", `${repo.replace("/", "__")}__issue-${number}.json`);
}

class FileMailboxStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async read() {
    try {
      return JSON.parse(await fsp.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  // Single-process CLI store: revision-checked read-then-atomic-rename.
  async compareAndSet(expectedRevision, next) {
    const current = await this.read();
    if ((current?.revision ?? 0) !== expectedRevision) return false;
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await fsp.rename(tmp, this.filePath);
    return true;
  }
}

function runGh(args, input) {
  const result = spawnSync("gh", args, { encoding: "utf8", input });
  if (result.status !== 0) {
    fail(`gh ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

function postIssueComment(issueRef, body) {
  const { repo, number } = parseIssueRef(issueRef);
  const tmp = path.join(".tmp", `noos-mailbox-comment-${process.pid}-${Date.now()}.md`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, body, "utf8");
  try {
    const output = runGh(["issue", "comment", String(number), "--repo", repo, "--body-file", tmp]);
    const match = /#issuecomment-(\d+)/.exec(output);
    if (!match) {
      fail(`Comment was posted but its URL could not be parsed: ${output.trim()}`);
    }
    return { commentId: match[1], commentRef: `${issueRef}/comment/${match[1]}` };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function fetchIssueComments(issueRef) {
  const { repo, number } = parseIssueRef(issueRef);
  // --paginate --slurp wraps every page into one outer JSON array; without
  // --slurp, multi-page output is concatenated JSON arrays and JSON.parse throws.
  const raw = runGh(["api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--slurp"]);
  return parsePaginatedComments(raw, issueRef);
}

/** Maps paginated gh api comment JSON to RawMailboxComment inputs. */
export function parsePaginatedComments(raw, issueRef) {
  const parsed = JSON.parse(raw);
  const comments = Array.isArray(parsed?.[0]) ? parsed.flat() : parsed;
  return comments.map((comment) => ({
    commentRef: `${issueRef}/comment/${comment.id}`,
    author: comment.user?.login ?? "",
    updatedAt: comment.updated_at ?? "",
    body: comment.body ?? ""
  }));
}

function fetchSingleComment(issueRef, commentId) {
  const { repo } = parseIssueRef(issueRef);
  const raw = runGh(["api", `repos/${repo}/issues/comments/${commentId}`]);
  const comment = JSON.parse(raw);
  return { commentRef: `${issueRef}/comment/${comment.id}`, author: comment.user?.login ?? "", updatedAt: comment.updated_at ?? "", body: comment.body ?? "" };
}

function parseProvenanceInput(value) {
  const raw = textValue(value);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`--provenance is not valid JSON: ${error}`);
  }
  const provenance = {
    repository: parsed.repository,
    issueRef: parsed.issue_ref ?? parsed.issueRef,
    pullRequestRef: parsed.pull_request_ref ?? parsed.pullRequestRef,
    pullRequestHeadSha: parsed.pull_request_head_sha ?? parsed.pullRequestHeadSha,
    commitSha: parsed.commit_sha ?? parsed.commitSha,
    pathRefs: parsed.path_refs ?? parsed.pathRefs ?? [],
    blobRefs: parsed.blob_refs ?? parsed.blobRefs ?? []
  };
  if (!provenance.repository) {
    fail("--provenance requires at least { \"repository\": \"owner/name\", ... } with an exact revision anchor.");
  }
  return provenance;
}

function latestPacketFor(state, escalationId) {
  const packets = state.packets.filter((packet) => packet.escalationId === escalationId);
  return packets.sort((a, b) => a.packetRevision - b.packetRevision)[packets.length - 1];
}

function printPostHint() {
  process.stdout.write("\nPost this body as ONE Issue comment (or re-run with --post), then record it:\n");
}

async function commandRecordPost(values) {
  const issueRef = requireValue(values, "issue");
  const ledgerPath = String(values.get("ledger") ?? defaultLedgerPath(issueRef));
  const mailbox = new CrossAgentMailbox(new FileMailboxStore(ledgerPath));
  const commentId = requireValue(values, "comment");
  const packetId = requireValue(values, "packet");
  const state = await mailbox.snapshot();
  const packet = state.packets.find((item) => item.packetId === packetId);
  if (!packet) {
    fail(`Packet ${packetId} not found in ${ledgerPath}.`);
  }
  const rendered = await mailbox.renderPacketEnvelope(packet.escalationId, packetId);
  const post = await mailbox.recordPost({
    markerKind: "ESCALATION_PACKET",
    packetId,
    commentRef: `${issueRef}/comment/${commentId}`,
    envelopeFingerprint: rendered.envelopeFingerprint
  });
  process.stdout.write(`Recorded post ${post.postId} for ${packetId} at ${post.commentRef}\n`);
}

async function commandInit(values) {
  const ledgerPath = requireValue(values, "ledger");
  const store = new FileMailboxStore(ledgerPath);
  if (await store.read()) {
    fail(`Ledger already exists: ${ledgerPath}`);
  }
  await store.compareAndSet(0, emptyMailboxState());
  process.stdout.write(`Initialized empty mailbox ledger: ${ledgerPath}\n`);
}

async function commandOpen(values, flags) {
  const issueRef = requireValue(values, "issue");
  const ledgerPath = String(values.get("ledger") ?? defaultLedgerPath(issueRef));
  const mailbox = new CrossAgentMailbox(new FileMailboxStore(ledgerPath));
  const kind = requireValue(values, "kind");
  if (!MAILBOX_ESCALATION_KINDS.includes(kind)) {
    fail(`--kind must be one of ${MAILBOX_ESCALATION_KINDS.join("|")}.`);
  }
  const escalation = await mailbox.openEscalation({
    // A stable explicit id keeps reruns create-or-get idempotent after a lost
    // post acknowledgement; omitting it mints a fresh escalation instead.
    escalationId: requireValue(values, "escalation-id"),
    workItemRef: issueRef,
    sourceOperationRef: requireValue(values, "source-operation"),
    sourceRole: requireValue(values, "source-role"),
    destinationRole: requireValue(values, "destination-role"),
    kind,
    blockerSummary: textValue(requireValue(values, "blocker")),
    question: textValue(requireValue(values, "question")),
    authorityBasisRef: requireValue(values, "authority-basis"),
    authorityRefs: values.get("authority") ?? [],
    evidenceRefs: values.get("evidence") ?? [],
    provenance: parseProvenanceInput(requireValue(values, "provenance"))
  });
  const state = await mailbox.snapshot();
  const existing = latestPacketFor(state, escalation.escalationId);
  const packet =
    existing ??
    (await mailbox.compilePacket({
      escalationId: escalation.escalationId,
      reason: values.get("reason") ?? escalation.blockerSummary,
      goal: requireValue(values, "goal"),
      scope: requireValue(values, "scope"),
      nonGoals: values.get("non-goal") ?? [],
      implementationArtifactRefs: values.get("artifact") ?? [],
      boundedContextRefs: values.get("context") ?? [],
      expectedReturnContract: requireValue(values, "return"),
      stopCondition: requireValue(values, "stop")
    }));
  const rendered = await mailbox.renderPacketEnvelope(escalation.escalationId, packet.packetId);
  process.stdout.write(
    `Escalation ${escalation.escalationId} (${escalation.kind}, ${escalation.resolutionMode}, ${escalation.status}) persisted in ${ledgerPath}\n` +
      `Packet ${packet.packetId} (r${packet.packetRevision}) fingerprint ${packet.packetFingerprint}\n`
  );
  if (flags.has("post")) {
    const posted = postIssueComment(issueRef, rendered.body);
    const post = await mailbox.recordPost({
      markerKind: "ESCALATION_PACKET",
      packetId: packet.packetId,
      commentRef: posted.commentRef,
      envelopeFingerprint: rendered.envelopeFingerprint
    });
    process.stdout.write(`Posted ${posted.commentRef} (post ${post.postId})\n\n`);
    const instructions = compileLaunchInstructions({
      workItemRef: issueRef,
      escalationId: escalation.escalationId,
      packetCommentRef: posted.commentRef,
      latestPacket: { packetId: packet.packetId, packetRevision: packet.packetRevision }
    });
    process.stdout.write(`Destination instruction:\n${instructions.destinationInstruction}\n`);
    return;
  }
  printPostHint();
  process.stdout.write(
    `  npm run mailbox -- record-post --issue ${issueRef} --comment <comment-id> --packet ${packet.packetId} --ledger ${ledgerPath}\n`
  );
  process.stdout.write("\n--- marker body ---\n");
  process.stdout.write(rendered.body);
}

async function commandRevisePacket(values, flags) {
  const escalationId = requireValue(values, "escalation");
  const ledgerPath = String(values.get("ledger") ?? "");
  if (!ledgerPath) fail("revise-packet requires --ledger (or run open first to see the default path).");
  const mailbox = new CrossAgentMailbox(new FileMailboxStore(ledgerPath));
  const packet = await mailbox.compilePacket({
    escalationId,
    reason: requireValue(values, "reason"),
    goal: requireValue(values, "goal"),
    scope: requireValue(values, "scope"),
    nonGoals: values.get("non-goal") ?? [],
    implementationArtifactRefs: values.get("artifact") ?? [],
    boundedContextRefs: values.get("context") ?? [],
    expectedReturnContract: requireValue(values, "return"),
    stopCondition: requireValue(values, "stop")
  });
  const rendered = await mailbox.renderPacketEnvelope(escalationId, packet.packetId);
  process.stdout.write(
    `Packet ${packet.packetId} (r${packet.packetRevision}, supersedes ${packet.supersedesPacketId ?? "none"}) fingerprint ${packet.packetFingerprint}\n`
  );
  if (flags.has("post")) {
    const state = await mailbox.snapshot();
    const issueRef = requireValue(values, "issue");
    const posted = postIssueComment(issueRef, rendered.body);
    await mailbox.recordPost({
      markerKind: "ESCALATION_PACKET",
      packetId: packet.packetId,
      commentRef: posted.commentRef,
      envelopeFingerprint: rendered.envelopeFingerprint
    });
    process.stdout.write(`Posted ${posted.commentRef}\n`);
    return;
  }
  printPostHint();
  process.stdout.write("\n--- marker body ---\n");
  process.stdout.write(rendered.body);
}

async function commandRenderResult(values, flags) {
  const status = requireValue(values, "status");
  if (!MAILBOX_COMPLETION_STATUSES.includes(status)) {
    fail(`--status must be one of ${MAILBOX_COMPLETION_STATUSES.join("|")} (descriptive only).`);
  }
  const rendered = await buildResultEnvelope({
    resultId: requireValue(values, "result-id"),
    sourceEscalationId: requireValue(values, "escalation"),
    sourcePacketId: values.get("packet"),
    sourceRole: requireValue(values, "source-role"),
    authorityRole: requireValue(values, "authority-role"),
    completionStatus: status,
    summary: textValue(requireValue(values, "summary")),
    artifactRefs: values.get("artifact") ?? [],
    authorityRefs: values.get("authority") ?? [],
    evidenceRefs: values.get("evidence") ?? [],
    unresolvedQuestions: values.get("open-question") ?? [],
    recommendedNextAction: requireValue(values, "next-action")
  });
  if (flags.has("post")) {
    const issueRef = requireValue(values, "issue");
    const posted = postIssueComment(issueRef, rendered.body);
    process.stdout.write(`Posted ESCALATION_RESULT marker ${posted.commentRef}\n`);
    process.stdout.write(
      `\nSource side: freeze the observation with:\n  npm run mailbox -- observe --issue ${issueRef} --ledger <ledger>\n`
    );
    return;
  }
  process.stdout.write("--- result marker body ---\n");
  process.stdout.write(rendered.body);
}

async function commandDiscover(values) {
  const issueRef = requireValue(values, "issue");
  const ledgerPath = String(values.get("ledger") ?? defaultLedgerPath(issueRef));
  const mailbox = new CrossAgentMailbox(new FileMailboxStore(ledgerPath));
  const comments = fetchIssueComments(issueRef);
  const report = await mailbox.discover(comments);
  process.stdout.write(`Mailbox discovery for ${issueRef} (${comments.length} comments, ledger ${ledgerPath}):\n\n`);
  if (report.escalations.length === 0) {
    process.stdout.write("No escalations in this ledger.\n");
  }
  for (const escalation of report.escalations) {
    const packet = escalation.latestPacket;
    process.stdout.write(
      `- ${escalation.escalationId} [${escalation.kind}] ${escalation.status} (blocking) — ${escalation.sourceRole} -> ${escalation.destinationRole}\n` +
        `  latest packet: ${packet ? `${packet.packetId} r${packet.packetRevision} (${packet.postCommentRefs.join(", ") || "not posted"})` : "none"}` +
        (escalation.packetFingerprintMatchesLive === undefined
          ? "\n"
          : ` | live fingerprint match: ${escalation.packetFingerprintMatchesLive}\n`)
    );
    const unobserved = escalation.liveResultMarkers.filter((marker) => !marker.observed);
    if (escalation.liveResultMarkers.length > 0) {
      for (const marker of escalation.liveResultMarkers) {
        process.stdout.write(
          `  result ${marker.resultId} (${marker.authorityRole}) at ${marker.commentRef} — ${marker.observed ? "observed" : "NOT yet observed"}\n`
        );
      }
    }
    if (unobserved.length > 0) {
      process.stdout.write(`  -> freeze with: npm run mailbox -- observe --issue ${issueRef} --ledger ${ledgerPath}\n`);
    }
    if (escalation.conflictIds.length > 0) {
      process.stdout.write(`  PENDING TRIAGE conflicts: ${escalation.conflictIds.join(", ")} (edited/competing result fingerprints)\n`);
    }
    const latestResult = escalation.liveResultMarkers.find((marker) => marker.observed);
    const instructions = compileLaunchInstructions({
      workItemRef: issueRef,
      escalationId: escalation.escalationId,
      packetCommentRef: packet?.postCommentRefs[0],
      latestPacket: packet ? { packetId: packet.packetId, packetRevision: packet.packetRevision } : undefined,
      latestResult: latestResult ? { resultId: latestResult.resultId, commentRef: latestResult.commentRef } : undefined
    });
    process.stdout.write(`  resume instruction:\n  ${instructions.resumeInstruction}\n`);
  }
  for (const foreign of report.foreignEscalations) {
    process.stdout.write(`- FOREIGN escalation ${foreign.escalationId} (${foreign.workItemRef}) at ${foreign.commentRef} — not in this ledger\n`);
  }
  for (const malformed of report.malformedMarkers) {
    process.stdout.write(`- MALFORMED marker at ${malformed.commentRef} (${malformed.reason}): ${malformed.detail}\n`);
  }
  for (const forbidden of report.forbiddenFieldMarkers) {
    process.stdout.write(`- FORBIDDEN-FIELD marker at ${forbidden.commentRef}: ${forbidden.paths.join(", ")}\n`);
  }
}

async function commandObserve(values) {
  const issueRef = requireValue(values, "issue");
  const ledgerPath = String(values.get("ledger") ?? defaultLedgerPath(issueRef));
  const mailbox = new CrossAgentMailbox(new FileMailboxStore(ledgerPath));
  const commentId = values.get("comment");
  const comments = commentId ? [fetchSingleComment(issueRef, String(commentId))] : fetchIssueComments(issueRef);
  const outcome = await mailbox.observeComments(comments);
  process.stdout.write(
    `Observed ${outcome.commentObservations.length} marker comment(s); skipped ${outcome.skippedAlreadyObserved.length} unchanged; ` +
      `${outcome.resultObservations.length} new result observation(s); ${outcome.resultFingerprintConflicts.length} fingerprint conflict(s).\n`
  );
  for (const observation of outcome.commentObservations) {
    process.stdout.write(
      `- ${observation.commentObservationId} ${observation.commentRef} [${observation.markerStatus}]${observation.editedAfterObservation ? " (EDITED after earlier observation)" : ""}${observation.detail ? ` — ${observation.detail}` : ""}\n`
    );
  }
  for (const observation of outcome.resultObservations) {
    process.stdout.write(`- result ${observation.resultId} (${observation.authorityRole}) fingerprint ${observation.resultFingerprint}\n`);
  }
  for (const conflict of outcome.resultFingerprintConflicts) {
    process.stdout.write(
      `- CONFLICT ${conflict.conflictId}: result ${conflict.resultId} recorded ${conflict.recordedFingerprint} but observed ${conflict.observedFingerprint} — PENDING_TRIAGE, needs Human decision\n`
    );
  }
  if (outcome.resultObservations.length > 0) {
    const report = await mailbox.discover(comments);
    for (const escalation of report.escalations) {
      const observed = escalation.observedResults[escalation.observedResults.length - 1];
      if (!observed) continue;
      const live = escalation.liveResultMarkers.find((marker) => marker.resultId === observed.resultId);
      const instructions = compileLaunchInstructions({
        workItemRef: issueRef,
        escalationId: escalation.escalationId,
        latestPacket: escalation.latestPacket
          ? { packetId: escalation.latestPacket.packetId, packetRevision: escalation.latestPacket.packetRevision }
          : undefined,
        latestResult: live ? { resultId: live.resultId, commentRef: live.commentRef } : undefined
      });
      process.stdout.write(`\nresume instruction:\n${instructions.resumeInstruction}\n`);
    }
  }
}

async function commandShow(values) {
  const escalationId = requireValue(values, "escalation");
  const ledgerPath = String(values.get("ledger") ?? "");
  if (!ledgerPath) fail("show requires --ledger.");
  const state = await new CrossAgentMailbox(new FileMailboxStore(ledgerPath)).snapshot();
  const escalation = state.escalations.find((item) => item.escalationId === escalationId);
  if (!escalation) {
    fail(`Escalation ${escalationId} not found in ${ledgerPath}.`);
  }
  const packets = state.packets.filter((packet) => packet.escalationId === escalationId);
  const posts = state.posts.filter((post) => packets.some((packet) => packet.packetId === post.packetId));
  const results = state.resultObservations.filter((observation) => observation.escalationId === escalationId);
  const conflicts = state.resultFingerprintConflicts.filter((conflict) => conflict.escalationId === escalationId);
  process.stdout.write(
    JSON.stringify({ escalation, packets, posts, resultObservations: results, resultFingerprintConflicts: conflicts }, null, 2)
  );
}

async function main() {
  const { command, values, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "init":
      return commandInit(values);
    case "open":
      return commandOpen(values, flags);
    case "revise-packet":
      return commandRevisePacket(values, flags);
    case "record-post":
      return commandRecordPost(values);
    case "render-result":
      return commandRenderResult(values, flags);
    case "discover":
      return commandDiscover(values);
    case "observe":
      return commandObserve(values);
    case "show":
      return commandShow(values);
    default:
      usage(1);
  }
}

const invokedAsScript = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedAsScript) {
  main().catch((error) => {
    fail(error?.stack ?? String(error));
  });
}

export { parseArgs, defaultLedgerPath, parseProvenanceInput, FileMailboxStore };
