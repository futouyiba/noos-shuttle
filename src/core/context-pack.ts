import { slugify } from "./filename";
import type { NoosThread } from "./noos-thread";
import type { BrowserTranscript } from "./transcript";

export interface ContextPackFile {
  path: string;
  content: string;
}

export interface ContextPack {
  id: string;
  directory: string;
  title: string;
  files: ContextPackFile[];
  warnings: string[];
}

export interface ContextPackInput {
  title?: string;
  sourceUrl: string;
  sourceApp?: string;
  captureMethod?: string;
  thread: NoosThread;
  transcript: BrowserTranscript;
  createdAt?: Date;
}

export function createContextPack(input: ContextPackInput): ContextPack {
  const createdAt = input.createdAt ?? new Date();
  const date = createdAt.toISOString().slice(0, 10);
  const compactDate = date.replace(/-/g, "");
  const title = input.title?.trim() || input.thread.title || input.transcript.title || "NOOS Context Pack";
  const slug = slugify(title) || "noos-context-pack";
  const id = `ctx-${compactDate}-${slug}`;
  const directory = `${date}-${slug}`;
  const captureMethod = input.captureMethod ?? "browser_shuttle_dom";
  const sourceApp = input.sourceApp ?? "chatgpt";
  const warnings = [...input.transcript.warnings];

  const manifest = [
    "type: noos_context_pack",
    "version: 0.1",
    `id: ${yamlString(id)}`,
    `title: ${yamlString(title)}`,
    `created_at: ${yamlString(createdAt.toISOString())}`,
    `source_app: ${yamlString(sourceApp)}`,
    `source_url: ${yamlString(input.sourceUrl)}`,
    `capture_method: ${yamlString(captureMethod)}`,
    "status: active",
    "",
    "files:",
    "  handoff: handoff.md",
    "  transcript: transcript.full.md",
    "  index: transcript.index.json",
    "  key_excerpts: key-excerpts.md",
    "  decision_capsule: decision-capsule.md",
    "  execution_digest: execution-digest.md",
    "",
    "usage_policy:",
    "  default_read_order:",
    "    - manifest.yaml",
    "    - handoff.md",
    "    - decision-capsule.md",
    "    - key-excerpts.md",
    "    - transcript.index.json",
    "  do_not_read_full_transcript_by_default: true",
    "  read_transcript_only_when_needed: true",
    "",
    "capture:",
    `  method: ${yamlString(captureMethod)}`,
    `  page_url: ${yamlString(input.sourceUrl)}`,
    `  captured_at: ${yamlString(createdAt.toISOString())}`,
    `  rendered_turn_count: ${input.transcript.turns.length}`,
    `  transcript_completeness: ${yamlString(input.transcript.capture.completeness)}`,
    `  top_reached: ${input.transcript.capture.topReached}`,
    `  bottom_reached: ${input.transcript.capture.bottomReached}`,
    "  partial_reasons:",
    ...yamlList(input.transcript.capture.partialReasons, 4),
    "  excluded_regions:",
    "    - sidebar",
    "    - composer",
    "    - noos_shuttle_panel",
    "",
    "warnings:",
    ...yamlList(warnings, 2)
  ].join("\n");

  return {
    id,
    directory,
    title,
    warnings,
    files: [
      { path: "manifest.yaml", content: `${manifest}\n` },
      { path: "handoff.md", content: ensureTrailingNewline(input.thread.rawMarkdown) },
      { path: "transcript.full.md", content: ensureTrailingNewline(input.transcript.markdown) },
      { path: "transcript.index.json", content: `${JSON.stringify(createTranscriptIndex(input.transcript), null, 2)}\n` },
      { path: "key-excerpts.md", content: createPendingKeyExcerpts(input.transcript) },
      { path: "decision-capsule.md", content: createDecisionCapsule(input.thread, input.transcript) },
      { path: "execution-digest.md", content: "# Execution Digest\n\nPending.\n" }
    ]
  };
}

function createTranscriptIndex(transcript: BrowserTranscript): unknown {
  return {
    type: "noos_transcript_index",
    version: "0.1",
    title: transcript.title,
    generated_by: "browser_shuttle_heuristic",
    turns: transcript.turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      preview: turn.markdown.replace(/\s+/g, " ").trim().slice(0, 180)
    })),
    topics: []
  };
}

function createPendingKeyExcerpts(transcript: BrowserTranscript): string {
  return [
    "# Key Excerpts",
    "",
    "Pending.",
    "",
    `Captured turns: ${transcript.turns.length}.`,
    "Use transcript.index.json and targeted turns from transcript.full.md until excerpts are generated.",
    ""
  ].join("\n");
}

function createDecisionCapsule(thread: NoosThread, transcript: BrowserTranscript): string {
  return [
    "# Decision Capsule",
    "",
    "## Problem",
    "",
    "A ChatGPT discussion was captured with a short NOOS handoff and a transcript background layer.",
    "",
    "## Chosen Direction",
    "",
    "Use the handoff as the execution entry point. Use the full transcript only when details are unclear.",
    "",
    "## Constraints",
    "",
    "- Do not read transcript.full.md by default.",
    "- Start from handoff.md, then transcript.index.json and key-excerpts.md.",
    "- Preserve original transcript wording when resolving ambiguity.",
    "",
    "## Acceptance Criteria",
    "",
    "- Follow the captured handoff.",
    "- Query targeted transcript turns only when needed.",
    "- Write execution results back to execution-digest.md.",
    "",
    "## Build-Agent Brief",
    "",
    `Handoff title: ${thread.title}. Captured transcript turns: ${transcript.turns.length}.`,
    ""
  ].join("\n");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(values: string[], indent: number): string[] {
  const prefix = " ".repeat(indent);
  return values.length > 0 ? values.map((value) => `${prefix}- ${yamlString(value)}`) : [`${prefix}[]`];
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
