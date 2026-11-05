import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { NOOS_HTML_BEGIN_MARKER, NOOS_HTML_END_MARKER } from "../src/core/noos-html";
import { captureNoosOverviews } from "../src/core/html-capture";
import { getPageText, getRawPageText } from "../src/content/chatgpt-dom";
import { DownloadAdapter } from "../src/storage/DownloadAdapter";

/**
 * Issue #61 slice 4 / PR #150 R1: the overview is downloaded as the exact
 * captured bytes, so the DOM read must not pass through the Markdown
 * normalizer used by Thread/Crystal capture. This is the DOM → marker capture
 * → download path end to end, with the whitespace the normalizer would eat.
 */

const DOM_KEYS = ["document", "window", "Node", "Element", "HTMLElement"] as const;

// `alpha   ` keeps trailing spaces; the two empty strings make `\n\n\n`, which
// the Markdown normalizer collapses to `\n\n`.
const PRE_BODY = ["<pre>", "alpha   ", "", "", "beta", "</pre>"].join("\n");
const SCRIPT_BODY = ["<script>", "const text = `alpha   ", "", "", "beta`;", "</script>"].join("\n");

function buildOverviewDocument(): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="zh">',
    "<head>",
    '<meta name="noos-provenance" content="action=OVERVIEW_HTML; conversation=conv-raw; created_at=2026-11-05T00:00:00.000Z">',
    "<title>逐字节速览</title>",
    "</head>",
    "<body>",
    PRE_BODY,
    SCRIPT_BODY,
    "</body>",
    "</html>"
  ].join("\n");
}

async function withDom<T>(html: string, callback: (win: Window & typeof globalThis) => T | Promise<T>): Promise<T> {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/raw-bytes", pretendToBeVisual: true });
  const win = dom.window as unknown as Window & typeof globalThis;
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const key of DOM_KEYS) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: win[key as keyof typeof win], configurable: true });
  }

  try {
    return await callback(win);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("overview HTML fidelity (DOM → capture → download)", () => {
  it("downloads the bytes between the markers unchanged, with no warnings", async () => {
    const documentText = buildOverviewDocument();
    const markedSource = [NOOS_HTML_BEGIN_MARKER, documentText, NOOS_HTML_END_MARKER].join("\n");

    await withDom("<main><article><pre id='turn'></pre></article></main>", async (win) => {
      const pre = win.document.getElementById("turn");
      expect(pre).not.toBeNull();
      // The assistant's code block is literal text in the transcript DOM.
      pre!.textContent = markedSource;

      // The raw reader hands the capture exactly what the DOM holds.
      expect(getRawPageText()).toBe(markedSource);
      // And the Markdown path really would have rewritten this fixture, so the
      // regression below is discriminating rather than vacuous.
      expect(getPageText()).not.toContain("alpha   \n\n\nbeta");

      const capture = captureNoosOverviews(getRawPageText());
      expect(capture.errors).toEqual([]);
      expect(capture.overviews).toHaveLength(1);

      const overview = capture.overviews[0];
      expect(overview.warnings).toEqual([]);
      expect(overview.html).toBe(documentText);

      // Download uses the same bytes; nothing parses or re-renders them.
      let createdBlob: Blob | undefined;
      vi.stubGlobal("URL", {
        createObjectURL: (blob: Blob) => {
          createdBlob = blob;
          return "blob:overview";
        },
        revokeObjectURL: () => undefined
      });
      const anchor = { href: "", download: "", rel: "", click() {} };
      Object.defineProperty(win.document, "createElement", {
        configurable: true,
        value: () => anchor
      });

      const result = await new DownloadAdapter().saveHtml(overview.html, { filename: "overview.html" });

      expect(result.ok).toBe(true);
      expect(await createdBlob?.text()).toBe(documentText);
      expect(anchor.download).toBe("overview.html");
    });
  });

  it("reads comment-node markers without touching the text between them", async () => {
    const documentText = buildOverviewDocument();

    await withDom("<main><article><pre id='turn'></pre></article></main>", (win) => {
      const article = win.document.querySelector("article");
      expect(article).not.toBeNull();
      const pre = win.document.getElementById("turn");
      pre!.textContent = documentText;
      // The other rendering shape: real comment nodes instead of literal text.
      article!.insertBefore(win.document.createComment(" NOOS:HTML:BEGIN "), pre!);
      article!.appendChild(win.document.createComment(" NOOS:HTML:END "));

      const raw = getRawPageText();
      expect(raw).toBe(`${NOOS_HTML_BEGIN_MARKER}${documentText}${NOOS_HTML_END_MARKER}`);

      const capture = captureNoosOverviews(raw);
      expect(capture.overviews[0]?.html).toBe(documentText);
      expect(capture.overviews[0]?.warnings).toEqual([]);
    });
  });

  it("wires both overview capture sites to the raw reader", () => {
    // fileURLToPath, not .pathname: this repo path contains spaces.
    const index = readFileSync(fileURLToPath(new URL("../src/content/index.ts", import.meta.url)), "utf8");

    expect(index).not.toContain("captureNoosOverviews(getPageText())");
    expect(index.match(/captureNoosOverviews\(getRawPageText\(\)\)/g) ?? []).toHaveLength(2);
  });
});
