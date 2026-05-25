import { listDirectory, readFile, writeFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import { normalizePath } from "@/lib/path-utils"

export interface BidirectionalLinkBuildResult {
  pagesScanned: number
  pairsSuggested: number
  pairsApplied: number
  filesChanged: number
}

export interface BidirectionalLinkBuildOptions {
  pageIds?: string[]
  direction?: "outbound" | "bidirectional"
}

interface WikiPageSummary {
  id: string
  llmId: string
  title: string
  path: string
  content: string
}

interface LinkPair {
  source: string
  target: string
}

const EXCLUDED_PAGE_IDS = new Set(["index", "log"])
const MAX_PAGE_EXCERPT_CHARS = 1400

export async function buildBidirectionalWikiLinks(
  projectPath: string,
  llmConfig: LlmConfig,
  options: BidirectionalLinkBuildOptions = {},
): Promise<BidirectionalLinkBuildResult> {
  const pp = normalizePath(projectPath)
  const wikiRoot = `${pp}/wiki`
  const tree = await listDirectory(wikiRoot)
  const files = flattenMdFiles(tree)

  const pages: WikiPageSummary[] = []
  for (const file of files) {
    const id = file.name.replace(/\.md$/, "")
    if (EXCLUDED_PAGE_IDS.has(id)) continue
    const content = await readFile(file.path).catch(() => "")
    if (!content.trim()) continue
    pages.push({
      id,
      llmId: `P${pages.length + 1}`,
      title: extractTitle(content, id),
      path: file.path,
      content,
    })
  }

  if (pages.length < 2) {
    return { pagesScanned: pages.length, pairsSuggested: 0, pairsApplied: 0, filesChanged: 0 }
  }

  const validPageIds = new Set(pages.map((p) => p.id))
  const selectedIds = new Set((options.pageIds ?? []).map(normalizePageId).filter((id) => validPageIds.has(id)))
  const scopedIds = selectedIds.size > 0 ? selectedIds : null
  const pairs = await suggestLinkPairs(pages, llmConfig, scopedIds)
  const validPairs = dedupeAndValidatePairs(pairs, validPageIds, scopedIds)
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const additions = new Map<string, Set<string>>()

  for (const pair of validPairs) {
    if (options.direction === "outbound" && scopedIds) {
      if (scopedIds.has(pair.source)) addPair(additions, pair.source, pair.target)
      if (scopedIds.has(pair.target)) addPair(additions, pair.target, pair.source)
    } else {
      addPair(additions, pair.source, pair.target)
      addPair(additions, pair.target, pair.source)
    }
  }

  let filesChanged = 0
  for (const [pageId, targets] of additions) {
    const page = pageById.get(pageId)
    if (!page) continue
    const next = applyRelatedLinks(page.content, [...targets], pageById)
    if (next !== page.content) {
      await writeFile(page.path, next)
      filesChanged += 1
    }
  }

  return {
    pagesScanned: pages.length,
    pairsSuggested: pairs.length,
    pairsApplied: validPairs.length,
    filesChanged,
  }
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      out.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      out.push(node)
    }
  }
  return out
}

function extractTitle(content: string, fallback: string): string {
  const frontmatterTitle = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterTitle) return frontmatterTitle[1].trim()
  const heading = content.match(/^#\s+(.+)$/m)
  if (heading) return heading[1].trim()
  return fallback
}

function excerpt(content: string): string {
  const fmEnd = content.startsWith("---\n") ? content.indexOf("\n---\n", 3) : -1
  const body = fmEnd > 0 ? content.slice(fmEnd + 5) : content
  return body.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_EXCERPT_CHARS)
}

