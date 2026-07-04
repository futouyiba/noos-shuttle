import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { buildImageMarkdownSection, type SourceImageAsset } from "./extract-source-images"

describe("buildImageMarkdownSection", () => {
  it("uses cached captions and source alt for image description fallback blocks", () => {
    const images: SourceImageAsset[] = [
      {
        index: 1,
        page: null,
        relPath: "media/feishu-doc/chart.png",
        sha256: "known",
        sourceAlt: "Original Feishu caption",
      },
      {
        index: 2,
        page: null,
        relPath: "media/feishu-doc/screenshot.png",
        sourceAlt: "Source-only caption",
      },
    ]
    const captions = new Map([["known", "Generated chart caption"]])

    const section = buildImageMarkdownSection(images, captions, {
      includeDescriptionBlocks: true,
    })

    expect(section).toContain("![Generated chart caption](media/feishu-doc/chart.png)")
    expect(section).toContain("*Image description: Generated chart caption*")
    expect(section).toContain("![Source-only caption](media/feishu-doc/screenshot.png)")
    expect(section).toContain("*Image description: Source-only caption*")
  })

  it("ignores generic source alt when no caption is available", () => {
    const section = buildImageMarkdownSection(
      [
        {
          index: 1,
          page: null,
          relPath: "media/feishu-doc/image.png",
          sourceAlt: "image",
        },
      ],
      undefined,
      { includeDescriptionBlocks: true },
    )

    expect(section).toContain("![](media/feishu-doc/image.png)")
    expect(section).not.toContain("Image description:")
  })
})
