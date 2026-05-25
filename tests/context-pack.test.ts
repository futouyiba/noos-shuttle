import { describe, expect, it } from "vitest";
import { createContextPack } from "../src/core/context-pack";
import type { BrowserTranscript } from "../src/core/transcript";
import type { NoosThread } from "../src/core/noos-thread";

const THREAD: NoosThread = {
  id: "thread-1",
  title: "Context Pack Test",
  rawMarkdown: "<!-- NOOS:THREAD:BEGIN -->\n# Thread: Context Pack Test\n<!-- NOOS:THREAD:END -->",
  bodyMarkdown: "# Thread: Context Pack Test",
  markerRange: { begin: 0, end: 72 },
  detectedAt: "2026-05-25T00:00:00.000Z",
  warnings: []
};

const TRANSCRIPT: BrowserTranscript = {
  title: "Context Pack Test",
  turns: [
    { id: "T001", role: "user", markdown: "Please preserve the transcript." },
    { id: "T002", role: "assistant", markdown: "Use a background layer." }
  ],
  markdown: "# Full Transcript: Context Pack Test\n\n## T001 user\n\nPlease preserve the transcript.\n",
  warnings: ["Transcript capture could not prove that the top of the conversation was reached."],
  capture: {
    method: "browser_shuttle_dom",
    completeness: "partial",
    topReached: false,
    bottomReached: true,
    partialReasons: ["top_not_confirmed"]
  }
};

describe("createContextPack", () => {
  it("creates the expected Context Pack file set and manifest", () => {
    const pack = createContextPack({
      title: "Context Pack Test",
      sourceUrl: "https://chatgpt.com/c/example",
      thread: THREAD,
      transcript: TRANSCRIPT,
      createdAt: new Date("2026-05-25T00:00:00.000Z")
    });

    expect(pack.id).toBe("ctx-20260525-context-pack-test");
    expect(pack.directory).toBe("2026-05-25-context-pack-test");
    expect(pack.files.map((file) => file.path)).toEqual([
      "manifest.yaml",
      "handoff.md",
      "transcript.full.md",
      "transcript.index.json",
      "key-excerpts.md",
      "decision-capsule.md",
      "execution-digest.md"
    ]);
    expect(pack.files[0].content).toContain("type: noos_context_pack");
    expect(pack.files[0].content).toContain('transcript_completeness: "partial"');
    expect(pack.files[2].content).toContain("## T001 user");
    expect(pack.files[3].content).toContain('"id": "T001"');
  });
});
