# Agent 指令

## 仓库定位

本仓库是 NOOS Shuttle 的实现仓库，不是一个使用 NOOS 的下游项目目录。

NOOS Shuttle 是用于在 Chatbox、Agent、Coding Agent 和创作工具之间生成、保存、转移、消费 handoff 的 monorepo。仓库内的 `.noos/`、skills、handoffs、runtime 示例和脚本都可能是产品实现、测试夹具或开发交接材料；不要把它们默认当作外部业务项目的 NOOS Vault。

## 回复语言

始终使用中文回复。

## 工作原则

1. 先确认任务属于浏览器扩展、NOOS Hub、Agent skills、安装脚本、协议文档、测试或发布流程中的哪一类，再决定阅读范围。
2. 默认做小而明确的实现变更，遵循 KISS、YAGNI、DRY 和 SOLID；不要引入与当前需求无关的抽象、依赖或重构。
3. 修改前先阅读相关代码、脚本、测试和文档；不要基于猜测改动协议或跨端行为。
4. 优先保持现有结构和风格：TypeScript 浏览器扩展代码在 `src/`，桌面应用在 `apps/`，自动化和发布脚本在 `scripts/`，测试在 `tests/`。
5. 涉及 UI 文案时保持中英文 i18n 一致；涉及注释时保持文件现有注释语言一致。

## NOOS 实现相关规则

只有当用户明确要求处理 handoff、继续 NOOS Thread、消费 `.noos/handoffs/active/`，或任务本身直接涉及 handoff/runtime 行为时，才按 NOOS consume-handoff 流程读取 active handoff。

需要消费 handoff 时：

- 优先使用已安装的 `noos-consume-handoff` skill。
- 如果该 skill 未安装，读取 `.noos/skills/noos-consume-handoff/SKILL.md` 并按其中流程执行。
- 除非用户要求生命周期清理，或任务已明确完成，否则不要将 active handoff 移动到 `.noos/handoffs/done/`。

如果任务明确涉及 `.noos/runtime/current/`：

1. 先读取 `.noos/runtime/current/READ_ME_FIRST.md`。
2. 使用 `.noos/runtime/current/sources/` 下的投影来源文件。
3. 除非明确要求，不要扫描完整 NOOS Vault。
4. 实现前给出简洁计划。
5. 将结果摘要写入 `.noos/runtime/current/RESULT_SUMMARY.md`。

## 验证

按变更范围选择最小充分验证：

- 浏览器扩展或共享 TypeScript 逻辑：`npm run typecheck`、相关 `vitest`，必要时 `npm run build`。
- NOOS Hub：优先运行 `npm run hub:web:build`，涉及 Rust 后端时运行对应 `cargo test` 或 `npm run hub:build`。
- LLM Wiki：优先运行 `npm run wiki:typecheck`、`npm run wiki:test` 或 `npm run wiki:build`。
- 发布、安装、sleep/resume、doctor 脚本：运行对应脚本的 self-test 或最小可复现检查。

如果无法运行验证，说明原因和剩余风险。

## NOOS Hub 发布签名

关于 Tauri updater 签名密钥托管、GitHub secret 名称、本地密钥路径和发布验证步骤，读取 `docs/noos-hub-updater-signing.md`。

绝不要提交、打印或总结 updater 私钥或签名密码的内容。可以安全引用文档中记录的密钥路径和 GitHub secret 名称。
