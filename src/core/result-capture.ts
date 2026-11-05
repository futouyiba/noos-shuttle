import { parseMarkdownFrontmatter } from "./frontmatter";
import { slugify } from "./filename";
import {
  type NoosResult,
  type NoosResultFrontmatter,
  NOOS_RESULT_BEGIN_MARKER,
  NOOS_RESULT_END_MARKER,
  type ResultCaptureResult
} from "./noos-result";

/**
 * Capture predicate for chatbot-returned `NOOS:RESULT` objects (issue #152).
 * It is the same marker shape as `captureNoosThreads` / `captureNoosCrystals`:
 * find a begin marker, find the matching end marker, keep the exact bytes in
 * between. Missing markers are simply "nothing to capture"; an unclosed begin
 * marker is an error, and placeholder blocks are ignored.
 */
export function captureNoosResults(source: string, detectedAt = new Date().toISOString()): ResultCaptureResult {
  const results: NoosResult[] = [];
  const errors: string[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const begin = source.indexOf(NOOS_RESULT_BEGIN_MARKER, searchFrom);
    if (begin === -1) {
      break;
    }

    const endMarkerStart = source.indexOf(NOOS_RESULT_END_MARKER, begin + NOOS_RESULT_BEGIN_MARKER.length);
    if (endMarkerStart === -1) {
      errors.push("Found a NOOS result begin marker without a matching end marker.");
      break;
    }

    const end = endMarkerStart + NOOS_RESULT_END_MARKER.length;
    const rawMarkdown = normalizeCapturedResult(source.slice(begin, end).trim());
    if (isPlaceholderResult(rawMarkdown)) {
      searchFrom = end;
      continue;
    }

    const markdownForParsing = rawMarkdown
      .replace(NOOS_RESULT_BEGIN_MARKER, "")
      .replace(NOOS_RESULT_END_MARKER, "")
      .trim();
    const parsed = parseMarkdownFrontmatter(markdownForParsing);
    const frontmatter = parsed.frontmatter as NoosResultFrontmatter | undefined;
    const title = deriveTitle(frontmatter?.title, parsed.bodyMarkdown);
    const summary = deriveSummary(frontmatter?.summary, parsed.bodyMarkdown);
    const key = deriveKey(frontmatter?.result_key, title, detectedAt, begin);
    const warnings = validateResult(frontmatter, parsed.bodyMarkdown, parsed.warnings);

    results.push({
      id: `${detectedAt}-${begin}`,
      title,
      key,
      summary,
      rawMarkdown,
      frontmatter,
      bodyMarkdown: parsed.bodyMarkdown,
      markerRange: { begin, end },
      detectedAt,
      warnings
    });

    searchFrom = end;
  }

  return { results, errors };
}

function normalizeCapturedResult(rawMarkdown: string): string {
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(NOOS_RESULT_BEGIN_MARKER)}\\s*` +
      "```(?:markdown|md)?\\s*\\n" +
      "([\\s\\S]*?)\\n```\\s*" +
      `${escapeRegExp(NOOS_RESULT_END_MARKER)}\\s*$`,
    "i"
  );
  const match = rawMarkdown.match(pattern);
  const unfenced = match?.[1] ? `${NOOS_RESULT_BEGIN_MARKER}\n${match[1].trim()}\n${NOOS_RESULT_END_MARKER}` : rawMarkdown;
  return repairHeadingFrontmatterWithoutClosingFence(unfenced);
}

/**
 * ChatGPT sometimes renders YAML frontmatter as a heading and drops the
 * closing fence. Repair that shape before parsing, exactly as the crystal
 * capture does, so a rendered result is still structured rather than silently
 * losing its key and metadata.
 */
function repairHeadingFrontmatterWithoutClosingFence(rawMarkdown: string): string {
  const openingFence = rawMarkdown.indexOf("---");
  if (openingFence === -1 || rawMarkdown.indexOf("\n---", openingFence + 3) !== -1) {
    return rawMarkdown;
  }

  const afterFence = rawMarkdown.slice(openingFence + 3);
  const headingFrontmatter = afterFence.match(/^\s*#{1,6}\s+(type:\s+noos_result\b[\s\S]*?)(?=\n#\s+)/);
  if (!headingFrontmatter?.[1]) {
    return rawMarkdown;
  }

  const bodyStart = openingFence + 3 + headingFrontmatter[0].length;
  return `${rawMarkdown.slice(0, openingFence + 3)}\n${repairFrontmatterLineBreaks(headingFrontmatter[1])}\n---${rawMarkdown.slice(bodyStart)}`;
}

function repairFrontmatterLineBreaks(frontmatter: string): string {
  const frontmatterKeys = [
    "type",
    "version",
    "source_app",
    "source_url",
    "status",
    "created_at",
    "result_key",
    "title",
    "summary",
    "producer",
    "input_refs",
    "review_status",
    "promotes_to",
    "tags",
    "preferred_path"
  ];
  const keyPattern = frontmatterKeys.join("|");

  return frontmatter.replace(new RegExp(`([^\\n])\\s+((?:${keyPattern}):\\s+)`, "g"), "$1\n$2");
}

function isPlaceholderResult(rawMarkdown: string): boolean {
  const withoutMarkers = rawMarkdown
    .replace(/^\s*<!-- NOOS:RESULT:BEGIN -->\s*/, "")
    .replace(/\s*<!-- NOOS:RESULT:END -->\s*$/, "")
    .trim();
  const withoutCodeTicks = withoutMarkers
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^`+\s*/, "")
    .replace(/\s*`+$/, "")
    .trim();

  return (
    withoutCodeTicks === "..." ||
    withoutCodeTicks === "…" ||
    withoutCodeTicks === "<result markdown>" ||
    withoutCodeTicks === "<结果 markdown>" ||
    withoutCodeTicks === "<结果正文>" ||
    (!withoutCodeTicks.includes("---") && /^(\.{3}|…|<[^>]+>)$/u.test(withoutCodeTicks))
  );
}

function deriveTitle(frontmatterTitle: string | undefined, bodyMarkdown: string): string {
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = bodyMarkdown.match(/^#\s+(?:Result|NOOS Result|结果|NOOS 结果)[：:]?\s*(.+)$/im);
  return heading?.[1]?.trim() || "Untitled NOOS Result";
}

function deriveSummary(frontmatterSummary: string | undefined, bodyMarkdown: string): string {
  if (frontmatterSummary) {
    return frontmatterSummary;
  }

  const lines = bodyMarkdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("---"));
  return lines.slice(0, 2).join(" ").slice(0, 180);
}

function deriveKey(frontmatterKey: string | undefined, title: string, detectedAt: string, markerBegin: number): string {
  if (frontmatterKey) {
    return frontmatterKey;
  }

  const date = detectedAt.slice(0, 10).replace(/-/g, "");
  return `${date}-${slugify(title) || "noos-result"}-${markerBegin}`;
}

function validateResult(
  frontmatter: NoosResult["frontmatter"],
  bodyMarkdown: string,
  existingWarnings: string[]
): string[] {
  const warnings = [...existingWarnings];

  if (frontmatter?.type !== "noos_result") {
    warnings.push("Frontmatter should include type: noos_result.");
  }
  if (frontmatter?.version !== "0.1") {
    warnings.push("Frontmatter should include version: 0.1.");
  }
  if (!frontmatter?.result_key) {
    warnings.push("Frontmatter should include result_key.");
  }
  if (!frontmatter?.summary) {
    warnings.push("Frontmatter should include summary.");
  }
  if (!bodyMarkdown.trim()) {
    warnings.push("Result body is empty.");
  }

  return warnings;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
