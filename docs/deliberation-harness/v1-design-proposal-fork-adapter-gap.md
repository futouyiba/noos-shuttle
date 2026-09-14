# 设计提议：Child Spawn 的 provider 能力缺口（FORKED 路径）

> 状态：待裁定（提交 ChatGPT/设计方进一步思考）。实现 child lifecycle 接线时发现的**运行时能力缺口**，非契约缺陷。

## 1. 缺口

Child Worker Lifecycle §5 定义 spawn 的三种 provider 动作示例：fork 当前 Design 会话（Sedimentation）、新建会话（Independent Review）、开新 tab。§7 把 FORKED（继承会话历史）列为 Sedimentation 的 V1 主路径。

`noos-shuttle` 的 `src/content/chatgpt-dom.ts` 目前**没有任何 fork/branch/sidechain 操作**——现有 DOM 能力仅覆盖：composer 读写提交、附件、转录读取、生成态观察。`spawnChildWorker` 的注入式 adapter（已审切片）因此只能被 FRESH 路径真实满足（新会话创建≈导航+新会话，可由现有导航能力近似），**FORKED 路径无浏览器现实**。

## 2. 待裁定的问题

- **Q1**：ChatGPT Web 当前是否暴露任何会话 fork/branch 入口（share-fork、project branch、API 侧 clone）？若产品本身无此能力，V1 的 FORKED 主路径是否降级为"FRESH + 附带转录上下文包"（即用 context pack 承载历史，而非真 fork）？
- **Q2**：若降级，契约 §7 的"FORKED vs FRESH 二分"是否应改写为"历史传输方式"的正交维度（真 fork / transcript-context-pack / 无），使 `creationMode` 语义不被实现倒逼？
- **Q3**：真 fork 若只在 API/CLI 侧可行（如 backend 会话复制），是否属于 Provider Adapter Conformance 的 out-of-scope，由 Hub/CLI 路径承担而 browser shuttle 明确不支持？
- **Q4**：`SPAWN_UNCERTAIN` 的 reconcile（§16）在 FRESH 降级下如何举证"未创建"——新会话列表的观察是否能作为 non-creation 证据？

## 3. 建议（供讨论，非结论）

倾向 **Q2 的正交化 + Q3 的分工**：V1 browser shuttle 声明 FORKED-with-real-fork 为 provider-dependent；Sedimentation 的 V1 现实用"FRESH + transcript context pack"承载（context pack 生成能力已存在于 `src/core/context-pack.ts`），`creationMode` 保留语义但 spawn adapter 文档标注能力矩阵。这样 Step 6 可在浏览器现实内达成"可验收"，而真 fork 留给 adapter conformance 后续切片。

## 4. 影响

- 不阻塞 W5（delivery 接线）与已完成的全部核心切片。
- 阻塞"Step 6 browser-real"的验收声明：裁定前 `spawnChildWorker` 只能接 FRESH adapter，FORKED 主路径无运行时。
