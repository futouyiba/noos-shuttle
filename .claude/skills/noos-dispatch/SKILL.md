---
name: noos-dispatch
description: Orchestrate a new implementation task per the agent-workflow spec (write the task issue, split slices, hand implement #N to a worker session). Use when the user says a dispatch trigger keyword (e.g. "dispatch 修复X", "派单 修复X") or invokes /noos-dispatch.
---

# noos-dispatch

等价纯文本暗号：`dispatch <ref 或一句话>`（接受 `派单`）。权威展开：
noos_docs `docs/agent-workflow.md` 附录 B（v0.3.0+）；本 skill 只是显式
入口，冲突时以附录 B 为准。接收角色：orchestrator（本会话承担编排时）。

## 步骤

1. 输入是 issue ref → 直接使用；是一句话 → 先写成任务 issue
   （`gh issue create`，body 含目标、验收标准、约束、provenance：
   来源请求与已有裁定引用）。
2. 拆分切片（小而完整、可独立验收）；每片对应独立分支 / worktree。
3. 投递：本机可直连的实现会话用 send_message 投 `implement #N`；
   无法直连则在任务 issue 评论 `impl: implement #N` 由人转达。
4. follow-up 同此路径，包括把已合并 PR 上的 DESIGN findings 立为
   新任务（新 issue 引用该评论）。
5. orchestrator 只编排不实现；机械例外见规范 §3.2，须逐次声明并在
   提交信息注明。
