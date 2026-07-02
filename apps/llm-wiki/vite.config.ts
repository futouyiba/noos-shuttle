import path from "path"
import { readFileSync } from "fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const host = process.env.TAURI_DEV_HOST

// Read version from package.json at config-load time so the Settings
// UI can show the running app version without duplicating the string.
const pkgJson = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"))

const featureChunkRules: Array<[string, string[]]> = [
  ["feature-milkdown-editor", ["/src/components/editor/milkdown-editor.tsx"]],
  ["feature-markdown-renderer", [
    "/src/components/editor/wiki-reader.tsx",
    "/src/components/editor/file-preview.tsx",
  ]],
  ["feature-settings", ["/src/components/settings/"]],
  ["feature-chat-actions", [
    "/src/components/chat/save-query-to-wiki.ts",
    "/src/components/chat/write-ingest-to-wiki.ts",
  ]],
  ["feature-chat-references", ["/src/components/chat/chat-cited-references.tsx"]],
  ["feature-chat", ["/src/components/chat/"]],
  ["feature-editor", ["/src/components/editor/"]],
  ["feature-graph", [
    "/src/components/graph/",
    "/src/components/layout/knowledge-graph.tsx",
    "/src/lib/wiki-graph.ts",
    "/src/lib/graph-relevance.ts",
  ]],
  ["feature-ingest", [
    "/src/lib/ingest.ts",
    "/src/lib/ingest-queue.ts",
    "/src/lib/source-lifecycle.ts",
    "/src/lib/wiki-page-delete.ts",
    "/src/lib/extract-source-images.ts",
  ]],
  ["feature-llm", [
    "/src/lib/llm-client.ts",
    "/src/lib/web-search",
    "/src/lib/research",
  ]],
]

function includesAny(id: string, markers: string[]): boolean {
  return markers.some((marker) => id.includes(marker))
}

function nodeModulePath(id: string): string {
  const marker = "/node_modules/"
  const index = id.lastIndexOf(marker)
  return index >= 0 ? id.slice(index + marker.length) : id
}

function packageNameFromId(id: string): string {
  let modulePath = nodeModulePath(id)
  if (modulePath.startsWith(".pnpm/")) {
    const nestedNodeModules = "/node_modules/"
    const nestedIndex = modulePath.indexOf(nestedNodeModules)
    if (nestedIndex >= 0) {
      modulePath = modulePath.slice(nestedIndex + nestedNodeModules.length)
    }
  }
  if (modulePath.startsWith(".vite/deps/")) {
    const optimizedName = modulePath
      .slice(".vite/deps/".length)
      .split(/[.?]/)[0]
    return optimizedName.replace(/_/g, "/")
  }
  return modulePath.startsWith("@")
    ? modulePath.split("/").slice(0, 2).join("/")
    : modulePath.split("/")[0]
}

function matchesPackage(id: string, packages: string[]): boolean {
  const packageName = packageNameFromId(id)
  return packages.some((pkg) => {
    return packageName === pkg || packageName.startsWith(`${pkg}/`)
  })
}

function miscVendorChunk(id: string): string {
  const packageName = packageNameFromId(id)
  const first = packageName.replace(/^@/, "").charAt(0).toLowerCase()
  if (first >= "a" && first <= "b") return "vendor-misc-a-b"
  if (first === "c") return "vendor-misc-c"
  if (first >= "d" && first <= "f") return "vendor-misc-d-f"
  if (first >= "g" && first <= "i") return "vendor-misc-g-i"
  if (first >= "j" && first <= "l") return "vendor-misc-j-l"
  if (first === "m") return "vendor-misc-m"
  if (first >= "n" && first <= "s") return "vendor-misc-n-s"
  return "vendor-misc-t-z"
}

