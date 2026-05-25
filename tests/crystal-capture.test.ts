import { describe, expect, it } from "vitest";
import { captureNoosCrystals } from "../src/core/crystal-capture";

const VALID_CRYSTAL = `Noise before
<!-- NOOS:CRYSTAL:BEGIN -->
---
type: noos_crystal
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/c/example
status: active
created_at: 2026-05-14
crystal_key: 20260514-noos-vault-route
title: NOOS Vault Route
summary: Hub direct write is the preferred storage route.
tags: [noos, crystal]
preferred_path: .noos/crystals/active/2026-05-14-noos-vault-route.md
---

# 结晶：NOOS Vault Route

## 已确认结论
Hub direct write is preferred.

## 合理推断
Downloads mirror remains useful as fallback.

## 未决问题
Token rotation is still open.

## 下一轮最值得继续讨论的 3 个入口
1. Token rotation
2. Runtime port discovery
3. Codex lookup by key

<!-- NOOS:CRYSTAL:END -->
Noise after`;

describe("captureNoosCrystals", () => {
  it("captures a valid crystal", () => {
    const result = captureNoosCrystals(VALID_CRYSTAL, "2026-05-14T00:00:00.000Z");

    expect(result.errors).toEqual([]);
    expect(result.crystals).toHaveLength(1);
    expect(result.crystals[0].key).toBe("20260514-noos-vault-route");
    expect(result.crystals[0].summary).toBe("Hub direct write is the preferred storage route.");
    expect(result.crystals[0].warnings).toEqual([]);
  });

  it("captures multiple crystals independently", () => {
    const result = captureNoosCrystals(`${VALID_CRYSTAL}\n${VALID_CRYSTAL}`);

    expect(result.crystals).toHaveLength(2);
  });

  it("ignores placeholder crystal marker examples", () => {
    const result = captureNoosCrystals(`<!-- NOOS:CRYSTAL:BEGIN -->
\`\`\`markdown
...
\`\`\`
<!-- NOOS:CRYSTAL:END -->

<!-- NOOS:CRYSTAL:BEGIN -->
<结晶正文>
<!-- NOOS:CRYSTAL:END -->

${VALID_CRYSTAL}`);

    expect(result.crystals).toHaveLength(1);
    expect(result.crystals[0].key).toBe("20260514-noos-vault-route");
  });

  it("repairs ChatGPT answers that wrap the real crystal in a markdown code fence", () => {
    const result = captureNoosCrystals(`<!-- NOOS:CRYSTAL:BEGIN -->
\`\`\`markdown
---
type: noos_crystal
version: 0.1
source_app: chatgpt
status: active
created_at: 2026-05-14
crystal_key: 20260514-fenced-crystal
title: Fenced Crystal
summary: Fenced generated crystals should parse.
tags: [noos, crystal]
---

# 结晶：Fenced Crystal

## 已确认结论
ChatGPT sometimes wraps generated Markdown in a code fence.

## 合理推断
The capture layer should repair this common output shape.

## 未决问题
None.

## 下一轮最值得继续讨论的 3 个入口
1. Capture
2. Validation
3. Save
\`\`\`
<!-- NOOS:CRYSTAL:END -->`);

    expect(result.crystals).toHaveLength(1);
    expect(result.crystals[0].frontmatter?.type).toBe("noos_crystal");
    expect(result.crystals[0].key).toBe("20260514-fenced-crystal");
    expect(result.crystals[0].warnings).toEqual([]);
  });

  it("repairs ChatGPT-rendered crystal frontmatter that becomes a heading without a closing YAML fence", () => {
    const result = captureNoosCrystals(`<!-- NOOS:CRYSTAL:BEGIN -->
---
## type: noos_crystal version: 0.1 source_app: chatgpt status: active created_at: 2026-05-14 crystal_key: 20260514-rendered-crystal title: Rendered Crystal summary: Heading-rendered frontmatter should parse. tags: [noos, crystal]
# 结晶：Rendered Crystal

## 已确认结论
ChatGPT can render frontmatter as a heading.

## 合理推断
The capture layer should repair it before validation.

## 未决问题
None.

## 下一轮最值得继续讨论的 3 个入口
1. Capture
2. Validation
3. Save
<!-- NOOS:CRYSTAL:END -->`);

    expect(result.crystals).toHaveLength(1);
    expect(result.crystals[0].frontmatter?.type).toBe("noos_crystal");
    expect(result.crystals[0].key).toBe("20260514-rendered-crystal");
    expect(result.crystals[0].warnings).toEqual([]);
  });

  it("warns when required sections are missing", () => {
    const result = captureNoosCrystals(`<!-- NOOS:CRYSTAL:BEGIN -->
---
type: noos_crystal
version: 0.1
title: incomplete
---

# 结晶：Incomplete
<!-- NOOS:CRYSTAL:END -->`);

    expect(result.crystals).toHaveLength(1);
    expect(result.crystals[0].warnings).toContain("Frontmatter should include crystal_key.");
  });
});
