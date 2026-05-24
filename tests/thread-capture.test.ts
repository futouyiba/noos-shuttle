import { describe, expect, it } from "vitest";
import { captureNoosThreads } from "../src/core/thread-capture";

const VALID_THREAD = `Noise before
<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/c/example
target_agent: codex
status: active
created_at: 2026-05-02
title: build-noos-shuttle
tags: [noos, shuttle]
preferred_path: .noos/handoffs/active/2026-05-02-build-noos-shuttle.md
---

# Thread: Build NOOS Shuttle

## Intent
Create a useful prototype.

## Context Summary
The user wants a ChatGPT handoff extension.

## Task
Build the v0.

## Constraints
Keep it small.

## Acceptance Criteria
- [ ] Captures marker blocks.

## Suggested Next-Agent Instructions
Inspect the repo and continue.

## Open Questions
None.

## Relevant Files or Links
- README.md

<!-- NOOS:THREAD:END -->
Noise after`;

describe("captureNoosThreads", () => {
  it("captures a valid marker-wrapped thread", () => {
    const result = captureNoosThreads(VALID_THREAD, "2026-05-02T00:00:00.000Z");

    expect(result.errors).toEqual([]);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].title).toBe("build-noos-shuttle");
    expect(result.threads[0].warnings).toEqual([]);
    expect(result.threads[0].rawMarkdown).toContain("<!-- NOOS:THREAD:BEGIN -->");
  });

  it("captures multiple threads independently", () => {
    const result = captureNoosThreads(`${VALID_THREAD}\n${VALID_THREAD}`);

    expect(result.threads).toHaveLength(2);
  });

  it("ignores placeholder marker examples from generation prompts", () => {
    const result = captureNoosThreads(`<!-- NOOS:THREAD:BEGIN -->
...
<!-- NOOS:THREAD:END -->

${VALID_THREAD}`);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].title).toBe("build-noos-shuttle");
  });

  it("ignores placeholder marker examples when ellipsis is rendered as inline code", () => {
    const result = captureNoosThreads(`<!-- NOOS:THREAD:BEGIN -->
\`...\`
<!-- NOOS:THREAD:END -->

<!-- NOOS:THREAD:BEGIN -->
\`…\`
<!-- NOOS:THREAD:END -->

${VALID_THREAD}`);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].title).toBe("build-noos-shuttle");
  });

  it("repairs common ChatGPT line wrapping inside frontmatter", () => {
    const result = captureNoosThreads(`<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
source_app: chatgpt
source_url:
https://chatgpt.com/c/example
target_agent: codex
status: active
created_at: 2026-05-02
title: wrapped-frontmatter
tags:
- noos
- shuttle preferred_path: .noos/handoffs/active/2026-05-02-wrapped-frontmatter.md
---

# Thread: Wrapped Frontmatter

## Intent
Repair common browser extraction wrapping.

## Context Summary
ChatGPT can render a list item and the next key on one visual line.

## Task
Keep frontmatter usable.

## Constraints
Only repair known NOOS frontmatter keys.

## Acceptance Criteria
- [ ] Parses path and tags.

## Suggested Next-Agent Instructions
Continue from the repaired handoff.

## Open Questions
None.

<!-- NOOS:THREAD:END -->`);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].frontmatter?.source_url).toBe("https://chatgpt.com/c/example");
    expect(result.threads[0].frontmatter?.preferred_path).toBe(".noos/handoffs/active/2026-05-02-wrapped-frontmatter.md");
    expect(result.threads[0].frontmatter?.tags).toEqual(["noos", "shuttle"]);
  });

  it("repairs frontmatter keys collapsed into one rendered paragraph", () => {
    const result = captureNoosThreads(`<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread version: 0.1 source_app: chatgpt source_url: https://chatgpt.com/c/example target_agent: codex status: active created_at: 2026-05-02 title: collapsed-frontmatter tags:
- noos
- shuttle preferred_path: .noos/handoffs/active/2026-05-02-collapsed-frontmatter.md
---

# Thread: Collapsed Frontmatter

## Intent
Repair collapsed browser extraction.

## Context Summary
ChatGPT can expose multiple frontmatter text nodes as one paragraph.

## Task
Keep frontmatter usable.

## Constraints
Only split known NOOS frontmatter keys.

## Acceptance Criteria
- [ ] Parses required frontmatter.

## Suggested Next-Agent Instructions
Continue from the repaired handoff.

## Open Questions
None.

<!-- NOOS:THREAD:END -->`);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].frontmatter?.type).toBe("noos_thread");
    expect(result.threads[0].frontmatter?.version).toBe("0.1");
    expect(result.threads[0].frontmatter?.title).toBe("collapsed-frontmatter");
    expect(result.threads[0].frontmatter?.preferred_path).toBe(".noos/handoffs/active/2026-05-02-collapsed-frontmatter.md");
    expect(result.threads[0].warnings).toEqual([]);
  });

  it("warns when required sections are missing but keeps the raw handoff", () => {
    const result = captureNoosThreads(`<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
title: incomplete
---

# Thread: Incomplete
## Task
Do something.
<!-- NOOS:THREAD:END -->`);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].warnings).toContain("Missing required section: ## Intent / ## 意图.");
  });

  it("reports a broken marker range", () => {
    const result = captureNoosThreads("<!-- NOOS:THREAD:BEGIN -->\n# Thread: Broken");

    expect(result.threads).toHaveLength(0);
    expect(result.errors).toEqual(["Found a NOOS begin marker without a matching end marker."]);
  });

  it("accepts Chinese section headings", () => {
    const result = captureNoosThreads(`<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
source_app: chatgpt
target_agent: codex
status: active
created_at: 2026-05-02
title: 中文交接测试
tags: [noos, shuttle]
---

# 交接：中文交接测试

## 意图
验证中文格式。

## 背景摘要
用户希望中文工作流。

## 任务
继续开发。

## 约束
保持 marker 稳定。

## 验收标准
- [ ] 可以捕获中文章节。

## 建议给下一位代理的指令
读取交接稿并继续。

## 未决问题
无。

## 相关文件或链接
- README.md

<!-- NOOS:THREAD:END -->`);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].title).toBe("中文交接测试");
    expect(result.threads[0].warnings).toEqual([]);
  });

  it("accepts common Chinese aliases for agent instructions and open questions", () => {
    const result = captureNoosThreads(`<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
source_app: chatgpt
target_agent: codex
status: active
created_at: 2026-05-02
title: 中文别名测试
tags: [noos, shuttle]
---

# 交接：中文别名测试

## 意图
验证中文标题别名。

## 背景摘要
用户希望减少误报。

## 任务
继续开发。

## 约束
保持 marker 稳定。

## 验收标准
- [ ] 可以捕获中文章节。

## 给下一位代理的建议
读取交接稿并继续。

## 开放问题
无。

<!-- NOOS:THREAD:END -->`);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].warnings).toEqual([]);
  });
});
