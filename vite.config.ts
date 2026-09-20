import { defineConfig, transformWithEsbuild } from "vite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CONTENT_DIR = "/src/content/";

/**
 * The content bundle cannot import anything.
 *
 * MV3 loads a content script as a classic script, so it cannot resolve the
 * static `import` a module-typed service worker can. Vite/Rollup hoists any
 * module reachable at runtime from *both* entries into a shared chunk — leaving
 * the content entry with an import the browser refuses to execute, and doing so
 * silently, because nothing in the manifest knows the chunk exists.
 *
 * `contentInlinedModules` maps a module the two entries genuinely both need at
 * runtime to a virtual id, so the content origin gets its own copy inlined while
 * the service worker keeps the real module. The source stays single-copy in
 * `src/`; only the emitted content bundle duplicates it. That is safe exactly
 * when the module is pure — data shapes plus reducers over them, never
 * cross-context state — which is the bar for adding an entry here.
 */
const contentInlinedModules: Array<{ pattern: RegExp; virtualId: string; sourcePath: string }> = [
  {
    pattern: /(^|\/)core\/outbox-queue(\.ts)?$/,
    virtualId: "\0noos-content-outbox-queue",
    sourcePath: "src/core/outbox-queue.ts"
  }
];

function inlineContentOwnedModules() {
  return {
    name: "inline-content-owned-modules",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (!importer?.includes(CONTENT_DIR)) return undefined;
      return contentInlinedModules.find(entry => entry.pattern.test(source))?.virtualId;
    },
    async load(id: string) {
      const entry = contentInlinedModules.find(candidate => candidate.virtualId === id);
      if (!entry) return undefined;
      return (await transformWithEsbuild(
        readFileSync(new URL(`./${entry.sourcePath}`, import.meta.url), "utf8"),
        id,
        { loader: "ts" }
      )).code;
    }
  };
}

export default defineConfig({
  plugins: [inlineContentOwnedModules()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        content: "src/content/index.ts",
        "service-worker": "src/background/service-worker.ts"
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup-browser-locks.ts"],
    include: ["tests/**/*.test.ts"]
  }
});
