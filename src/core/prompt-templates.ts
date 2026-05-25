import { createCrystalPreferredPath, createPreferredPath, slugify } from "./filename";
import type { ShuttleLocale } from "../shared/i18n";

const THREAD_BEGIN_MARKER_INSTRUCTION = "`<` + `!-- NOOS:THREAD:BEGIN --` + `>`";
const THREAD_END_MARKER_INSTRUCTION = "`<` + `!-- NOOS:THREAD:END --` + `>`";
const CRYSTAL_BEGIN_MARKER_INSTRUCTION = "`<` + `!-- NOOS:CRYSTAL:BEGIN --` + `>`";
const CRYSTAL_END_MARKER_INSTRUCTION = "`<` + `!-- NOOS:CRYSTAL:END --` + `>`";

export function createGenerateThreadPrompt(
  sourceUrl = globalThis.location?.href ?? "",
  locale: ShuttleLocale = "zh"
): string {
  const today = new Date().toISOString().slice(0, 10);
  const examplePath = createPreferredPath("example-thread-title", new Date(`${today}T00:00:00.000Z`));

  if (locale === "zh") {
    return `请基于当前对话生成一份 NOOS Thread / 交接稿。

这份交接稿的用途，是把当前讨论交给 Codex、Claude Code、OpenCode 等编码代理继续执行。

直接输出 marker 包裹的 Markdown 正文，不要使用 fenced code block，不要在 marker 外写解释、寒暄或补充说明。
避免使用三反引号；如必须引用代码，优先使用缩进代码块或简短行内代码，防止 Markdown 围栏不闭合。

交接稿必须被两个精确 HTML 注释 marker 包裹：
- begin marker 由这几段字符直接拼成，不要添加空格或反引号：${THREAD_BEGIN_MARKER_INSTRUCTION}
- end marker 由这几段字符直接拼成，不要添加空格或反引号：${THREAD_END_MARKER_INSTRUCTION}

重要：你的最终回答里只能出现一组 begin/end marker。不要输出格式示例，不要输出占位 marker 块。

使用 YAML frontmatter，字段保持英文键名：
- type: noos_thread
- version: 0.1
- handoff_revision: v1、v2、v3 这类递增版本号。若当前对话里已经有旧交接稿，请使用下一个版本号。
- source_app: chatgpt
- source_url: ${sourceUrl}
- target_agent: codex
- status: active
- created_at: ${today}
- title: 简短中文标题，必须具体，不要写“NOOS Thread”“交接稿”这类泛化标题
- handoff_key: 一个稳定、短小、表意的英文/拼音 key，例如 noos-hub-auto-connect
- filename_slug: 一个 3 到 8 个英文单词组成的短 slug，只能使用小写英文字母、数字和连字符，例如 noos-hub-auto-connect
- tags
- preferred_path，路径格式参考：${examplePath}

frontmatter 必须让用户可以区分多份交接稿：title、handoff_key、filename_slug、created_at、handoff_revision、status、target_agent、preferred_path 都要填写清楚。
filename_slug 和 handoff_key 只能依据当前交接稿内容命名，不要使用 example-thread-title、noos-thread、handoff、thread、untitled 这类占位词或泛化词。

正文请使用中文，并严格包含以下章节标题。不要改写、合并或删除这些标题；如果某一节没有内容，也保留标题并写“无”：
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

Output the marker-wrapped Markdown directly. Do not use a fenced code block, and do not include any explanation outside the markers.
Avoid triple backticks. If code is necessary, prefer indented code blocks or short inline code to avoid broken Markdown fences.

The handoff must be wrapped by two exact HTML comment markers:
- begin marker is made by directly joining these character chunks, with no extra spaces or backticks: ${THREAD_BEGIN_MARKER_INSTRUCTION}
- end marker is made by directly joining these character chunks, with no extra spaces or backticks: ${THREAD_END_MARKER_INSTRUCTION}

Important: your final answer must contain exactly one begin/end marker pair. Do not output format examples or placeholder marker blocks.

Use YAML frontmatter with:
- type: noos_thread
- version: 0.1
- handoff_revision: an increasing version label such as v1, v2, or v3. If older handoffs already exist in this conversation, use the next version.
- source_app: chatgpt
- source_url: ${sourceUrl}
- target_agent: codex
- status: active
- created_at: ${today}
- title: a short, specific title; do not use generic titles like "NOOS Thread" or "Handoff"
- handoff_key: a stable, short, semantic English key, for example noos-hub-auto-connect
- filename_slug: a short slug with 3 to 8 English words; use lowercase letters, numbers, and hyphens only, for example noos-hub-auto-connect
- tags
- preferred_path, using this pattern: ${examplePath}

The frontmatter must let the user distinguish multiple handoffs: title, handoff_key, filename_slug, created_at, handoff_revision, status, target_agent, and preferred_path must be explicit.
filename_slug and handoff_key must be based only on this handoff's content. Do not use placeholder or generic terms such as example-thread-title, noos-thread, handoff, thread, or untitled.

The body must include these exact section headings. Do not rewrite, merge, or remove them; if a section has no content, keep the heading and write "None":
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

export function createGenerateCrystalPrompt(
  sourceUrl = globalThis.location?.href ?? "",
  locale: ShuttleLocale = "zh"
): string {
  const today = new Date().toISOString().slice(0, 10);
  const keyExample = `${today.replace(/-/g, "")}-${slugify("example-crystal")}`;
  const examplePath = createCrystalPreferredPath(keyExample, new Date(`${today}T00:00:00.000Z`));

  if (locale === "zh") {
    return `请基于当前对话生成一份 NOOS Crystal / 讨论结晶。

用途：把本轮对话里可沉淀、后续可复用的信息保存成 Markdown，供用户、Codex 或其他 agent 之后按 key 检索使用。

不要复述全过程。只保留后续有用的信息。请用中文输出。

直接输出 marker 包裹的 Markdown 正文，不要使用 fenced code block，不要在 marker 外写解释、寒暄或补充说明。
避免使用三反引号；如必须引用代码，优先使用缩进代码块或简短行内代码，防止 Markdown 围栏不闭合。

结晶必须被两个精确 HTML 注释 marker 包裹：
- begin marker 由这几段字符直接拼成，不要添加空格或反引号：${CRYSTAL_BEGIN_MARKER_INSTRUCTION}
- end marker 由这几段字符直接拼成，不要添加空格或反引号：${CRYSTAL_END_MARKER_INSTRUCTION}

重要：你的最终回答里只能出现一组 begin/end marker。不要输出格式示例，不要输出占位 marker 块。

使用 YAML frontmatter，字段保持英文键名：
- type: noos_crystal
- version: 0.1
- source_app: chatgpt
- source_url: ${sourceUrl}
- status: active
- created_at: ${today}
- crystal_key: 一个稳定、短小、表意的英文/拼音 key，例如 ${keyExample}
- title: 中文标题
- summary: 一句话摘要，方便在列表中选择
- tags
- preferred_path，路径格式参考：${examplePath}

正文必须包含以下章节：
# 结晶：<标题>

## 已确认结论
## 合理推断
## 未决问题
## 下一轮最值得继续讨论的 3 个入口

要求：
1. 不要复述全过程。
2. 只保留后续有用的信息。
3. 区分：已确认结论 / 合理推断 / 未决问题。
4. 输出 Markdown。
5. 末尾给出“下一轮最值得继续讨论的 3 个入口”。`;
  }

  return `Please generate a NOOS Crystal / discussion snapshot from the current conversation.

Purpose: preserve reusable conclusions and context as Markdown so the user, Codex, or another agent can retrieve it later by key.

Do not recap the whole process. Keep only information that is useful later.

Output the marker-wrapped Markdown directly. Do not use a fenced code block, and do not include any explanation outside the markers.
Avoid triple backticks. If code is necessary, prefer indented code blocks or short inline code to avoid broken Markdown fences.

The crystal must be wrapped by two exact HTML comment markers:
- begin marker is made by directly joining these character chunks, with no extra spaces or backticks: ${CRYSTAL_BEGIN_MARKER_INSTRUCTION}
- end marker is made by directly joining these character chunks, with no extra spaces or backticks: ${CRYSTAL_END_MARKER_INSTRUCTION}

Important: your final answer must contain exactly one begin/end marker pair. Do not output format examples or placeholder marker blocks.

Use YAML frontmatter with:
- type: noos_crystal
- version: 0.1
- source_app: chatgpt
- source_url: ${sourceUrl}
- status: active
- created_at: ${today}
- crystal_key: a stable, short, semantic key, for example ${keyExample}
- title
- summary: one concise sentence for chooser lists
- tags
- preferred_path, using this pattern: ${examplePath}

The body must include:
# Crystal: <title>

## Confirmed Conclusions
## Reasonable Inferences
## Open Questions
## 3 Best Entry Points for the Next Round

Requirements:
1. Do not recap the full conversation.
2. Preserve only reusable information.
3. Separate confirmed conclusions, reasonable inferences, and open questions.
4. Output Markdown.
5. End with the 3 best entry points for the next round.`;
}
