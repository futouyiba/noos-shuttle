---
name: noos-implement
description: 'Start an implementation task from a task issue per the agent-workflow spec (read the issue, work on an isolated branch, implement, verify, get independent review, open a draft PR citing review evidence). Use when the user says an implement trigger keyword (e.g. "implement #41", "接单 #41") or invokes /noos-implement.'
---

# noos-implement

等价纯文本暗号：`implement #N`（缩写 `impl`；接受 `接单`）。权威展开：
noos_docs `docs/agent-workflow.md` 附录 B（v0.3.0+）；冲突时以附录 B
为准。

## 步骤

1. 解析 issue 指针（宽松归一：`#41` / `＃41`；裸数字仅按规范 B.2
   双条件——消息中再无其它数字、任务线上恰有唯一活跃对象——识别）；
   歧义时向用户确认，不猜。`gh issue view <N> --comments` 读任务书
   全部评论（含裁定引用与 DESIGN / REVIEW 线索）。
2. 在独立 branch / worktree 工作（主 checkout 归 integrator，§3.4），
   遵循本仓库 AGENTS.md 工作原则。
3. 触及语义或契约、须裁定的先走规范 §2：proposal 文档入 docs/，以
   issue / PR 评论传递并触发 `design`；不得以自判"不涉及裁定"绕过。
4. 按 AGENTS.md「验证」节跑最小充分验证，绿后提交。
5. 建 draft PR（`gh pr create --draft`，body 可暂空）。
6. 委派独立 review：先在任务 issue 或 PR 线程留委派记录（`rev:
   review PR#M`），再触发 `review PR#M`（本机直连或人转达）。行为
   标准 §1.2；本仓惯例 reviewer subagent 用 fable 模型——以会话内
   subagent 形式执行时，REVIEW 标记由本会话转述发布，provenance
   如实写 `（rev: relayed by impl, 委派: impl）`，会话内 reviewer
   的行为独立性在评论正文说明。
   REQUEST_CHANGES 修复后重审直至 APPROVE。
7. APPROVE 后补 PR body：review 证据链接（指向该 REVIEW 标记评论）
   + 被审 exact head SHA（§1.3）。
8. 任务 issue 回帖，首行标记 `IMPLEMENTED: PR#M`、次行 provenance
   （如 `（impl: 直评）`）。
