# 裁决自动往返 MVP — 开发交接方案

> 状态：Designer 提出的可开发切片，待独立评审；不是对自身方案的 APPROVE。
> 用户请求：“迅速设计裁决相关的整体流程，并让 cc 据此开发。现在好多裁决都会卡人工流程”。
> 本次允许准备和投递 CC 开发任务；不授权自动合并、部署、关闭旧任务或修改已批准契约。

按需阅读：[闭环](#2-闭环与人工边界) → [切片](#4-开发切片与既有任务) → [验收](#5-验收与停止条件)。实现细节发生契约冲突时，返回最小反例，不重开已经闭合的 F/R/N/M/K。

## 1. 目标、范围与读取基线

目标是移除“人搬运问题、提醒裁决方、搬回答案、提醒开发查看”的四段劳动，不移除真正保留给人的决定。第一条工作线只覆盖同一仓库、已明确委派的一名设计负责人及一项 Coding 工作；不先实现通用团队调度、fork、主题锁或复杂 Governor。

- 产品依据：[当前工作设计稿](../noos-cross-specialty-harness-product-design.md) §3、§4.3；其中候选不因被引用自动变成已批准契约。
- 技术契约：[v3](cross-agent-handoff-escalation-contract-v3.md)，沿用其 `noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1` 权威基线与 §19 七项门禁。
- 协作流程：`noos_docs@984bb0528def828de65b0f2ea1107ae4f4f58a38` 的 `docs/agent-workflow.md`；这是开发协作规范版本，不替换技术契约基线。
- 当前实现观察锚点：`noos-shuttle@01e88f4a83195417253a89da865a458589188cf6`，2026-09-21 查询。它是实现参考，不自动成为在途工作的 Authority Basis。
- [#10](https://github.com/futouyiba/noos-shuttle/issues/10) 已关闭；复用 GitHub mailbox，不重新实现。[PR #92](https://github.com/futouyiba/noos-shuttle/pull/92) 已合并，outbox 可作为集成依赖；[#63](https://github.com/futouyiba/noos-shuttle/issues/63) 仍开放，不能据 merge 推定所有恢复缺口已解决。
- 本地 watcher 历史记录出现过无人值守投递通道不可用、已认领未送达、人工再次排空；这只是故障样本，不是当前通道探测结果。须在实际执行宿主验证，不能以交互式会话能发送证明后台也能发送。

## 2. 闭环与人工边界

```text
CC 遇到超出实现权限的明确问题
→ 保留原任务，持久化 Escalation 与有界 proposal / packet
→ GitHub 留不可变引用；由已授权路由投递唤醒
→ 原设计负责人依序处理：答复 / 追问 / 交有权方决定
→ 捕获并保存与原 packet 对应的结果与裁定原文
→ 回到原 CC 任务，确认收件
→ 既有 Policy / Reducer 核验后，决定能否恢复原操作
```

| 环节 | 正常自动完成 | 何时需要人 |
| --- | --- | --- |
| 准备问题 | CC 给出具体冲突、准确依据、证据、候选与请求范围；实现内问题仍本地解决 | 用户独有资料缺失，或涉及新的外发授权 |
| 找负责人 | 沿用任务已有角色 / Logical Thread 关联，不按窗口名猜测 | 第一次绑定缺失或角色委派确有歧义；不逐条重新配置 |
| 唤醒与处理 | 向已登记且有相应授权的接收通道投递本次有界工作；忙时排队 | 没有可用接收通道时明确阻塞并请求一次配置，不让人日常搬运 |
| 裁决或追问 | 指定设计角色按既有权限回答；证据追问自动回原 CC，补充继续关联原问题 | 人类保留决定，或实际权限扩展；不能把一切 NEEDS_DESIGN 都升级成人工 |
| 返回结果 | 原文、来源与适用版本回到原任务；失败保留结果重试投递 | 发送是否发生不明且不能自动核实，或返回归属有冲突 |
| 继续开发 | 仅在已有授权、全部 blocker 已解除及运行门禁通过后继续 | 七项自动恢复门禁尚无充分实现及独立验证证据时，保留现行人类介导路径 |

**收到结果的 CC 可以被唤醒以读取结果，但唤醒不等于允许继续被阻塞的实现操作。** 人工确认必须指向具体问题、依据及允许动作，不是“放行所有后续工作”。

第一期应做到零人工复制、零人工提醒“去看问题”、零逐次点击触发已授权的裁决思考；若恢复门禁未通过，明确显示最后仍需人工介导，不把它宣传为无人值守开发闭环。

## 3. 最小职责与可靠性规则

### 3.1 三种承载各做什么

- GitHub：沿用原任务 Issue / PR 及 mailbox 保存问题、proposal 引用、裁定与 review 证据；不是每条追问另开 Issue。正式决定保留决定性表述原文及 provenance。
- Hub / 运行适配器：由已批准的任务身份确定收发目的地，保存投递与回执关联，向可用的已授权会话通道提交有界工作。普通 GitHub 评论、角色前缀与 verdict 标记只是观察或唤醒线索，不能单独授权执行。
- Shuttle：仅在目标确为浏览器对话时承担投递、观察和结果捕获；不得强制所有设计工作先经过浏览器。原生会话若已有受支持通道，可先走同一契约的原生通路。

### 3.2 不把邮箱误当成唤醒

必须分别保留“发现请求”“尝试投递”“接收通道确认”“裁决结果产生”的证据。轮询成功、评论已发布或 claim 已保存，都不能显示为裁决方已接单。复用现有投递记录，不另建语义 WAIT/RUN 控制面。

在发送前检查登记的目标、授权与通道能力。明确未尝试发送的通道故障，与发送结果不明分开呈现；是否可以重试仍由适用的既有投递契约判断，不能把历史 CLAIMED 全部重放，也不能把超时当作未发送证据。接收方按稳定工作 / 投递身份去重，不因重复唤醒重复裁决。

通道不可用是可见的投递阻塞，不是裁决意见，更不是 D4 式“结构上没有收件人”的结论。恢复只重试原关联，不自动换设计负责人。只对新出现或有变化的可行动阻塞提示用户，普通往返不逐条弹窗；历史欠账不在此任务里擅自清理。

### 3.3 浏览器接续与人类输入

复用现有 outbox / SubmissionOperation、唯一 binding、lease/fence、READY 与恢复规则；不得另走 DOM 点击或 focus 通道绕过账本。人类草稿不覆盖，UNCERTAIN 不跳过，未经确认的发送不重发。

外部 Agent 请求不是排队的人类留言：不得伪装为 #63 的 Human `OUTBOX_MESSAGE`，也不得继承其 Go × N 人类回合例外。CC 须给出请求和结果分别映射何种现有操作的证据；确实需要新 operation specialization 或改变优先级时，提出窄契约差异后再实现该部分。现有 #63 的 Human 输入优先于自动 GO 的裁定不在本任务重裁。

### 3.4 裁决结果与恢复

复用 HandoffPacket 的不可变 revision/fingerprint、WorkerResult / HandoffResult 及 ResultDelivery；不引入平行结果账本。结果绑定原 packet / Escalation、原任务和确切依据；保留决定、限制、未决问题及原文证据。不能抓“页面最后一段文字”作为任何请求的结果。

任务身份不随窗口、会话重载或来源 CC 的载体更换而变化。结果送往当前合法载体；源任务已经取消、被替代或依据已变化时，不恢复旧操作，按已有迟到 / supersession 语义处理并显示负责方。

严格区分 repo 协作标记与产品 runtime 结果。沿用已生效 B.3 语法；不将 `PARTIAL_ACCEPT`、自由文本或未知 verdict 猜成无条件 APPROVE。PR #94 的开放 verdict 提案未激活前，不在本任务中偷偷启用。未知意见保留原文，交有权角色澄清；可读通知不授予 fix、merge、close 或 resume 权限。

### 3.5 实现入口与已知缺口

下表是 `a7cf19c1f736efb63f42f4ca35ba98d882bcd7a7` 上的只读代码调查，不是远端当前功能验收。CC 须在实际开发起点核对；尤其该旧工作树不包含 PR #92 的 outbox 增量。

| 复用入口 | 调查发现与限制 |
| --- | --- |
| `src/core/cross-agent-mailbox.ts`、`scripts/noos-mailbox.mjs` | 已有 open / packet revision / result observation / GitHub 传输；当前调查路径限定 HUMAN_MEDIATED，不能视为自动恢复已实现 |
| `src/core/submission-operation.ts`、`src/core/deliver-child-result.ts`、`src/background/delivery-runtime.ts` | 有 prepare/claim/fence/UNCERTAIN 与可靠 child-result 投递；child 的 `resultRef` 路径不是可直接冒用的通用外部裁决请求 |
| `src/content/index.ts`、`src/content/chatgpt-dom.ts`、`src/background/service-worker.ts` | 存在受控注入与生成捕获基础；既有 Thread handoff 捕获不等于裁决结果捕获，外部 CC 接入亦需明确入口鉴权与关联 |
| `scripts/noos-watch-state.mjs` | 是已有协作标记分类 / 投影，不是完整会话投递通道；不能把产品 Escalation packet 当成已有 B.3 verdict |
| `tests/cross-agent-mailbox.test.ts`、`tests/noos-mailbox-cli.test.ts`、`tests/delivery-runtime.test.ts` | 可承接邮箱完整性、fake GitHub 流程与丢 ACK / rollover 集成回归；实际目标平台测试仍需补充 |

## 4. 开发切片与既有任务

依托 [#7](https://github.com/futouyiba/noos-shuttle/issues/7)，复用 [#11](https://github.com/futouyiba/noos-shuttle/issues/11)、[#12](https://github.com/futouyiba/noos-shuttle/issues/12)、[#13](https://github.com/futouyiba/noos-shuttle/issues/13)，不复制创建同目标任务。旧 Issue body 的状态词与当前 v3 冲突时，以 v3 为准。

| 顺序 | CC 交付 | 边界 |
| --- | --- | --- |
| A：收发贯通 | #12 的 CC 发起 / 接收适配与 #11 的裁决侧单次接单 / 回传接口；先选一个真实可用、已授权的设计载体。验证实际后台执行环境的能力，而不只做 dry-run | 不需要先做通用 UI、webhook 或持续自主 run；缺少真实唤醒能力时必须明确指出，不能以“已有评论”交差 |
| B：人在场时可用 | 若目标是 ChatGPT，接入现有 outbox 与投递机制；满足请求来源区分、草稿保护、单次处理、精确结果关联及失败恢复 | 不重做 #63，不冒用 Human 来源；需要契约扩展的部分先隔离裁定 |
| C：受控恢复 | 为 v3 §19 的七项门禁逐项提供实现位置、反例测试及独立 review 证据；全部满足后才允许相应模式自动恢复 | 尚未通过时 A / B 仍可减少人工中继；必须保留明确的最终恢复边界 |
| D：闭环证据 | #13 用一项已授权的真实工作展示提问、排队、裁决、原任务收件及可恢复 / 仍阻塞的实际结果 | 模拟通过不是实际唤醒成功；不得修改生产欠账或制造敏感动作证明流程可用 |

七项门禁不重写：Authority Basis/current pointer；模板版本与 K1 grounding；非空确定性 materialization 与 rules；reducer / 幂等 receipt；withdrawal；迟到结果冲突通知与 owner；PendingHumanGate ordering。详细条件见 v3 §19–21。当前任务不声称这些已通过，也不以产品需求覆盖它们。

## 5. 验收与停止条件

| 场景 | 必须观察到的结果 |
| --- | --- |
| 一项正常裁决请求 | 用户不复制、不提醒、不逐次点击；正确裁决方实际接单并答复，结果回原 CC |
| 裁决方正在回应用户 | 已授权请求排队；用户仍可保存 / 提交下一条；草稿不丢，来源不混淆 |
| 缺证据 | 具体追问自动往返同一问题；无用户独有资料时不要求用户中继 |
| 重复评论 / 重启 / 重复唤醒 | 身份与指纹一致时关联原记录；不重复语义执行，不另建任务 |
| 通道在无人值守环境不可用 | 显示实际未送达原因与可恢复动作；不留下虚假的成功回执，不循环要求人重新分类同一故障 |
| 发送后崩溃 / 回执丢失 | 核实原操作；不能证明未发生时 fail closed，不盲重发或越过队首 |
| 改写 comment / 同 ID 不同 fingerprint | 保留原观察，记录完整性冲突；不可覆写已消费决定 |
| 目标变更 / 源工作失效 | 不送错窗口、不复活旧工作；显示哪一方需要处理 |
| 普通人类消息紧跟裁决输出 | 只有该次请求的可信结果回传，不泄露或误传后续私人对话 |
| 未知 / 有条件 verdict | 原文保留，不降格成无条件批准，不触发敏感动作 |
| 尚有 OPEN Escalation / 任一恢复 gate 不满足 | 可以送达结果，但被阻塞操作不继续 |
| 人类保留决定 | 只呈现需要决定的事项及范围，不把审批变成全局授权 |

CC 在隔离工作区先执行 review intake，确认起点、dirty 状态、已有改动及适用指令；不可从本设计工作树整体合并到 main。开发前说明最小写入范围和对应测试。设计稿是交接依据，实际实现基线需明确记录。

缺少可信身份、授权、可用原生唤醒通道，或既有 operation 无法表达该动作时，停止受影响的自动动作，交回具体缺口与最小提案；不要用人工轮询脚本冒充自动闭环。可以继续不依赖该缺口的适配、测试及只读展示。

独立 review 必须符合工作流的执行上下文和无写入要求，引用 exact head；作者验证不是 APPROVE。未授权不 push、合并、部署、关单或修改规范。此交接只安排开发与验证，不顺便处置 #21、#63 或历史 watcher 欠账。
