import type { HubHealth } from "../types";
import { escapeHtml, formatDisplayPath } from "../ui/html";

export function renderHelp(health: HubHealth): string {
  const vaultPath = formatDisplayPath(`${health.noos_home}/vault`, health.noos_home);
  const handoffPath = formatDisplayPath(`${health.noos_home}/vault/handoffs/active`, health.noos_home);
  const crystalPath = formatDisplayPath(`${health.noos_home}/vault/crystals/active`, health.noos_home);
  const mirrorPath = "~/Downloads/NOOS/vault";

  return `
    <section class="help-hero">
      <div>
        <p class="eyebrow">帮助</p>
        <h2>把对话变成可交接的本机资料</h2>
        <p>NOOS Hub 负责连接浏览器、Vault、Git 和下游 Agent。你可以先看首页建议操作，确认连接器状态，再到 Vault 打开最近的 Handoff 或 Crystal。</p>
      </div>
      <div class="help-quick-actions">
        <button type="button" data-section="home">回到首页</button>
        <button type="button" data-run="doctor">运行 Doctor</button>
      </div>
    </section>

    <section class="help-layout">
      <article class="help-panel">
        <h3>第一次使用</h3>
        <div class="help-steps">
          ${step("1", "连接浏览器插件", "在 ChatGPT 页面用 Shuttle 捕获对话，Hub 会接收 Handoff、Crystal 或浏览器镜像文件。")}
          ${step("2", "检查首页建议", "首页会把异常、未安装、待导入这类状态收敛成一个下一步动作。优先处理这里的按钮。")}
          ${step("3", "从 Vault 交给 Agent", "Vault 保存本机资料。打开 Handoff 后，可以把任务交给 Codex、Claude Code 或你配置的默认 Agent。")}
        </div>
      </article>

      <article class="help-panel">
        <h3>核心概念</h3>
        <dl class="help-terms">
          ${term("Handoff", "任务交接单。它包含目标、上下文、约束、验收标准和下一位 agent 的建议步骤。")}
          ${term("Crystal", "结论卡片。它保存可复用的判断、原则或决策，适合长期沉淀到 Vault。")}
          ${term("Vault", "本机资料库。Hub 读写的 Handoff、Crystal、结果和投影文件都以普通文件形式保存在这里。")}
          ${term("连接器", "Hub 对浏览器插件、Git、本机工作区和下游 agent 的状态检查与修复入口。")}
          ${term("Browser Mirror", "浏览器先落盘的临时镜像区。看到“待导入”时，说明资料还没进入正式 Vault 流程。")}
          ${term("Projection", "面向 agent 的精简上下文包。它让 agent 只读当前任务需要的资料，而不是扫描整个 Vault。")}
        </dl>
      </article>

      <article class="help-panel help-panel--wide">
        <h3>状态怎么看</h3>
        <div class="help-status-list">
          ${status("就绪", "连接器可用，可以继续当前工作。")}
          ${status("未安装", "Hub 没找到对应工具或插件。运行 Doctor，按提示安装或配置。")}
          ${status("待处理", "工具存在，但还需要登录、配对、授权或选择路径。")}
          ${status("部分可用", "基础能力能工作，但同步、投影或某些扩展能力还没完全配置。")}
          ${status("异常", "当前检查失败。先刷新；如果仍失败，运行 Doctor 并查看底部运行输出。")}
        </div>
      </article>

      <article class="help-panel help-panel--wide">
        <h3>资料流向</h3>
        <div class="help-flow" aria-label="NOOS 资料流向">
          <span>浏览器对话</span>
          <span>Shuttle 捕获</span>
          <span>Hub 接收</span>
          <span>Vault 保存</span>
          <span>Agent 消费</span>
        </div>
        <p>Hub 默认是本机优先：保存到 Vault 不等于上传到远端，Git 同步和软件更新都是单独的明确动作。</p>
      </article>

      <article class="help-panel">
        <h3>常用路径</h3>
        <div class="help-path-list">
          ${pathRow("Vault", vaultPath)}
          ${pathRow("活跃 Handoff", handoffPath)}
          ${pathRow("活跃 Crystal", crystalPath)}
          ${pathRow("浏览器镜像", mirrorPath)}
        </div>
      </article>

      <article class="help-panel">
        <h3>常见恢复动作</h3>
        <ul class="help-checklist">
          <li><strong>看不到最新文件</strong><span>先点刷新；如果来自浏览器镜像，再到 Vault 页面导入或打开对应目录。</span></li>
          <li><strong>连接器异常</strong><span>运行 Doctor，底部运行输出会显示失败的命令和建议动作。</span></li>
          <li><strong>浏览器写入失败</strong><span>在设置里重置浏览器连接，然后重新配对 Shuttle 插件。</span></li>
          <li><strong>担心同步范围</strong><span>检查 Git 连接器状态。Hub 不会因为保存到 Vault 就自动推送远端。</span></li>
        </ul>
      </article>
    </section>
  `;
}

function step(index: string, title: string, body: string): string {
  return `
    <div class="help-step">
      <span>${escapeHtml(index)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </div>
    </div>
  `;
}

function term(label: string, body: string): string {
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(body)}</dd>
    </div>
  `;
}

function status(label: string, body: string): string {
  return `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(body)}</span>
    </div>
  `;
}

function pathRow(label: string, path: string): string {
  return `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <code>${escapeHtml(path)}</code>
    </div>
  `;
}