function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/")

  if (!normalizedId.includes("/node_modules/")) {
    for (const [chunkName, markers] of featureChunkRules) {
      if (includesAny(normalizedId, markers)) return chunkName
    }
    return undefined
  }

  if (matchesPackage(normalizedId, ["react", "react-dom", "scheduler"])) {
    return "vendor-react"
  }
  if (matchesPackage(normalizedId, [
    "@tauri-apps/api",
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-http",
    "@tauri-apps/plugin-opener",
    "@tauri-apps/plugin-store",
  ])) {
    return "vendor-tauri"
  }
  if (matchesPackage(normalizedId, ["lucide-react"])) {
    return "vendor-icons"
  }
  if (matchesPackage(normalizedId, ["i18next", "react-i18next"])) {
    return "vendor-i18n"
  }
  if (matchesPackage(normalizedId, ["zustand"])) {
    return "vendor-state"
  }
  if (matchesPackage(normalizedId, [
    "@milkdown/kit",
    "@milkdown/plugin-math",
    "@milkdown/react",
    "@milkdown/theme-nord",
    "prosemirror-commands",
    "prosemirror-history",
    "prosemirror-inputrules",
    "prosemirror-keymap",
    "prosemirror-model",
    "prosemirror-schema-list",
    "prosemirror-state",
    "prosemirror-transform",
    "prosemirror-view",
    "crelt",
  ])) {
    return "vendor-editor"
  }
  if (matchesPackage(normalizedId, [
    "@codemirror/autocomplete",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
  ])) {
    return "vendor-codemirror"
  }
  if (matchesPackage(normalizedId, [
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "@lezer/markdown",
  ])) {
    return "vendor-lezer"
  }
  if (matchesPackage(normalizedId, [
    "vscode-jsonrpc",
    "vscode-languageserver-protocol",
    "vscode-languageserver-types",
  ])) {
    return "vendor-vscode-lsp"
  }
  if (matchesPackage(normalizedId, ["langium"])) {
    return "vendor-langium"
  }
  if (matchesPackage(normalizedId, [
    "@chevrotain/cst-dts-gen",
    "@chevrotain/gast",
    "@chevrotain/regexp-to-ast",
    "@chevrotain/types",
    "@chevrotain/utils",
    "chevrotain",
  ])) {
    return "vendor-chevrotain"
  }
  if (matchesPackage(normalizedId, ["katex"])) {
    return "vendor-katex"
  }
  if (matchesPackage(normalizedId, [
    "react-markdown",
    "remark-gfm",
    "remark-math",
    "rehype-katex",
    "unified",
    "micromark",
    "micromark-core-commonmark",
    "micromark-extension-gfm",
    "micromark-extension-gfm-autolink-literal",
    "micromark-extension-gfm-footnote",
    "micromark-extension-gfm-strikethrough",
    "micromark-extension-gfm-table",
    "micromark-extension-gfm-tagfilter",
    "micromark-extension-gfm-task-list-item",
    "micromark-extension-math",
    "micromark-factory-destination",
    "micromark-factory-label",
    "micromark-factory-space",
    "micromark-factory-title",
    "micromark-factory-whitespace",
    "micromark-util-character",
    "micromark-util-chunked",
    "micromark-util-classify-character",
    "micromark-util-combine-extensions",
    "micromark-util-decode-numeric-character-reference",
    "micromark-util-decode-string",
    "micromark-util-encode",
    "micromark-util-html-tag-name",
    "micromark-util-normalize-identifier",
    "micromark-util-resolve-all",
    "micromark-util-sanitize-uri",
    "micromark-util-subtokenize",
    "micromark-util-symbol",
    "micromark-util-types",
    "mdast-util-from-markdown",
    "mdast-util-gfm",
    "mdast-util-gfm-autolink-literal",
    "mdast-util-gfm-footnote",
    "mdast-util-gfm-strikethrough",
    "mdast-util-gfm-table",
    "mdast-util-gfm-task-list-item",
    "mdast-util-math",
    "mdast-util-to-hast",
    "hast-util-to-jsx-runtime",
    "hast-util-whitespace",
    "unist-util-position",
    "unist-util-stringify-position",
    "unist-util-visit",
    "unist-util-visit-parents",
    "vfile",
    "bail",
    "trough",
    "zwitch",
  ])) {
    return "vendor-markdown"
  }
  if (matchesPackage(normalizedId, ["mermaid"])) {
    return undefined
  }
  if (matchesPackage(normalizedId, [
    "@react-sigma/core",
    "sigma",
    "graphology",
    "graphology-communities-louvain",
    "graphology-layout-forceatlas2",
    "d3",
    "d3-array",
    "d3-axis",
    "d3-brush",
    "d3-chord",
    "d3-color",
    "d3-contour",
    "d3-delaunay",
    "d3-dispatch",
    "d3-drag",
    "d3-dsv",
    "d3-ease",
    "d3-fetch",
    "d3-force",
    "d3-format",
    "d3-geo",
    "d3-hierarchy",
    "d3-interpolate",
    "d3-path",
    "d3-polygon",
    "d3-quadtree",
    "d3-random",
    "d3-scale",
    "d3-scale-chromatic",
    "d3-selection",
    "d3-shape",
    "d3-time",
    "d3-time-format",
    "d3-timer",
    "d3-transition",
    "d3-zoom",
  ])) {
    return "vendor-graph"
  }
  if (matchesPackage(normalizedId, [
    "@base-ui/react",
    "@floating-ui/core",
    "@floating-ui/dom",
    "@floating-ui/react",
    "@floating-ui/react-dom",
    "@floating-ui/utils",
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
    "react-resizable-panels",
  ])) {
    return "vendor-ui"
  }

  return miscVendorChunk(normalizedId)
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },

  define: {
    __APP_VERSION__: JSON.stringify(pkgJson.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        codeSplitting: true,
        manualChunks,
      },
    },
  },

  test: {
    environment: "node",
    // Loads .env.test.local into process.env for real-LLM tests.
    // The loader itself is a no-op if the file is absent, so this is
    // safe to keep on for every test run.
    setupFiles: ["./src/test-helpers/load-test-env.ts"],
  },
}))
