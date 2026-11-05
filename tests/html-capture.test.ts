import { describe, expect, it } from "vitest";
import { NOOS_HTML_BEGIN_MARKER, NOOS_HTML_END_MARKER } from "../src/core/noos-html";
import { captureNoosOverviews, deriveOverviewTitle, parseOverviewProvenance } from "../src/core/html-capture";

const DOCUMENT = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta name="noos-provenance" content="action=OVERVIEW_HTML; conversation=conv-abc; created_at=2026-10-30T12:00:00.000Z">
<title>速览：快捷动作</title>
</head>
<body><h1>要点</h1><p>正文</p></body>
</html>`;

function wrapped(documentBody: string): string {
  return `before\n${NOOS_HTML_BEGIN_MARKER}\n${documentBody}\n${NOOS_HTML_END_MARKER}\nafter`;
}

describe("captureNoosOverviews (issue #61 slice 4)", () => {
  it("captures the exact self-contained HTML bytes between the dedicated markers", () => {
    const result = captureNoosOverviews(wrapped(DOCUMENT), "2026-10-30T12:01:00.000Z");

    expect(result.errors).toEqual([]);
    expect(result.overviews).toHaveLength(1);
    expect(result.overviews[0].html).toBe(DOCUMENT);
    expect(result.overviews[0].detectedAt).toBe("2026-10-30T12:01:00.000Z");
    expect(result.overviews[0].warnings).toEqual([]);
  });

  it("reads the embedded machine-readable provenance without using a DOM", () => {
    const overview = captureNoosOverviews(wrapped(DOCUMENT)).overviews[0];
    expect(overview.provenance).toEqual({
      action: "OVERVIEW_HTML",
      conversation: "conv-abc",
      createdAt: "2026-10-30T12:00:00.000Z"
    });
  });

  it("captures multiple overviews in document order", () => {
    const second = DOCUMENT.replace("速览：快捷动作", "速览：第二个");
    const result = captureNoosOverviews(`${wrapped(DOCUMENT)}\n${wrapped(second)}`);

    expect(result.overviews.map(overview => overview.html)).toEqual([DOCUMENT, second]);
    expect(result.overviews[1].markerRange.begin).toBeGreaterThan(result.overviews[0].markerRange.end);
  });

  it("reports an unclosed begin marker instead of guessing an end", () => {
    const result = captureNoosOverviews(`${NOOS_HTML_BEGIN_MARKER}\n${DOCUMENT}`);
    expect(result.overviews).toEqual([]);
    expect(result.errors[0]).toMatch(/without a matching end marker/);
  });

  it("skips empty or placeholder captures", () => {
    const result = captureNoosOverviews(
      `${NOOS_HTML_BEGIN_MARKER}\n\n${NOOS_HTML_END_MARKER}\n` +
        `${NOOS_HTML_BEGIN_MARKER}\nNOOS:HTML:BEGIN\n${NOOS_HTML_END_MARKER}`
    );
    expect(result.overviews).toEqual([]);
  });

  it("warns when provenance or an HTML document is missing, but still captures", () => {
    const result = captureNoosOverviews(wrapped("plain text without tags"));
    expect(result.overviews).toHaveLength(1);
    expect(result.overviews[0].warnings).toEqual([
      "Missing noos-provenance meta; artifact-level provenance is unavailable.",
      "Captured overview does not look like an HTML document."
    ]);
  });

  it("keeps script bytes inert: they are returned as a string, never executed", () => {
    const hostile = `<html><head><meta name="noos-provenance" content="action=OVERVIEW_HTML"></head><body><script>globalThis.__pwned = true;</script></body></html>`;
    const overview = captureNoosOverviews(wrapped(hostile)).overviews[0];

    expect(overview.html).toContain("<script>");
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});

describe("overview provenance and filename helpers", () => {
  it("decodes HTML entities in the provenance attribute", () => {
    const provenance = parseOverviewProvenance(
      '<meta name="noos-provenance" content="action=OVERVIEW_HTML; conversation=a&quot;&amp;b">'
    );
    expect(provenance?.conversation).toBe('a"&b');
  });

  it("derives a human title from <title> and falls back to <h1>", () => {
    expect(deriveOverviewTitle(DOCUMENT)).toBe("速览：快捷动作");
    expect(deriveOverviewTitle("<html><body><h1>Fallback <em>Title</em></h1></body></html>")).toBe("Fallback Title");
    expect(deriveOverviewTitle("<html><body>no heading</body></html>")).toBe("");
  });
});
