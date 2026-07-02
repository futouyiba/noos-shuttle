import { lazy, Suspense, useMemo, useState } from "react"
import { Pencil, Eye } from "lucide-react"
import { parseFrontmatter } from "@/lib/frontmatter"
import { FrontmatterPanel } from "@/components/editor/frontmatter-panel"
import { WikiReader } from "@/components/editor/wiki-reader"

const MilkdownEditor = lazy(() =>
  import("./milkdown-editor").then((mod) => ({ default: mod.MilkdownEditor }))
)

interface WikiEditorProps {
  content: string
  onSave: (markdown: string) => void
}

function wrapBareMathBlocks(text: string): string {
  return text.replace(
    /(?<!\$\$\s*)(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})(?!\s*\$\$)/g,
    (_match, block: string) => `$$\n${block}\n$$`,
  )
}

export function WikiEditor({ content, onSave }: WikiEditorProps) {
  // Default to read mode (ReactMarkdown render). Edit mode swaps
  // in Milkdown WYSIWYG. We default to read because:
  //   1. Milkdown's commonmark/gfm preset has no wikilink schema,
  //      so `[[…]]` shows up as raw text — exactly what users
  //      called out as "looking like raw code".
  //   2. We can pre-process wikilinks for the read view safely
  //      (the rendered output is throwaway). Doing the same in
  //      Milkdown would be a save-corruption hazard because
  //      Milkdown serializes its current state on save — the
  //      transformed `[label](#slug)` would overwrite the
  //      original `[[…]]` source.
  //   3. Users read wiki pages far more often than they edit
  //      them; the toggle makes editing a deliberate action
  //      rather than the default state.
  const [mode, setMode] = useState<"read" | "edit">("read")

  // Split frontmatter from body. Both modes consume `body`;
  // Milkdown additionally rebuilds the full file via `rawBlock`
  // on save so user-managed YAML survives untouched.
  const { frontmatter, body, rawBlock } = useMemo(
    () => parseFrontmatter(content),
    [content],
  )

  const processedBody = useMemo(() => wrapBareMathBlocks(body), [body])

  const handleSave = useMemo(
    () => (markdown: string) => onSave(rawBlock + markdown),
    [onSave, rawBlock],
  )

  return (
    <div className="relative h-full overflow-auto">
      <button
        type="button"
        onClick={() => setMode((m) => (m === "read" ? "edit" : "read"))}
        title={mode === "read" ? "Edit (raw markdown)" : "Done editing"}
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
      >
        {mode === "read" ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {mode === "read" ? "Edit" : "Done"}
      </button>

      {mode === "read" ? (
        <div className="px-6 py-6">
          {frontmatter && <FrontmatterPanel data={frontmatter} />}
          <WikiReader body={body} />
        </div>
      ) : (
        <div className="prose prose-invert min-w-0 max-w-none overflow-hidden p-6">
          {frontmatter && <FrontmatterPanel data={frontmatter} />}
          <Suspense fallback={null}>
            <MilkdownEditor content={processedBody} onSave={handleSave} />
          </Suspense>
        </div>
      )}
    </div>
  )
}
