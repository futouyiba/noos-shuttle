import type { NoosThreadFrontmatter } from "./noos-thread";

export interface ParsedMarkdown {
  frontmatter?: NoosThreadFrontmatter;
  bodyMarkdown: string;
  warnings: string[];
}

export function parseMarkdownFrontmatter(markdown: string): ParsedMarkdown {
  const withoutMarkers = markdown
    .replace(/^\s*<!-- NOOS:THREAD:BEGIN -->\s*/, "")
    .replace(/\s*<!-- NOOS:THREAD:END -->\s*$/, "")
    .trim();

  if (!withoutMarkers.startsWith("---")) {
    return {
      bodyMarkdown: withoutMarkers,
      warnings: ["Missing YAML frontmatter."]
    };
  }

  const endIndex = withoutMarkers.indexOf("\n---", 3);
  if (endIndex === -1) {
    return {
      bodyMarkdown: withoutMarkers,
      warnings: ["YAML frontmatter is not closed."]
    };
  }

  const frontmatterText = withoutMarkers.slice(3, endIndex).trim();
  const bodyMarkdown = withoutMarkers.slice(endIndex + 4).trim();

  return {
    frontmatter: parseSimpleYaml(frontmatterText),
    bodyMarkdown,
    warnings: []
  };
}

function parseSimpleYaml(source: string): NoosThreadFrontmatter {
  const frontmatter: Record<string, string | string[]> = {};

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => cleanYamlScalar(item.trim()))
        .filter(Boolean);
    } else {
      frontmatter[key] = cleanYamlScalar(value);
    }
  }

  return frontmatter as NoosThreadFrontmatter;
}

function cleanYamlScalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}
