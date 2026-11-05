import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Issue #152 finding F3: the Downloads mirror writes Results to
 * `Downloads/NOOS/vault/results/inbox/`, and the Hub's "Import Browser Mirror"
 * action runs this script. It must import Results too, or the recovery hint
 * points at an action that silently drops the file.
 */

const SCRIPT = path.resolve("scripts/noos-import-browser-vault.sh");
const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function sandbox(): { home: string; noosHome: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noos-import-browser-vault-"));
  sandboxes.push(root);
  const home = path.join(root, "home");
  const noosHome = path.join(root, "noos-home");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(noosHome, { recursive: true });
  return { home, noosHome };
}

function writeFixture(home: string, relativePath: string, content: string): string {
  const file = path.join(home, "Downloads", relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const RESULT_MARKDOWN = `<!-- NOOS:RESULT:BEGIN -->
---
type: noos_result
version: 0.1
result_key: shortest-loop-result
title: Shortest Loop Result
summary: Imported through the browser mirror.
---

# 结果：Shortest Loop Result

The loop closed.
<!-- NOOS:RESULT:END -->`;

describe("browser vault importer", () => {
  it("imports Result files from the Downloads mirror into the local vault", () => {
    const { home, noosHome } = sandbox();
    writeFixture(home, "NOOS/vault/results/inbox/shortest-loop-result.md", RESULT_MARKDOWN);
    // A Result-shaped file without the marker pair must be skipped.
    writeFixture(home, "NOOS/vault/results/inbox/not-a-result.md", "# Not a Result\n");

    const run = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, NOOS_HOME: noosHome }
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Imported 1 Result file(s).");
    expect(run.stdout).toContain("Skipped 1 markdown file(s) without expected NOOS markers.");

    const imported = path.join(noosHome, "vault/results/inbox/shortest-loop-result.md");
    expect(fs.readFileSync(imported, "utf8")).toBe(RESULT_MARKDOWN);
    expect(fs.existsSync(path.join(noosHome, "vault/results/inbox/not-a-result.md"))).toBe(false);
  });

  it("keeps importing Handoff, Crystal and Context Pack mirrors", () => {
    const { home, noosHome } = sandbox();
    writeFixture(
      home,
      "NOOS/vault/handoffs/active/handoff.md",
      "<!-- NOOS:THREAD:BEGIN -->\n---\ntype: noos_thread\n---\n# Handoff\n<!-- NOOS:THREAD:END -->"
    );
    writeFixture(
      home,
      "NOOS/vault/crystals/active/crystal.md",
      "<!-- NOOS:CRYSTAL:BEGIN -->\n---\ntype: noos_crystal\n---\n# Crystal\n<!-- NOOS:CRYSTAL:END -->"
    );
    writeFixture(home, "NOOS/vault/context-packs/pack/manifest.yaml", "type: noos_context_pack\n");
    writeFixture(home, "NOOS/vault/results/inbox/result.md", RESULT_MARKDOWN);

    const run = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, NOOS_HOME: noosHome }
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Imported 1 Handoff file(s).");
    expect(run.stdout).toContain("Imported 1 Crystal file(s).");
    expect(run.stdout).toContain("Imported 1 Result file(s).");
    expect(run.stdout).toContain("Imported 1 Context Pack(s).");
    expect(fs.existsSync(path.join(noosHome, "vault/handoffs/active/handoff.md"))).toBe(true);
    expect(fs.existsSync(path.join(noosHome, "vault/crystals/active/crystal.md"))).toBe(true);
    expect(fs.existsSync(path.join(noosHome, "vault/results/inbox/result.md"))).toBe(true);
    expect(fs.existsSync(path.join(noosHome, "vault/context-packs/pack/manifest.yaml"))).toBe(true);
  });
});
