import { lazy, Suspense } from "react"
import type { ReactNode } from "react"
import { useWikiStore } from "@/stores/wiki-store"

const ChatPanel = lazy(() =>
  import("@/components/chat/chat-panel").then((mod) => ({ default: mod.ChatPanel }))
)
const GraphView = lazy(() =>
  import("@/components/graph/graph-view").then((mod) => ({ default: mod.GraphView }))
)
const LintView = lazy(() =>
  import("@/components/lint/lint-view").then((mod) => ({ default: mod.LintView }))
)
const ReviewView = lazy(() =>
  import("@/components/review/review-view").then((mod) => ({ default: mod.ReviewView }))
)
const SearchView = lazy(() =>
  import("@/components/search/search-view").then((mod) => ({ default: mod.SearchView }))
)
const SettingsView = lazy(() =>
  import("@/components/settings/settings-view").then((mod) => ({ default: mod.SettingsView }))
)
const SourcesView = lazy(() =>
  import("@/components/sources/sources-view").then((mod) => ({ default: mod.SourcesView }))
)

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  let content: ReactNode
  switch (activeView) {
    case "settings":
      content = <SettingsView />
      break
    case "sources":
      content = <SourcesView />
      break
    case "review":
      content = <ReviewView />
      break
    case "lint":
      content = <LintView />
      break
    case "search":
      content = <SearchView />
      break
    case "graph":
      content = <GraphView />
      break
    default:
      content = <ChatPanel />
  }

  return <Suspense fallback={null}>{content}</Suspense>
}
