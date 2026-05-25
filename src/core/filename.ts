import type { NoosThread } from "./noos-thread";

export function createThreadFilename(title: string, date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  const slug = slugify(title) || "noos-thread";
  return `${isoDate}-${slug}.md`;
}

export function createThreadFilenameFromThread(thread: NoosThread, date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  const slug =
    slugify(thread.frontmatter?.filename_slug ?? "") ||
    slugify(thread.frontmatter?.handoff_key ?? "") ||
    usableTitleSlug(thread.title) ||
    deriveAsciiSlugFromMarkdown(thread.bodyMarkdown) ||
    "noos-thread";
  return `${isoDate}-${slug}.md`;
}

export function createCrystalFilename(titleOrKey: string, date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  const slug = slugify(titleOrKey) || "noos-crystal";
  return `${isoDate}-${slug}.md`;
}

export function createPreferredPath(title: string, date = new Date()): string {
  return `.noos/handoffs/active/${createThreadFilename(title, date)}`;
}

export function createCrystalPreferredPath(titleOrKey: string, date = new Date()): string {
  return `.noos/crystals/active/${createCrystalFilename(titleOrKey, date)}`;
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

function deriveAsciiSlugFromMarkdown(markdown: string): string {
  const taskSection = extractSection(markdown, ["任务", "Task"]);
  const intentSection = extractSection(markdown, ["意图", "Intent"]);
  const contextSection = extractSection(markdown, ["背景摘要", "Context Summary"]);
  const candidate = [taskSection, intentSection, contextSection, markdown].filter(Boolean).join(" ");
  const terms = candidate.match(/[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*/g) ?? [];
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "then",
    "will",
    "should",
    "none",
    "markdown",
    "noos",
    "thread",
    "handoff"
  ]);
  const uniqueTerms: string[] = [];

  for (const term of terms) {
    const normalized = term.toLowerCase();
    if (normalized.length < 3 || stopWords.has(normalized) || uniqueTerms.includes(normalized)) {
      continue;
    }
    uniqueTerms.push(normalized);
    if (uniqueTerms.length >= 8) {
      break;
    }
  }

  return uniqueTerms.length >= 2 ? uniqueTerms.join("-").slice(0, 80) : "";
}

function usableTitleSlug(title: string): string {
  const slug = slugify(title);
  const genericSlugs = new Set(["noos-thread", "thread", "handoff", "noos-handoff", "untitled-noos-thread"]);
  return genericSlugs.has(slug) ? "" : slug;
}

function extractSection(markdown: string, headings: string[]): string {
  for (const heading of headings) {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|\\s*$)`, "im");
    const match = markdown.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
