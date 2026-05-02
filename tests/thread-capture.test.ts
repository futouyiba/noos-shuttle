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
});
