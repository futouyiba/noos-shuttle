---
name: noos-design
description: Route or perform an epic-designer review or adjudication on a PR or proposal issue per the agent-workflow spec. Use when the user says a design trigger keyword (e.g. "design PR futouyiba/noos-shuttle#42") or invokes /noos-design with a PR or issue reference.
---

# noos-design

等价纯文本暗号：`design <ref>`。权威规则：noos_docs
`docs/agent-workflow.md` 当前 canonical；冲突时以 canonical 为准。

## 两种用法

**流转会话**：只转发动作和 ref，不复述 proposal。

**designer 会话**：读取 ref、相关契约和必要 diff，
结论评论到 PR，首行 `DESIGN: APPROVE|REQUEST_CHANGES|REJECTED`
、次行 provenance；正文引用被裁对象和决定性原文。内容未变不重复
裁定；是否发生语义变化由 reviewer／integrator 判断，拿不准再重裁。

已合并 PR 的新 findings 另立 follow-up issue。
