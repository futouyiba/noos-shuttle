---
name: noos-implement
description: 'Start an implementation task from a task issue per the agent-workflow spec (read the issue, work on an isolated branch, implement, verify, get independent review, open a draft PR citing review evidence). Use when the user says an implement trigger keyword (e.g. "implement #41", "接单 #41") or invokes /noos-implement.'
---

# noos-implement

等价纯文本暗号：`implement #N`（缩写 `impl`；接受 `接单`）。权威展开：
noos_docs `docs/agent-workflow.md` 附录 B（v0.3.2+）；冲突时以附录 B
为准。

## 步骤

1. 解析 issue 指针（宽松归一：`#41` / `＃41`；裸数字仅按规范 B.2
   双条件——消息中再无其它数字、任务线上恰有唯一活跃对象——识别）；
   歧义时向用户确认，不猜。`gh issue view <N> --comments` 读任务书
   全部评论（含裁定引用与 DESIGN / REVIEW 线索）。
2. 在独立 branch / worktree 工作（主 checkout 归 integrator，§3.5），
   遵循本仓库 AGENTS.md 工作原则。
3. 触及语义或契约、须裁定的先走规范 §2：proposal 文档入 docs/，以
   issue / PR 评论传递并触发 `design`；不得以自判"不涉及裁定"绕过。
4. 按 AGENTS.md「验证」节跑最小充分验证，绿后提交。
5. 建 draft PR（`gh pr create --draft`，body 可暂空）。
6. 委派独立 review：先在任务 issue 或 PR 线程留委派记录（`rev:
   review PR#M`），再触发 `review PR#M`（本机直连或人转达）。行为
   标准与执行上下文条件见 §1.2(a)；本仓惯例 reviewer subagent 用
   fable 模型，且必须以只读工具集 spawn（不含 Edit/Write 类工具，
   Bash 不改写被审工作区）。REVIEW 标记由本会话转述发布时
   provenance 写 `（rev: in-session subagent, 委派: impl）`。
   REQUEST_CHANGES 修复后重审直至 APPROVE。
7. APPROVE 后补 PR body：review 证据链接（指向该 REVIEW 标记评论）
   + 被审 exact head SHA（§1.3）。
8. 只有 PR body 用普通链接明确关联任务 issue 且 issue 时间线可反查
   该 PR 时，才可省略 `IMPLEMENTED`；否则在 issue 回帖精简指针：首行
   `IMPLEMENTED: PR#M @ <head>`、次行 provenance。不复制 PR body、
   验证或 review 正文。不得用 `Closes`／`Fixes`／`Resolves` 等自动关闭
   关键词；issue 只在集成验证与验收完成后关闭。
9. 自动通知（无需向人请示——通知类动作不是敏感动作）：send_message
   前，先在 PR 线程留下 `intg: merge PR#M` 与 provenance 的最小委派
   记录；再给 integrator 会话只投递同一指针，并通知 orchestrator。
   指针和记录都不授权合并；授权、head、review 证据与范围由各自原始
   记录提供，不在消息中复制。`ccd_session_mgmt list_sessions` 按标题／
   分支定位 integrator。
