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
  ["## Suggested Next-Agent Instructions", "## 建议给下一位代理的指令"],
  ["## Open Questions", "## 未决问题"]
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
    const rawMarkdown = source.slice(begin, end).trim();
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
    if (!sectionGroup.some((section) => bodyMarkdown.includes(section))) {
      warnings.push(`Missing required section: ${sectionGroup.join(" / ")}.`);
    }
  }

  return warnings;
}
