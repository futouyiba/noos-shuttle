# 文档优化清理报告（2026-10-28，执行轮）

- 基线：`0af0ac4f0162f4ecd7d0146adcc12ddc3133e947`
- 范围：第一轮诊断报告批准的 D1-D5；入口文档、`docs/` 相关索引、点名的长文档与 carrier proposal。
- 排除：`.git`、`node_modules`、`.review-intake`、`.tmp`、测试夹具、`.noos` runtime projection/history。未无差别重写全部 docs。
- 原则：历史事实、证据、规则、枚举、代码标识、命令、路径、链接目标和公式保留；不确定的 authority drift 只加状态说明。

## 处置总表

| Finding | 文件 | 处置 | 结果 |
| --- | --- | --- | --- |
| D1 | `README.md`、`README.zh-CN.md` | 修正/压缩 | 文档索引改为“当前或运行参考 / 设计提案与历史记录”两层，并指向 deliberation-harness 索引。补充 canonical 优先说明。 |
| D2 | `docs/deliberation-harness/README.md` | 新增索引/状态标注 | 新增“先读 / 当前相关记录 / 提案与待裁定材料 / 历史与证据 / 状态规则”分组；不改历史正文。 |
| D3 | `docs/noos-doc-forger.md` | 加 banner；保留原文归档 | 明确为历史设计草案；新增当前阅读提示。归档映射见下表。 |
| D3 | `docs/noos-context-pack-background-layer.md` | 加 banner；保留原文归档 | 明确为历史设计评审与实现拆解；新增当前阅读提示。归档映射见下表。 |
| D3 | `docs/deliberation-harness/doc-governance-proposal-v0.md` | 加 banner | 明确为历史 Candidate 提案，不自动作用于其他文档；补入口和 authority 指针。原文归档。 |
| D4 | 本轮触及的 live/index 文案 | 最小中文优先 | README 中文版保持中文；新增索引和 banner 使用中文，技术标识、路径、枚举与正式名称保留。历史正文未批量翻译。 |
| D5 | `docs/carrier-summon-v2-proposal.md` | 修正行号 | 按当前代码复核，将 Rust 引用从 `376-390` 修为 `384-400`；其余引用核对后未发现需改的事实。 |

## 归档映射与完整性

以下归档是清理前的逐字节副本，归档目录为 `docs/archive/2026-10-28-doc-cleanup/`：

| 源文件 | 归档文件 | SHA-256 |
| --- | --- | --- |
| `docs/noos-doc-forger.md` | `docs/archive/2026-10-28-doc-cleanup/noos-doc-forger.md` | `1a517016f6305d7ac99939363bcb5e1f13942e4ee536ef2cc0cb5ac618221db4` |
| `docs/noos-context-pack-background-layer.md` | `docs/archive/2026-10-28-doc-cleanup/noos-context-pack-background-layer.md` | `bdb3f7b1bbd14a4d1bd3c2a248af997f94ef7b4044bd8e8927512be5916d8883` |
| `docs/deliberation-harness/doc-governance-proposal-v0.md` | `docs/archive/2026-10-28-doc-cleanup/doc-governance-proposal-v0.md` | `19be41c26a7388e5a0028dc74f76bee301a4621a189a3bd21739c14be0dd6cf4` |

`noos-doc-forger.md`、`noos-context-pack-background-layer.md` 和
`doc-governance-proposal-v0.md` 的归档副本均已在写入 banner 前生成；当前文件增加了 banner，因此当前文件 hash 不再与归档相同。

## 未解决的 authority 决策

- `docs/deliberation-harness/cross-agent-handoff-escalation-contract-v3.md` 是仓库内当前实现向设计候选，但其顶部明确规定：与 `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1` 的 authoritative contracts 冲突时以上游为准。本轮没有自行把它提升为仓库或上游的最终契约。
- `docs/deliberation-harness/doc-governance-proposal-v0.md` 的 `Authority-Level: Candidate` 仍是历史提案内容；本轮只加 banner，没有将其规则 retroactively 应用于全部 docs。
- 其他 docs 的实现状态和源码行号没有在本轮全面重写。仍需逐主题复核的文档保留原状态，避免把未核实内容改成当前规则。

## 未变更理由

- 未重写四个点名长文档的主体：报告建议“分批压缩/归档”，但本轮批准的最小安全处置优先解决入口误读和状态边界。完整原文已归档，主体事实和证据未丢失。
- 未为所有 71 个 Markdown 文件加 banner：这会扩大修改面，且没有逐文件 authority 证据。
- 未把 `README.md` 的全部内容翻译成中文：根目录已有中英文双入口，本轮只按 D1 修正索引分层；技术文档的历史正文默认不批量翻译。

## 验证记录

已完成：

- 重新核对工作树：基线为 `0af0ac4f0162f4ecd7d0146adcc12ddc3133e947`；发现主 checkout 存在用户已有未提交文件，本 worktree 未触碰这些文件。
- 复核 `src/shared/provider-identity.ts` 的 13 个 host 与 6 种路由模式。
- 复核 Hub `main.rs`：host 常量位于 `384-400`，URL 提取函数位于 `498-520`。
- 复核扩展 `carrier-focus.ts:106-123` 与 `focus-runtime.ts:54-63`，确认 proposal 中的 Focus 行为描述与代码一致。
- 归档副本 SHA-256 对照完成。
- 对本轮 7 个触及的 Markdown 文件解析相对链接：0 个断链。
- 运行 `git diff --check`：通过。
- 最终变更文件均为批准范围内的 Markdown 文件；未修改代码、测试夹具或运行时投影。
- 仓库未提供统一的 docs-only 文案审计脚本；`scripts/audit.mjs` 不存在，因此没有声称运行该脚本。

## 未解决的 authority 决策