async function suggestLinkPairs(
  pages: WikiPageSummary[],
  llmConfig: LlmConfig,
  scopedIds: Set<string> | null,
): Promise<LinkPair[]> {
  const scopedLlmIds = scopedIds
    ? pages.filter((page) => scopedIds.has(page.id)).map((page) => page.llmId)
    : []
  const pageList = pages
    .map((page) => [
      `ID: ${page.llmId}`,
      `Wikilink target: ${page.id}`,
      `Title: ${page.title}`,
      `Excerpt: ${excerpt(page.content)}`,
    ].join("\n"))
    .join("\n\n---\n\n")
  const idMap = new Map(pages.map((page) => [page.llmId, page.id]))

  let raw = ""
  let streamError: Error | null = null
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "You build semantic links between wiki pages.",
          "Given all current wiki pages, choose page pairs that should be connected because they discuss the same topic, depend on each other, compare alternatives, or form a clear parent/child concept relationship.",
          "",
          "Return ONLY JSON in this exact shape:",
          "{",
          "  \"links\": [",
          "    { \"source\": \"P1\", \"target\": \"P2\" }",
          "  ]",
          "}",
          "",
          "Rules:",
          "- Use only short IDs from the input, like P1, P2, P3.",
          "- Do not use page titles or wikilink targets in source/target.",
          "- Do not link a page to itself.",
          "- Prefer high-confidence semantic links over many weak links.",
          "- Avoid index/root/log navigation links.",
          "- Treat every returned pair as bidirectional; do not include both A->B and B->A.",
          "- Return at most 4 links per page.",
          scopedLlmIds.length > 0
            ? `- Scope: every returned pair MUST include at least one of these selected IDs: ${scopedLlmIds.join(", ")}.`
            : "",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Wiki pages:\n\n${pageList}`,
      },
    ],
    {
      onToken: (token) => { raw += token },
      onDone: () => {},
      onError: (err) => { streamError = err },
    },
  )
  if (streamError) throw streamError

  const parsedPairs = parseLinkPairs(raw)
  if (parsedPairs.length === 0) {
    console.warn("[bidirectional-link-builder] LLM returned no parseable link pairs:", raw.slice(0, 800))
  }

  return parsedPairs.flatMap((pair) => {
    const source = idMap.get(pair.source) ?? pair.source
    const target = idMap.get(pair.target) ?? pair.target
    return [{ source, target }]
  })
}

function parseLinkPairs(raw: string): LinkPair[] {
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return []
  try {
    const parsed = JSON.parse(jsonText) as { links?: unknown }
    if (!Array.isArray(parsed.links)) return []
    return parsed.links.flatMap((item) => {
      if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string") {
        return [{ source: item[0].trim(), target: item[1].trim() }]
      }
      if (
        item &&
        typeof item === "object" &&
        typeof (item as LinkPair).source === "string" &&
        typeof (item as LinkPair).target === "string"
      ) {
        return [{
          source: (item as LinkPair).source.trim(),
          target: (item as LinkPair).target.trim(),
        }]
      }
      return []
    })
  } catch {
    return []
  }
}

function extractJsonObject(raw: string): string | null {
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "")
  const start = text.indexOf("{")
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\" && inString) {
      escape = true
      continue
    }
    if (ch === "\"") {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") depth += 1
    if (ch === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function dedupeAndValidatePairs(
  pairs: LinkPair[],
  pageIds: ReadonlySet<string>,
  scopedIds: ReadonlySet<string> | null = null,
): LinkPair[] {
  const seen = new Set<string>()
  const out: LinkPair[] = []
  for (const pair of pairs) {
    if (!pageIds.has(pair.source) || !pageIds.has(pair.target)) continue
    if (pair.source === pair.target) continue
    if (scopedIds && !scopedIds.has(pair.source) && !scopedIds.has(pair.target)) continue
    const key = [pair.source, pair.target].sort().join(":::")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(pair)
  }
  return out
}

function normalizePageId(page: string): string {
  return normalizePath(page).split("/").pop()?.replace(/\.md$/, "") ?? page.replace(/\.md$/, "")
}

function addPair(map: Map<string, Set<string>>, source: string, target: string): void {
  const set = map.get(source) ?? new Set<string>()
  set.add(target)
  map.set(source, set)
}

function applyRelatedLinks(
  content: string,
  targetIds: string[],
  pageById: ReadonlyMap<string, WikiPageSummary>,
): string {
  const missing = targetIds.filter((targetId) => !hasWikilink(content, targetId))
  if (missing.length === 0) return content

  const lines = missing
    .map((targetId) => {
      const target = pageById.get(targetId)
      const title = target?.title ?? targetId
      return title.toLowerCase() === targetId.toLowerCase()
        ? `- [[${targetId}]]`
        : `- [[${targetId}|${title}]]`
    })
    .join("\n")

  if (/^## Related\s*$/m.test(content)) {
    return content.replace(/^## Related\s*$/m, (heading) => `${heading}\n${lines}`)
  }

  return `${content.trimEnd()}\n\n## Related\n\n${lines}\n`
}

function hasWikilink(content: string, targetId: string): boolean {
  const escaped = escapeRegExp(targetId)
  return new RegExp(String.raw`\[\[\s*${escaped}(?:\||\s*\]\])`, "i").test(content)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
