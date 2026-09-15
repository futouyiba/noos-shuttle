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
});
