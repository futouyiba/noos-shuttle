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
  let currentKey: string | undefined;

  for (const line of source.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentKey) {
      const currentValue = frontmatter[currentKey];
      const nextValue = cleanYamlScalar(listItem[1].trim());
      frontmatter[currentKey] = Array.isArray(currentValue)
        ? [...currentValue, nextValue]
        : [nextValue].filter(Boolean);
      continue;
    }

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
      currentKey = key;
    } else {
      frontmatter[key] = cleanYamlScalar(value);
      currentKey = value ? undefined : key;
    }
  }

  return frontmatter as NoosThreadFrontmatter;
}

function cleanYamlScalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}
