import { createPreferredPath } from "./filename";
import type { ShuttleLocale } from "../shared/i18n";

export function createGenerateThreadPrompt(
  sourceUrl = globalThis.location?.href ?? "",
  locale: ShuttleLocale = "zh"
): string {
  const today = new Date().toISOString().slice(0, 10);
  const examplePath = createPreferredPath("example-thread-title", new Date(`${today}T00:00:00.000Z`));

  if (locale === "zh") {
    return `请基于当前对话生成一份 NOOS Thread / 交接稿。

这份交接稿的用途，是把当前讨论交给 Codex、Claude Code、OpenCode 等编码代理继续执行。

只输出一个 markdown 交接块。不要在交接块外写解释、寒暄或补充说明。

交接稿必须被以下精确标记包裹：

<!-- NOOS:THREAD:BEGIN -->
...
<!-- NOOS:THREAD:END -->

使用 YAML frontmatter，字段保持英文键名：
- type: noos_thread
- version: 0.1
- source_app: chatgpt
- source_url: ${sourceUrl}
- target_agent: codex
- status: active
- created_at: ${today}
- title
- tags
- preferred_path，路径格式参考：${examplePath}

正文请使用中文，并包含以下章节：
# 交接：<标题>

## 意图
## 背景摘要
## 任务
## 约束
## 验收标准
## 建议给下一位代理的指令
## 未决问题
## 相关文件或链接

要求：内容简洁但完整，让下一位代理不必重读整段对话，也能理解背景、任务、约束和验收标准。`;
  }

  return `Please generate a NOOS Thread / Handoff based on the current conversation.

The purpose is to hand off this discussion to a coding agent such as Codex, Claude Code, or OpenCode.

Output only one markdown handoff block. Do not include any explanation outside the block.

The handoff must be wrapped by these exact markers:

<!-- NOOS:THREAD:BEGIN -->
...
<!-- NOOS:THREAD:END -->

Use YAML frontmatter with:
- type: noos_thread
- version: 0.1
- source_app: chatgpt
- source_url: ${sourceUrl}
- target_agent: codex
- status: active
- created_at: ${today}
- title
- tags
- preferred_path, using this pattern: ${examplePath}

The body must include:
# Thread: <title>

## Intent
## Context Summary
## Task
## Constraints
## Acceptance Criteria
## Suggested Next-Agent Instructions
## Open Questions
## Relevant Files or Links

Make it concise but complete enough for another agent to continue the work without rereading the full conversation.`;
}
