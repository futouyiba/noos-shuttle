---
name: noos-design
description: Route or perform an epic-designer review or adjudication on a PR or proposal issue per the agent-workflow spec. Use when the user says a design trigger keyword (e.g. "design PR futouyiba/noos-shuttle#42") or invokes /noos-design with a PR or issue reference.
---

# noos-design

等价纯文本暗号：`design <ref>`（ref 为 PR 或携带 proposal 的 issue）。
权威展开：noos_docs `docs/agent-workflow.md` 附录 B（v0.3.0+）；冲突时
以附录 B 为准。

## 两种用法

**CC 会话收到 design**：本会话作为流转代理，生成给 designer 的极简
流转词（§2.2：verdict + 文档引用 + 具体请求；不复述契约原则与边界），
由用户转达 designer（ChatGPT）。

**designer 会话（ChatGPT，GitHub connector + 附录 B 已置入其上下文）
收到 design**：按 connector 读取 ref 的 diff 与 proposal / 契约文件，
结论评论到 PR，首行 `DESIGN: APPROVE|REQUEST_CHANGES|REJECTED`
（`REJECTED` 同时关闭 proposal issue）、次行 provenance——经
connector 发出写 `（des: via connector, 委派: <来源>）`，经人中继
写 `（des: relayed by <交付来源>）`；决定性表述原文引用（§2.3）；
对 reviewer 技术异议的重裁（§2.5）同此。

已合并 PR 上的 DESIGN findings 不要求原 PR 改动：由 orchestrator 以
新 `dispatch` 接续（follow-up issue 引用该评论）。
