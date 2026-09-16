import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultLedgerPath, parseArgs, parsePaginatedComments, parseProvenanceInput } from "../scripts/noos-mailbox.mjs";

const scriptPath = path.resolve("scripts/noos-mailbox.mjs");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "noos-mailbox-cli-"));
const fakeBin = path.join(workDir, "bin");
fs.mkdirSync(fakeBin, { recursive: true });

function installFakeGh() {
  const fixturePath = path.join(workDir, "comments.json");
  const ghPath = path.join(fakeBin, "gh");
  fs.writeFileSync(
    ghPath,
    [
      "#!/bin/sh",
      `case "$*" in`,
      `  *"--paginate"*) cat "${fixturePath}" ;;`,
      "  *) echo '{}' ;;",
      "esac"
    ].join("\n"),
    { mode: 0o755 }
  );
  return { fixturePath, ghPath };
}

const { fixturePath } = installFakeGh();
function setFakeComments(pages: unknown[][] | unknown[]): void {
  // --slurp shape: an outer array wrapping each page.
  fs.writeFileSync(fixturePath, JSON.stringify(Array.isArray(pages[0]) ? pages : [pages]));
}

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    cwd: workDir,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` }
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("cli argument and parsing helpers", () => {
  it("parses single values, repeatable flags, and bare flags", () => {
    const parsed = parseArgs([
      "open",
      "--issue",
      "a/b#1",
      "--authority",
      "ref-1",
      "--authority",
      "ref-2",
      "--post",
      "--kind",
      "NEEDS_DESIGN"
    ]);
    expect(parsed.command).toBe("open");
    expect(parsed.values.get("issue")).toBe("a/b#1");
    expect(parsed.values.get("authority")).toEqual(["ref-1", "ref-2"]);
    expect(parsed.flags.has("post")).toBe(true);
  });

  it("derives a per-issue default ledger path", () => {
    expect(defaultLedgerPath("futouyiba/noos-shuttle#10")).toBe(
      path.join(".noos", "runtime", "mailbox", "futouyiba__noos-shuttle__issue-10.json")
    );
  });

  it("maps provenance wire json to core input", () => {
    const provenance = parseProvenanceInput(
      JSON.stringify({
        repository: "a/b",
        pull_request_head_sha: "a49303cabf436f3398a596685d36d2792e6a08a1",
        path_refs: ["docs/x.md@a49303cabf436f3398a596685d36d2792e6a08a1"]
      })
    );
    expect(provenance).toEqual({
      repository: "a/b",
      issueRef: undefined,
      pullRequestRef: undefined,
      pullRequestHeadSha: "a49303cabf436f3398a596685d36d2792e6a08a1",
      commitSha: undefined,
      pathRefs: ["docs/x.md@a49303cabf436f3398a596685d36d2792e6a08a1"],
      blobRefs: []
    });
  });

  it("flattens single-page and multi-page (slurped) gh api comment output", () => {
    const page = [{ id: 1, user: { login: "u" }, updated_at: "t1", body: "b1" }];
    expect(parsePaginatedComments(JSON.stringify([page]), "a/b#1")).toEqual([
      { commentRef: "a/b#1/comment/1", author: "u", updatedAt: "t1", body: "b1" }
    ]);
    const twoPages = parsePaginatedComments(JSON.stringify([page, [{ id: 2, user: { login: "v" }, updated_at: "t2", body: "b2" }]]), "a/b#1");
    expect(twoPages.map((comment) => comment.commentRef)).toEqual(["a/b#1/comment/1", "a/b#1/comment/2"]);
  });
});

describe("cli mailbox flow with a fake gh", () => {
  const ledger = path.join(workDir, "ledger.json");
  const provenance = JSON.stringify({
    repository: "futouyiba/noos-shuttle",
    pull_request_head_sha: "a49303cabf436f3398a596685d36d2792e6a08a1",
    path_refs: ["docs/deliberation-harness/cross-agent-handoff-escalation-contract-v3.md@a49303cabf436f3398a596685d36d2792e6a08a1"]
  });
  const openArgs = [
    "open",
    "--issue",
    "futouyiba/noos-shuttle#10",
    "--escalation-id",
    "esc-cli-1",
    "--kind",
    "NEEDS_DESIGN",
    "--source-role",
    "IMPLEMENTATION",
    "--destination-role",
    "PRIMARY_DESIGN",
    "--source-operation",
    "futouyiba/noos-shuttle#21",
    "--authority-basis",
    "futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1",
    "--blocker",
    "CLI blocker",
    "--question",
    "CLI question?",
    "--provenance",
    provenance,
    "--goal",
    "CLI goal",
    "--scope",
    "CLI scope",
    "--return",
    "One result marker",
    "--stop",
    "Stop after posting",
    "--ledger",
    ledger
  ];

  it("runs init/open dry, then discover and observe against fake gh comments", () => {
    const init = runCli(["init", "--ledger", ledger]);
    expect(init.status).toBe(0);

    const opened = runCli(openArgs);
    expect(opened.status).toBe(0);
    expect(opened.stdout).toContain("esc-cli-1/packet/r1");
    const markerBody = opened.stdout.split("--- marker body ---\n")[1];

    const rerun = runCli(openArgs);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain("esc-cli-1/packet/r1");
    expect(rerun.stdout.split("--- marker body ---\n")[1]).toBe(markerBody);

    setFakeComments([[{ id: 100, user: { login: "impl-agent" }, updated_at: "2026-09-16T00:00:00Z", body: markerBody }]]);
    const discovered = runCli(["discover", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger]);
    expect(discovered.status, `stderr: ${discovered.stderr}`).toBe(0);
    expect(discovered.stdout).toContain("esc-cli-1");
    expect(discovered.stdout).toContain("blocking");

    const result = runCli([
      "render-result",
      "--escalation",
      "esc-cli-1",
      "--packet",
      "esc-cli-1/packet/r1",
      "--result-id",
      "res-cli-1",
      "--source-role",
      "PRIMARY_DESIGN",
      "--authority-role",
      "PRIMARY_DESIGN",
      "--status",
      "COMPLETE",
      "--summary",
      "CLI adjudication: proceed.",
      "--next-action",
      "Continue the same operation."
    ]);
    expect(result.status).toBe(0);
    const resultBody = result.stdout.split("--- result marker body ---\n")[1];

    setFakeComments([
      [
        { id: 100, user: { login: "impl-agent" }, updated_at: "2026-09-16T00:00:00Z", body: markerBody },
        { id: 101, user: { login: "design-agent" }, updated_at: "2026-09-16T01:00:00Z", body: resultBody }
      ]
    ]);
    const observed = runCli(["observe", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger]);
    expect(observed.status).toBe(0);
    expect(observed.stdout).toContain("res-cli-1");
    expect(observed.stdout).toContain("SAME source operation");

    const afterDiscover = runCli(["discover", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger]);
    expect(afterDiscover.status).toBe(0);
    expect(afterDiscover.stdout).toContain("observed");
    expect(afterDiscover.stdout).not.toContain("NOT yet observed");

    const shown = runCli(["show", "--escalation", "esc-cli-1", "--ledger", ledger]);
    expect(shown.status).toBe(0);
    const state = JSON.parse(shown.stdout);
    expect(state.resultObservations).toHaveLength(1);
    expect(state.resultObservations[0].resultId).toBe("res-cli-1");
  });

  it("requires --escalation-id for open with a friendly error", () => {
    const withoutId = runCli(openArgs.filter((arg, index) => arg !== "--escalation-id" && openArgs[index - 1] !== "--escalation-id"));
    expect(withoutId.status).toBe(1);
    expect(withoutId.stderr).toContain("--escalation-id is required");
  });

  it("surfaces core integrity anomalies in discover output (C3)", () => {
    const reopened = runCli(openArgs);
    expect(reopened.status).toBe(0);
    const markerBody = reopened.stdout.split("--- marker body ---\n")[1];
    const wire = JSON.parse(markerBody.slice(markerBody.indexOf("{"), markerBody.lastIndexOf("}") + 1));
    wire.escalation.question = "TAMPERED question?";
    const tamperedPacketBody = "```noos-mailbox\n" + JSON.stringify(wire, null, 2) + "\n```";

    setFakeComments([[{ id: 100, user: { login: "impl-agent" }, updated_at: "2026-09-16T00:00:00Z", body: tamperedPacketBody }]]);
    const tamperedDiscover = runCli(["discover", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger]);
    expect(tamperedDiscover.status).toBe(0);
    expect(tamperedDiscover.stdout).toContain("INTEGRITY: live escalation payload does not match the durable ledger Escalation");
    expect(tamperedDiscover.stdout).toContain("INTEGRITY: escalation_fingerprint claim does not match its own content");

    const result = runCli([
      "render-result",
      "--escalation",
      "esc-cli-1",
      "--packet",
      "esc-cli-1/packet/r1",
      "--result-id",
      "res-cli-c3",
      "--source-role",
      "PRIMARY_DESIGN",
      "--authority-role",
      "PRIMARY_DESIGN",
      "--status",
      "COMPLETE",
      "--summary",
      "C3 adjudication.",
      "--next-action",
      "Continue the same operation."
    ]);
    expect(result.status).toBe(0);
    const resultBody = result.stdout.split("--- result marker body ---\n")[1];
    setFakeComments([
      [
        { id: 100, user: { login: "impl-agent" }, updated_at: "2026-09-16T00:00:00Z", body: markerBody },
        { id: 299, user: { login: "design-agent" }, updated_at: "2026-09-16T01:30:00Z", body: resultBody }
      ]
    ]);
    const honestObserve = runCli(["observe", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger]);
    expect(honestObserve.status).toBe(0);
    expect(honestObserve.stdout).toContain("res-cli-c3");

    const resultWire = JSON.parse(resultBody.slice(resultBody.indexOf("{"), resultBody.lastIndexOf("}") + 1));
    resultWire.result.summary = "TAMPERED summary; declared fingerprint retained.";
    const tamperedResultBody = "```noos-mailbox\n" + JSON.stringify(resultWire, null, 2) + "\n```";
    setFakeComments([
      [
        { id: 100, user: { login: "impl-agent" }, updated_at: "2026-09-16T00:00:00Z", body: markerBody },
        { id: 300, user: { login: "design-agent" }, updated_at: "2026-09-16T02:00:00Z", body: tamperedResultBody }
      ]
    ]);
    const observed = runCli(["observe", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger]);
    expect(observed.status).toBe(0);
    expect(observed.stdout).toContain("INTEGRITY ANOMALY [RESULT_FINGERPRINT_CLAIM_MISMATCH]");
    expect(observed.stdout).toContain("CONFLICT");
    // P3a: an anomalous/conflicting result gets a HOLD line, never resume boilerplate.
    expect(observed.stdout).toContain("HOLD —");
    expect(observed.stdout).not.toContain("resume instruction:");
    const afterDiscover = runCli(["discover", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger]);
    expect(afterDiscover.status).toBe(0);
    expect(afterDiscover.stdout).toContain("INTEGRITY ANOMALY [RESULT_FINGERPRINT_CLAIM_MISMATCH]");
    expect(afterDiscover.stdout).toContain("PENDING CONFLICT");
    // Discover-side gate: the conflicted tampered variant is not observed (P3b),
    // so nothing is offered as a resume basis — the fail-closed waiting variant prints.
    expect(afterDiscover.stdout).toContain("NOT yet observed");
    expect(afterDiscover.stdout).not.toContain("SAME source operation");
  });

  it("holds resume when a clean result sits beside a tampered live packet copy (reviewer counterexample)", () => {
    const ledger2 = path.join(workDir, "ledger-hg.json");
    const openArgs2 = openArgs.map((arg) => (arg === ledger ? ledger2 : arg)).map((arg, index) =>
      openArgs[index - 1] === "--escalation-id" ? "esc-hg-1" : arg
    );
    const init = runCli(["init", "--ledger", ledger2]);
    expect(init.status).toBe(0);
    const opened = runCli(openArgs2);
    expect(opened.status).toBe(0);
    const markerBody = opened.stdout.split("--- marker body ---\n")[1];
    const wire = JSON.parse(markerBody.slice(markerBody.indexOf("{"), markerBody.lastIndexOf("}") + 1));
    wire.escalation.question = "TAMPERED question?";
    const tamperedPacketBody = "```noos-mailbox\n" + JSON.stringify(wire, null, 2) + "\n```";

    const result = runCli([
      "render-result",
      "--escalation",
      "esc-hg-1",
      "--packet",
      "esc-hg-1/packet/r1",
      "--result-id",
      "res-hg-1",
      "--source-role",
      "PRIMARY_DESIGN",
      "--authority-role",
      "PRIMARY_DESIGN",
      "--status",
      "COMPLETE",
      "--summary",
      "Clean adjudication.",
      "--next-action",
      "Continue the same operation."
    ]);
    expect(result.status).toBe(0);
    const resultBody = result.stdout.split("--- result marker body ---\n")[1];

    setFakeComments([
      [
        { id: 50, user: { login: "impl-agent" }, updated_at: "2026-09-16T00:00:00Z", body: tamperedPacketBody },
        { id: 100, user: { login: "impl-agent" }, updated_at: "2026-09-16T00:00:00Z", body: markerBody },
        { id: 101, user: { login: "design-agent" }, updated_at: "2026-09-16T01:00:00Z", body: resultBody }
      ]
    ]);
    const observed = runCli(["observe", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger2]);
    expect(observed.status).toBe(0);
    expect(observed.stdout).toContain("HOLD —");
    expect(observed.stdout).not.toContain("SAME source operation");
    const discovered = runCli(["discover", "--issue", "futouyiba/noos-shuttle#10", "--ledger", ledger2]);
    expect(discovered.status).toBe(0);
    expect(discovered.stdout).toContain("HOLD —");
    expect(discovered.stdout).not.toContain("SAME source operation");
  });
});
