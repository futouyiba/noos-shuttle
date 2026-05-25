import { parseMarkdownFrontmatter } from "./frontmatter";
import {
  type CaptureResult,
  NOOS_BEGIN_MARKER,
  NOOS_END_MARKER,
  type NoosThread
} from "./noos-thread";

const REQUIRED_SECTION_GROUPS = [
  ["## Intent", "## 意图"],
  ["## Context Summary", "## 背景摘要"],
  ["## Task", "## 任务"],
  ["## Constraints", "## 约束"],
  ["## Acceptance Criteria", "## 验收标准"],
  [
    "## Suggested Next-Agent Instructions",
    "## 建议给下一位代理的指令",
    "## 给下一位代理的建议",
    "## 后续代理指令",
    "## 下一步指令",
    "## Next-Agent Instructions"
  ],
  ["## Open Questions", "## 未决问题", "## 开放问题", "## 待确认问题", "## 问题"]
];

export function captureNoosThreads(source: string, detectedAt = new Date().toISOString()): CaptureResult {
  const threads: NoosThread[] = [];
  const errors: string[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const begin = source.indexOf(NOOS_BEGIN_MARKER, searchFrom);
    if (begin === -1) {
      break;
    }

    const endMarkerStart = source.indexOf(NOOS_END_MARKER, begin + NOOS_BEGIN_MARKER.length);
    if (endMarkerStart === -1) {
      errors.push("Found a NOOS begin marker without a matching end marker.");
      break;
    }

    const end = endMarkerStart + NOOS_END_MARKER.length;
    const rawMarkdown = normalizeCapturedThread(source.slice(begin, end)).trim();
    if (isPlaceholderThread(rawMarkdown)) {
      searchFrom = end;
      continue;
    }

    const parsed = parseMarkdownFrontmatter(rawMarkdown);
    const title = deriveTitle(parsed.frontmatter?.title, parsed.bodyMarkdown);
    const warnings = validateThread(parsed.frontmatter, parsed.bodyMarkdown, parsed.warnings);

    threads.push({
      id: `${detectedAt}-${begin}`,
      title,
      rawMarkdown,
      frontmatter: parsed.frontmatter,
      bodyMarkdown: parsed.bodyMarkdown,
      markerRange: { begin, end },
      detectedAt,
      warnings
    });

    searchFrom = end;
  }

  return { threads, errors };
}

function normalizeCapturedThread(rawMarkdown: string): string {
  const firstFence = rawMarkdown.indexOf("---");
  if (firstFence === -1) {
    return rawMarkdown;
  }

  const secondFence = rawMarkdown.indexOf("\n---", firstFence + 3);
  if (secondFence === -1) {
    return rawMarkdown;
  }

  const beforeFrontmatter = rawMarkdown.slice(0, firstFence + 3);
  const frontmatter = rawMarkdown.slice(firstFence + 3, secondFence);
  const afterFrontmatter = rawMarkdown.slice(secondFence);
  const repairedFrontmatter = repairFrontmatterLineBreaks(frontmatter);

  return `${beforeFrontmatter}${repairedFrontmatter}${afterFrontmatter}`;
}

function repairFrontmatterLineBreaks(frontmatter: string): string {
  const frontmatterKeys = [
    "type",
    "version",
    "handoff_revision",
    "source_app",
    "source_url",
    "target_agent",
    "status",
    "created_at",
    "title",
    "handoff_key",
    "filename_slug",
    "tags",
    "preferred_path"
  ];
  const keyPattern = frontmatterKeys.join("|");
  const lines = frontmatter.split(/\r?\n/);
  const repaired: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    const emptyValue = line.match(new RegExp(`^(${keyPattern}):\\s*$`));

    if (emptyValue && nextLine.trim() && !new RegExp(`^\\s*(?:-|${keyPattern}:)`).test(nextLine.trim())) {
      repaired.push(`${emptyValue[1]}: ${nextLine.trim()}`);
      index += 1;
      continue;
    }

    repaired.push(line);
  }

  return repaired
    .join("\n")
    .replace(new RegExp(`([^\\n])\\s+((?:${keyPattern}):\\s+)`, "g"), "$1\n$2")
    .replace(new RegExp(`(\\n\\s*-\\s+[^\\n]*?)\\s+((?:${keyPattern}):\\s+)`, "g"), "$1\n$2");
}

function isPlaceholderThread(rawMarkdown: string): boolean {
  const withoutMarkers = rawMarkdown
    .replace(/^\s*<!-- NOOS:THREAD:BEGIN -->\s*/, "")
    .replace(/\s*<!-- NOOS:THREAD:END -->\s*$/, "")
    .trim();
  const withoutCodeTicks = withoutMarkers.replace(/^`+\s*/, "").replace(/\s*`+$/, "").trim();

  return withoutCodeTicks === "..." || withoutCodeTicks === "…";
}

function deriveTitle(frontmatterTitle: string | undefined, bodyMarkdown: string): string {
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = bodyMarkdown.match(/^#\s+Thread:\s*(.+)$/im);
  if (heading?.[1]) {
    return heading[1].trim();
  }

  const chineseHeading = bodyMarkdown.match(/^#\s+交接[：:]\s*(.+)$/im);
  if (chineseHeading?.[1]) {
    return chineseHeading[1].trim();
  }

  return "Untitled NOOS Thread";
}

function validateThread(
  frontmatter: NoosThread["frontmatter"],
  bodyMarkdown: string,
  existingWarnings: string[]
): string[] {
  const warnings = [...existingWarnings];

  if (frontmatter?.type !== "noos_thread") {
    warnings.push("Frontmatter should include type: noos_thread.");
  }
  if (frontmatter?.version !== "0.1") {
    warnings.push("Frontmatter should include version: 0.1.");
  }
  if (!frontmatter?.title && !/^#\s+Thread:\s*.+$/im.test(bodyMarkdown)) {
    warnings.push("Thread title was not found.");
  }

  for (const sectionGroup of REQUIRED_SECTION_GROUPS) {
    if (!sectionGroup.some((section) => hasMarkdownHeading(bodyMarkdown, section))) {
      warnings.push(`Missing required section: ${sectionGroup.join(" / ")}.`);
    }
  }

  return warnings;
}

function hasMarkdownHeading(bodyMarkdown: string, heading: string): boolean {
  const normalizedHeading = heading.replace(/^#+\s*/, "").trim();
  const pattern = new RegExp(`^#{2,6}\\s+${escapeRegExp(normalizedHeading)}\\s*$`, "im");
  return pattern.test(bodyMarkdown);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
