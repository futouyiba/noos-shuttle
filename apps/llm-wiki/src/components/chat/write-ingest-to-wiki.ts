import { listDirectory } from "@/commands/fs"
import { executeIngestWrites } from "@/lib/ingest"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"

export async function writeIngestConversationToWiki(
  project: WikiProject,
  llmConfig: LlmConfig,
): Promise<void> {
  const pp = normalizePath(project.path)
  await executeIngestWrites(pp, llmConfig, undefined, undefined)
  try {
    const tree = await listDirectory(pp)
    useWikiStore.getState().setFileTree(tree)
  } catch {
    // ignore
  }
}
