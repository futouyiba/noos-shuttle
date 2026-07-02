import { useRef } from "react"
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core"
import { commonmark } from "@milkdown/kit/preset/commonmark"
import { gfm } from "@milkdown/kit/preset/gfm"
import { history } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import { math } from "@milkdown/plugin-math"
import { nord } from "@milkdown/theme-nord"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import "@milkdown/theme-nord/style.css"
import "katex/dist/katex.min.css"

interface MilkdownEditorProps {
  content: string
  onSave: (markdown: string) => void
}

function MilkdownEditorInner({ content, onSave }: MilkdownEditorProps) {
  // Milkdown fires `markdownUpdated` once on initial parse before any
  // user interaction. That one emit must not be forwarded as a save.
  const initialEmitConsumedRef = useRef(false)

  useEditor(
    (root) =>
      Editor.make()
        .config(nord)
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, content)
          initialEmitConsumedRef.current = false
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            if (!initialEmitConsumedRef.current) {
              initialEmitConsumedRef.current = true
              return
            }
            onSave(markdown)
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(math)
        .use(history)
        .use(listener),
    [content],
  )

  return <Milkdown />
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  )
}
