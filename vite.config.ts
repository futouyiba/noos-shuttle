import { defineConfig, transformWithEsbuild } from "vite";
import { readFileSync } from "node:fs";

const contentProviderVirtualId = "\0noos-content-provider-identity";

function inlineContentProviderIdentity() {
  return {
    name: "inline-content-provider-identity",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      return source.includes("shared/provider-identity") && importer?.endsWith("/src/content/index.ts")
        ? contentProviderVirtualId
        : undefined;
    },
    async load(id: string) {
      return id === contentProviderVirtualId
        ? (await transformWithEsbuild(
            readFileSync(new URL("./src/shared/provider-identity.ts", import.meta.url), "utf8"),
            contentProviderVirtualId,
            { loader: "ts" }
          )).code
        : undefined;
    }
  };
}

export default defineConfig({
  plugins: [inlineContentProviderIdentity()],
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
