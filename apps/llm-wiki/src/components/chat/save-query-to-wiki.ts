import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { autoIngest } from "@/lib/ingest"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { normalizePath } from "@/lib/path-utils"
import { makeQueryFileName } from "@/lib/wiki-filename"
import { useWikiStore } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"

export async function saveQueryToWiki(project: WikiProject, content: string): Promise<void> {
  const pp = normalizePath(project.path)

  // Generate a unique filename for this save.
  // See `src/lib/wiki-filename.ts` — the slug is Unicode-aware
  // (so CJK titles don't collapse to empty) and the HHMMSS
  // timestamp suffix guarantees same-day saves stay distinct.
  const firstLine = content.split("\n")[0].replace(/^#+\s*/, "").trim()
  const title = firstLine.slice(0, 60) || "Saved Query"
  const { date, fileName } = makeQueryFileName(title)
  const filePath = `${pp}/wiki/queries/${fileName}`

  // Strip hidden sources comment and thinking blocks from content
  const cleanContent = content
    .replace(/<!--\s*sources:.*?-->/g, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trimEnd()

  const frontmatter = [
    "---",
    `type: query`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `created: ${date}`,
    `tags: []`,
    "---",
    "",
  ].join("\n")

  await writeFile(filePath, frontmatter + cleanContent)

  // Update index.md — append under ## Queries section
  const indexPath = `${pp}/wiki/index.md`
  let indexContent = ""
  try {
    indexContent = await readFile(indexPath)
  } catch {
    indexContent = "# Wiki Index\n\n## Queries\n"
  }
  // The wikilink target is the filename WITHOUT the `.md`
  // extension — must match `fileName` exactly (including the
  // time suffix) or the link lands on a 404.
  const linkTarget = fileName.replace(/\.md$/, "")
  const entry = `- [[queries/${linkTarget}|${title}]]`
  if (indexContent.includes("## Queries")) {
    indexContent = indexContent.replace(
      /(## Queries\n)/,
      `$1${entry}\n`,
    )
  } else {
    indexContent = `${indexContent.trimEnd()}\n\n## Queries\n${entry}\n`
  }
  await writeFile(indexPath, indexContent)

  // Append to log.md
  const logPath = `${pp}/wiki/log.md`
  let logContent = ""
  try {
    logContent = await readFile(logPath)
  } catch {
    logContent = "# Wiki Log\n\n"
  }
  const logEntry = `- ${date}: Saved query page \`${fileName}\`\n`
  await writeFile(logPath, `${logContent.trimEnd()}\n${logEntry}`)

  // Refresh file tree and update graph
  const tree = await listDirectory(pp)
  useWikiStore.getState().setFileTree(tree)
  useWikiStore.getState().bumpDataVersion()

  // Full auto-ingest: extract entities, concepts, cross-references from saved content
  const llmConfig = useWikiStore.getState().llmConfig
  if (hasUsableLlm(llmConfig)) {
    autoIngest(pp, filePath, llmConfig).catch((err) =>
      console.error("Failed to auto-ingest saved query:", err)
    )
  }
}
