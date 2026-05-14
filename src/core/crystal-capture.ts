import { parseMarkdownFrontmatter } from "./frontmatter";
import {
  type CrystalCaptureResult,
  NOOS_CRYSTAL_BEGIN_MARKER,
  NOOS_CRYSTAL_END_MARKER,
  type NoosCrystal,
  type NoosCrystalFrontmatter
} from "./noos-crystal";
import { slugify } from "./filename";

const REQUIRED_SECTION_GROUPS = [
  ["## 已确认结论", "## Confirmed Conclusions"],
  ["## 合理推断", "## Reasonable Inferences"],
  ["## 未决问题", "## Open Questions"],
  ["## 下一轮最值得继续讨论的 3 个入口", "## 3 Best Entry Points for the Next Round"]
];

export function captureNoosCrystals(source: string, detectedAt = new Date().toISOString()): CrystalCaptureResult {
  const crystals: NoosCrystal[] = [];
  const errors: string[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const begin = source.indexOf(NOOS_CRYSTAL_BEGIN_MARKER, searchFrom);
    if (begin === -1) {
      break;
    }

    const endMarkerStart = source.indexOf(NOOS_CRYSTAL_END_MARKER, begin + NOOS_CRYSTAL_BEGIN_MARKER.length);
    if (endMarkerStart === -1) {
      errors.push("Found a NOOS crystal begin marker without a matching end marker.");
      break;
    }

    const end = endMarkerStart + NOOS_CRYSTAL_END_MARKER.length;
    const rawMarkdown = source.slice(begin, end).trim();
    const markdownForParsing = rawMarkdown
      .replace(NOOS_CRYSTAL_BEGIN_MARKER, "")
      .replace(NOOS_CRYSTAL_END_MARKER, "")
      .trim();
    const parsed = parseMarkdownFrontmatter(markdownForParsing);
    const frontmatter = parsed.frontmatter as NoosCrystalFrontmatter | undefined;
    const title = deriveTitle(frontmatter?.title, parsed.bodyMarkdown);
    const summary = deriveSummary(frontmatter?.summary, parsed.bodyMarkdown);
    const key = deriveKey(frontmatter?.crystal_key, title, detectedAt, begin);
    const warnings = validateCrystal(frontmatter, parsed.bodyMarkdown, parsed.warnings);

    crystals.push({
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

  return { crystals, errors };
}

function deriveTitle(frontmatterTitle: string | undefined, bodyMarkdown: string): string {
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = bodyMarkdown.match(/^#\s+(?:Crystal|结晶|讨论快照)[：:]?\s*(.+)$/im);
  return heading?.[1]?.trim() || "Untitled NOOS Crystal";
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
  return `${date}-${slugify(title) || "noos-crystal"}-${markerBegin}`;
}

function validateCrystal(
  frontmatter: NoosCrystal["frontmatter"],
  bodyMarkdown: string,
  existingWarnings: string[]
): string[] {
  const warnings = [...existingWarnings];

  if (frontmatter?.type !== "noos_crystal") {
    warnings.push("Frontmatter should include type: noos_crystal.");
  }
  if (frontmatter?.version !== "0.1") {
    warnings.push("Frontmatter should include version: 0.1.");
  }
  if (!frontmatter?.crystal_key) {
    warnings.push("Frontmatter should include crystal_key.");
  }
  if (!frontmatter?.summary) {
    warnings.push("Frontmatter should include summary.");
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
