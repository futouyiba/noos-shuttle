import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import noosLogoUrl from "./assets/noos-logo.png";
import "./styles.css";

type AdapterStatus = "ready" | "partial" | "missing" | "needs_action" | "error";
type AdapterKind = "capture" | "transport" | "consumer" | "workspace";
type ModelModeId = "local" | "user-key" | "noos-cloud";

interface AdapterCheck {
  label: string;
  status: AdapterStatus;
  detail?: string;
}

interface AdapterAction {
  id: string;
  label: string;
  requires_user_action?: boolean;
}

interface AdapterHealth {
  id: string;
  name: string;
  kind: AdapterKind;
  status: AdapterStatus;
  summary: string;
  checks: AdapterCheck[];
  actions: AdapterAction[];
}

interface HubHealth {
  repo_root: string;
  noos_home: string;
  local_write: LocalWriteSummary;
  vault_stats: VaultStats;
  recent_files: RecentVaultFiles;
  adapters: AdapterHealth[];
}

type SleepRecoveryState =
  | "running"
  | "suspended"
  | "resumed"
  | "recovering"
  | "healthy"
  | "degraded"
  | "relaunching";

interface SleepRecoveryStatus {
  state: SleepRecoveryState;
  last_reason: string;
  last_resume_epoch?: number;
  last_gap_secs?: number;
  attempts: number;
  local_write_healthy: boolean;
  relaunch_recommended: boolean;
  message: string;
}

interface LocalWriteSummary {
  endpoint: string;
  paired: boolean;
}

interface VaultStats {
  handoffs_active: number;
  crystals_active: number;
  browser_handoffs: number;
  browser_crystals: number;
}

interface RecentVaultFiles {
  handoffs: VaultFileSummary[];
  crystals: VaultFileSummary[];
}

interface VaultFileSummary {
  name: string;
  path: string;
  modified_epoch: number;
  title?: string;
  key?: string;
  source_url?: string;
}

const statusLabels: Record<AdapterStatus, string> = {
  ready: "就绪",
  partial: "部分完成",
  missing: "未安装",
  needs_action: "需要操作",
  error: "错误"
};

const kindLabels: Record<AdapterKind, string> = {
  capture: "捕获",
  transport: "传输",
  consumer: "消费",
  workspace: "工作区"
};

const kindOrder: AdapterKind[] = ["capture", "transport", "workspace", "consumer"];
const githubUrl = "https://github.com/futouyiba/noos-shuttle";
const docsUrl = "https://futouyiba.github.io/noos-shuttle/";

const modelModes: Array<{
  id: ModelModeId;
  name: string;
  status: AdapterStatus;
  detail: string;
}> = [
  {
    id: "local",
    name: "Local Guide",
    status: "ready",
    detail: "默认启用：基于 doctor、adapter 状态和本机配置生成下一步建议。"
  },
  {
    id: "user-key",
    name: "User Provider Key",
    status: "needs_action",
    detail: "支持 OpenAI-compatible、Anthropic、Gemini 等供应商配置。"
  },
  {
    id: "noos-cloud",
    name: "NOOS Cloud Relay",
    status: "missing",
    detail: "预留产品化入口：由 NOOS 分发额度 token，Hub 不保存供应商主 key。"
  }
];

let currentHealth: HubHealth | null = null;
let currentRecoveryStatus: SleepRecoveryStatus | null = null;
let activeSection = "noos";
let healthLoadInFlight = false;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}
const appElement = app;

renderShell();
void installSleepRecoveryListeners();
void loadHealth();
void loadSleepRecoveryStatus();

function renderShell(): void {
  appElement.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <img class="mark" src="${noosLogoUrl}" alt="" aria-hidden="true" />
        <div>
          <strong>NOOS Hub</strong>
          <span>Context Control Plane</span>
        </div>
      </div>
      <nav>
        ${navButton("noos", "NOOS")}
        ${navButton("overview", "总览")}
        ${navButton("guide", "Guide")}
        ${navButton("adapters", "Adapters")}
        ${navButton("vault", "Vault")}
        ${navButton("config", "配置")}
        ${navButton("logs", "输出")}
      </nav>
      <div class="sidebar-note">
        <span></span>
        本机中枢只写入 NOOS 配置和已确认的 adapter 文件。
      </div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">NOOS Hub Desktop</p>
          <h1>NOOS Operating System</h1>
        </div>
        <div class="topbar-actions">
          <span class="recovery-pill" data-recovery-state="running">Sleep recovery: ready</span>
          <button type="button" data-action="refresh">刷新</button>
          <button type="button" data-action="doctor">运行 Doctor</button>
        </div>
      </header>
      <section id="content" class="content">
        <div class="loading">读取本机 NOOS 状态...</div>
      </section>
      <section class="log" id="log" hidden>
        <header>
          <strong>运行输出</strong>
          <button type="button" data-action="clear-log">清空</button>
        </header>
        <pre></pre>
      </section>
    </main>
  `;

  appElement.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSection = button.dataset.section ?? "overview";
      renderCurrentSection();
    });
  });
  appElement.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
    void loadHealth({ force: true });
  });
  appElement.querySelector('[data-action="doctor"]')?.addEventListener("click", () => runAction("doctor"));
  appElement.querySelector('[data-action="clear-log"]')?.addEventListener("click", () => setLog(""));
}

function navButton(section: string, label: string): string {
  return `<button type="button" data-section="${section}" class="${activeSection === section ? "active" : ""}">${label}</button>`;
}

async function loadHealth(options: { force?: boolean } = {}): Promise<void> {
  void options;
  if (healthLoadInFlight) {
    return;
  }
  healthLoadInFlight = true;
  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content) {
    healthLoadInFlight = false;
    return;
  }
  content.innerHTML = `<div class="loading">读取本机 NOOS 状态...</div>`;

  try {
    currentHealth = await getHubHealth();
    renderCurrentSection();
  } catch (error) {
    content.innerHTML = `<div class="error">读取失败：${escapeHtml(String(error))}</div>`;
  } finally {
    healthLoadInFlight = false;
  }
}

async function loadSleepRecoveryStatus(): Promise<void> {
  try {
    currentRecoveryStatus = await invoke<SleepRecoveryStatus>("get_sleep_recovery_status");
  } catch {
    currentRecoveryStatus = mockSleepRecoveryStatus();
  }
  renderSleepRecoveryStatus();
}

async function installSleepRecoveryListeners(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await listen("tauri://suspended", () => {
    void markSleepSuspended();
  });

  await listen("tauri://resumed", () => {
    void recoverFromSleep("frontend tauri resumed event");
  });
}

async function recoverFromSleep(reason: string): Promise<void> {
  currentRecoveryStatus = {
    ...(currentRecoveryStatus ?? mockSleepRecoveryStatus()),
    state: "recovering",
    message: "Recovering local write service after wake."
  };
  renderSleepRecoveryStatus();

  try {
    currentRecoveryStatus = await invoke<SleepRecoveryStatus>("recover_from_sleep", {
      reason,
      gapSecs: null
    });
    renderSleepRecoveryStatus();
    await loadHealth({ force: true });
  } catch (error) {
    currentRecoveryStatus = {
      state: "degraded",
      last_reason: reason,
      attempts: 0,
      local_write_healthy: false,
      relaunch_recommended: true,
      message: String(error)
    };
    renderSleepRecoveryStatus();
  }
}

async function markSleepSuspended(): Promise<void> {
  try {
    currentRecoveryStatus = await invoke<SleepRecoveryStatus>("mark_sleep_suspended");
  } catch {
    currentRecoveryStatus = {
      ...(currentRecoveryStatus ?? mockSleepRecoveryStatus()),
      state: "suspended",
      message: "System suspended; Hub will recover after resume."
    };
  }
  renderSleepRecoveryStatus();
}

function renderSleepRecoveryStatus(): void {
  const pill = appElement.querySelector<HTMLElement>(".recovery-pill");
  if (!pill || !currentRecoveryStatus) {
    return;
  }

  const state = currentRecoveryStatus.state;
  pill.dataset.recoveryState = state;
  pill.textContent =
    state === "healthy" || state === "running"
      ? "Sleep recovery: ready"
      : state === "recovering" || state === "resumed"
        ? "Sleep recovery: recovering"
        : state === "relaunching"
          ? "Sleep recovery: relaunch recommended"
          : `Sleep recovery: ${state}`;
  pill.title = currentRecoveryStatus.message;
}

async function getHubHealth(): Promise<HubHealth> {
  try {
    return await invoke<HubHealth>("get_hub_health");
  } catch (error) {
    if (isTauriRuntime()) {
      throw error;
    }
    return mockHealth();
  }
}

function renderCurrentSection(): void {
  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content || !currentHealth) return;
  appElement.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === activeSection);
  });

  if (activeSection === "noos") {
    content.innerHTML = renderNoosIntro(currentHealth);
  } else if (activeSection === "guide") {
    content.innerHTML = renderGuide(currentHealth);
  } else if (activeSection === "adapters") {
    content.innerHTML = renderAdapters(currentHealth);
  } else if (activeSection === "vault") {
    content.innerHTML = renderVault(currentHealth);
  } else if (activeSection === "config") {
    content.innerHTML = renderConfig(currentHealth);
  } else if (activeSection === "logs") {
    content.innerHTML = renderLogsIntro();
  } else {
    content.innerHTML = renderOverview(currentHealth);
  }

  content.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.run ?? ""));
  });
}

function renderNoosIntro(health: HubHealth): string {
  return `
    <section class="intro-hero">
      <div class="intro-copy">
        <p class="eyebrow">NOOS Shuttle + NOOS OS</p>
        <h2>让不同 AI 工具共享上下文、状态和下一步。</h2>
        <p>NOOS Shuttle 负责把 chatbox 里的讨论变成 handoff 和 crystal；NOOS Operating System 负责把 artifact、agent、repo、浏览器和本机能力组织成可检查、可安装、可消费的系统。</p>
        <div class="intro-actions">
          <a href="${githubUrl}" target="_blank" rel="noreferrer">GitHub</a>
          <a href="${docsUrl}" target="_blank" rel="noreferrer">GitHub Pages</a>
        </div>
      </div>
      <div class="system-visual" aria-label="NOOS system flow">
        <div class="orbit orbit--chat">Chatbox</div>
        <div class="orbit orbit--handoff">Handoff</div>
        <div class="orbit orbit--agent">Agent</div>
        <div class="core-node">NOOS</div>
      </div>
    </section>
    <section class="story-grid">
      ${storyPanel("01", "Capture", "ChatGPT、Claude、Gemini 等上游讨论被整理成结构化 handoff 或 crystal。", "capture")}
      ${storyPanel("02", "Vault", "Hub 管理本机 NOOS Vault，并从 Browser Mirror 导入回退保存的文件。", "transport")}
      ${storyPanel("03", "Consume", "Codex、Claude Code 和其他 coding agent 按 key 或路径读取并继续执行。", "consume")}
    </section>
    <section class="section-head">
      <div>
        <p class="eyebrow">This Machine</p>
        <h2>当前 NOOS 实体状态</h2>
      </div>
      <button type="button" data-run="doctor">运行 Doctor</button>
    </section>
    ${renderGuideSnapshot(health)}
  `;
}

function renderGuide(health: HubHealth): string {
  const items = guideItems(health);
  return `
    <section class="guide-layout">
      <article class="guide-main">
        <p class="eyebrow">Guide Agent</p>
        <h2>本机安装引导</h2>
        <p>当前版本先用本地规则读取 adapter 状态。模型接入后，它会解释错误、总结 doctor 输出，并把下一步动作压缩成可确认的按钮。</p>
        <div class="guide-steps">
          ${items
            .map(
              (item, index) => `
                <article class="guide-step guide-step--${item.status}">
                  <span>${String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                  </div>
                  ${item.action ? `<button type="button" data-run="${escapeHtml(item.action.id)}">${escapeHtml(item.action.label)}</button>` : ""}
                </article>
              `
            )
            .join("")}
        </div>
      </article>
      <aside class="model-panel">
        <p class="eyebrow">Model Layer</p>
        <h2>模型接入策略</h2>
        <div class="model-modes">
          ${modelModes
            .map(
              (mode) => `
                <article class="model-mode model-mode--${mode.status}">
                  <span class="dot dot--${mode.status}"></span>
                  <div>
                    <strong>${escapeHtml(mode.name)}</strong>
                    <small>${escapeHtml(mode.detail)}</small>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </aside>
    </section>
    <section class="model-roadmap">
      ${modelRoadmap("v0", "Rule-based", "不需要 token；只解释本机状态和安装脚本结果。")}
      ${modelRoadmap("v1", "Provider Adapter", "用户配置 base URL、model 和 API key；Hub 只调用抽象 provider。")}
      ${modelRoadmap("v2", "NOOS Relay", "NOOS Cloud 分发短期额度 token；客户端不接触供应商主 key。")}
    </section>
  `;
}

function renderOverview(health: HubHealth): string {
  const ready = health.adapters.filter((adapter) => adapter.status === "ready").length;
  const needsAction = health.adapters.length - ready;
  const nextAction = chooseNextAction(health.adapters);

  return `
    <section class="summary-grid">
      ${metric("就绪", String(ready), "Ready adapters")}
      ${metric("待处理", String(needsAction), "Needs attention")}
      ${metric("NOOS Home", health.noos_home, "User hub")}
    </section>
    <section class="next-action ${nextAction ? "" : "next-action--ready"}">
      <div>
        <p>${nextAction ? "建议下一步" : "系统状态"}</p>
        <h2>${nextAction ? escapeHtml(nextAction.name) : "核心 adapter 已就绪"}</h2>
        <span>${nextAction ? escapeHtml(nextAction.summary) : "可以开始捕获和消费 NOOS handoff。"}</span>
      </div>
      ${
        nextAction?.actions[0]
          ? `<button type="button" data-run="${escapeHtml(nextAction.actions[0].id)}">${escapeHtml(
              nextAction.actions[0].label
            )}</button>`
          : `<button type="button" data-run="doctor">再次检查</button>`
      }
    </section>
    <section class="pipeline">
      ${pipelineStep("Capture", "ChatGPT / Claude / Gemini", adapterStatus(health, "capture"))}
      ${pipelineStep("Vault", "Handoffs / Crystals / Browser Mirror", adapterStatus(health, "transport"))}
      ${pipelineStep("Resolve", "NOOS Resolver", "ready")}
      ${pipelineStep("Consume", "Codex / Claude Code", adapterStatus(health, "consumer"))}
    </section>
    ${renderAdapters(health)}
  `;
}

function renderGuideSnapshot(health: HubHealth): string {
  const nextAction = chooseNextAction(health.adapters);
  const ready = health.adapters.filter((adapter) => adapter.status === "ready").length;
  return `
    <section class="snapshot-grid">
      ${metric("Ready", String(ready), "可用 adapter")}
      ${metric("Next", nextAction?.name ?? "Doctor", "建议动作")}
      <article class="snapshot-note">
        <strong>${nextAction ? escapeHtml(nextAction.summary) : "核心链路已具备基础可用性。"}</strong>
        <span>${escapeHtml(health.repo_root)}</span>
      </article>
    </section>
  `;
}

function renderAdapters(health: HubHealth): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">Adapters</p>
        <h2>安装状态</h2>
      </div>
      <span>${escapeHtml(health.repo_root)}</span>
    </section>
    ${kindOrder
      .map((kind) => {
        const adapters = health.adapters.filter((adapter) => adapter.kind === kind);
        if (!adapters.length) return "";
        return `
          <section class="adapter-group">
            <h3>${kindLabels[kind]}</h3>
            <div class="card-grid">${adapters.map(renderAdapter).join("")}</div>
          </section>
        `;
      })
      .join("")}
  `;
}

function renderAdapter(adapter: AdapterHealth): string {
  return `
    <article class="card card--${adapter.status}">
      <header>
        <div>
          <p>${kindLabels[adapter.kind]}</p>
          <h2>${escapeHtml(adapter.name)}</h2>
        </div>
        <span class="pill pill--${adapter.status}">${statusLabels[adapter.status]}</span>
      </header>
      <p class="summary">${escapeHtml(adapter.summary)}</p>
      <ul>
        ${adapter.checks.map(renderCheck).join("")}
      </ul>
      <div class="card-actions">
        ${adapter.actions
          .map((action) => {
            const label = action.requires_user_action ? `${action.label} · 需确认` : action.label;
            return `<button type="button" data-run="${escapeHtml(action.id)}">${escapeHtml(label)}</button>`;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderCheck(check: AdapterCheck): string {
  return `
    <li>
      <span class="dot dot--${check.status}"></span>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        ${check.detail ? `<small>${escapeHtml(check.detail)}</small>` : ""}
      </div>
    </li>
  `;
}

function renderVault(health: HubHealth): string {
  const mirrorCount = health.vault_stats.browser_handoffs + health.vault_stats.browser_crystals;
  const connectionState = health.local_write.paired ? "已连接" : "等待首次自动连接";
  const recommendedAction = mirrorCount > 0 ? "导入 Browser Mirror" : health.local_write.paired ? "打开 Vault" : "保存时自动连接";
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">NOOS Vault</p>
        <h2>本机产物存储中心</h2>
      </div>
      <div class="section-actions">
        <button type="button" data-run="open-vault">打开 Vault</button>
        <button type="button" data-run="import-browser-vault">导入 Browser Mirror</button>
        <button type="button" data-run="sync-handoffs-git">同步 Handoff 到 Git</button>
        <button type="button" data-run="open-runtime-current">打开当前 Projection</button>
      </div>
    </section>
    <section class="vault-command">
      <div>
        <p class="eyebrow">Recommended</p>
        <h3>${escapeHtml(recommendedAction)}</h3>
        <p>${escapeHtml(
          mirrorCount > 0
            ? "Browser Mirror 里还有待导入文件。先导入本机 Vault，再决定是否同步到 Git。"
            : health.local_write.paired
              ? "Browser Shuttle 已可直接写入本机 NOOS Vault。"
              : "Browser Shuttle 会在首次保存时自动连接 Hub；Hub 未运行时才回退到 Browser Mirror。"
        )}</p>
      </div>
      <span class="connection-pill">${escapeHtml(connectionState)}</span>
    </section>
    <div class="vault-layout">
      <article class="panel panel--primary">
        <h3>NOOS Vault</h3>
        <p>本机存储中心：<code>${escapeHtml(health.noos_home)}/vault</code></p>
        <p>Wiki、Handoff 和 Crystal 都先落到本机 NOOS 文件系统。Git 同步是单独动作，避免把临时文件无意推到远端。</p>
        <button type="button" data-run="open-vault">打开 Vault</button>
      </article>
      <article class="panel">
        <h3>Runtime Projection</h3>
        <p>把选中的 Handoff / Crystal 复制成 Codex、Claude Code、OpenCode 能自然读取的任务文件夹。</p>
        <p>Agent 进入任务后先读 <code>.noos/runtime/current/READ_ME_FIRST.md</code>。</p>
        <button type="button" data-run="open-runtime-current">打开当前 Projection</button>
      </article>
      <article class="panel">
        <h3>Browser Mirror</h3>
        <p>待导入文件：<strong>${mirrorCount}</strong></p>
        <p>Hub 未运行时，插件会先把 Handoff / Crystal 保存到 Browser Mirror。</p>
        <button type="button" data-run="import-browser-vault">导入 Mirror</button>
        <button type="button" data-run="open-browser-mirror">打开 Mirror</button>
      </article>
      <article class="panel">
        <h3>Git Sync</h3>
        <p>Handoff 需要跨机器或给远端 agent 消费时，再同步到 Git。</p>
        <p>Crystal 默认保留在本机 Vault，可按 key 检索。</p>
        <button type="button" data-run="sync-handoffs-git">同步 Handoff 到 Git</button>
      </article>
    </div>
    <section class="vault-inline-stats" aria-label="Vault counts">
      <span>Handoffs: <strong>${health.vault_stats.handoffs_active}</strong></span>
      <span>Crystals: <strong>${health.vault_stats.crystals_active}</strong></span>
      <span>Mirror: <strong>${mirrorCount}</strong></span>
    </section>
    <section class="vault-recent">
      ${recentVaultPanel("最近 Handoff", "交给下游 Agent 继续执行", health.recent_files.handoffs)}
      ${recentVaultPanel("最近 Crystal", "长期复用的讨论结晶", health.recent_files.crystals)}
    </section>
    <details class="diagnostics">
      <summary>高级 / 诊断</summary>
      <div class="diagnostics-grid">
        ${configRow("Browser Connection", health.local_write.paired ? "已连接" : "首次保存时自动连接", "本机 token 只用于授权 Browser Shuttle 写入 Hub。")}
        ${configRow("Local Endpoint", health.local_write.endpoint, "只监听本机 127.0.0.1。")}
        ${configRow("Handoff Vault", `${health.noos_home}/vault/handoffs/active`, "面向下游 coding agent 的任务交接稿。")}
        ${configRow("Crystal Vault", `${health.noos_home}/vault/crystals/active`, "面向长期复用的讨论结晶。")}
        ${configRow("Browser Mirror", "~/Downloads/NOOS/vault", "Hub 未运行时的浏览器可写回退目录。")}
      </div>
      <button type="button" data-run="reset-browser-connection">重置浏览器连接</button>
    </details>
  `;
}

function recentVaultPanel(title: string, subtitle: string, files: VaultFileSummary[]): string {
  return `
    <article class="recent-panel">
      <header>
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </header>
      ${
        files.length
          ? `<div class="recent-list">${files.map(renderRecentFile).join("")}</div>`
          : `<div class="recent-empty">还没有本机文件。</div>`
      }
    </article>
  `;
}

function renderRecentFile(file: VaultFileSummary): string {
  const title = file.title || file.name;
  const key = file.key || file.name.replace(/\.md$/i, "");
  const encodedPath = escapeAttribute(file.path);
  return `
    <article class="recent-file">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(key)}</span>
      <code>${escapeHtml(file.path)}</code>
      ${file.source_url ? `<small>${escapeHtml(file.source_url)}</small>` : ""}
      <div class="recent-actions">
        <button type="button" data-run="open-vault-file:${encodedPath}">打开文件</button>
        <button type="button" data-run="project-runtime:${encodedPath}">生成 Agent Projection</button>
      </div>
    </article>
  `;
}

function renderConfig(health: HubHealth): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">Config</p>
        <h2>配置层</h2>
      </div>
    </section>
    <div class="config-list">
      ${configRow("User Hub", `${health.noos_home}/config.json`, "用户级 inbox、默认 agent、GitHub auth provider。")}
      ${configRow("Vault", `${health.noos_home}/vault`, "本机 Wiki、Handoff、Crystal 的 local-first 存储中心。")}
      ${configRow("Project", `${health.repo_root}/.noos/project.json`, "项目 handoff / crystal 路径和 GitHub repo handle。")}
      ${configRow("Local", `${health.repo_root}/.noos/local.json`, "本机私有配置，已被 git ignore。")}
    </div>
  `;
}

function renderLogsIntro(): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">Logs</p>
        <h2>运行输出</h2>
      </div>
      <button type="button" data-run="doctor">运行 Doctor</button>
    </section>
    <article class="panel">
      <p>点击安装或检查动作后，输出会出现在底部抽屉。高风险写入会在动作按钮上标记为需确认。</p>
    </article>
  `;
}

function metric(label: string, value: string, caption: string): string {
  return `
    <article class="metric">
      <span>${escapeHtml(value)}</span>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(caption)}</small>
    </article>
  `;
}

function storyPanel(index: string, title: string, detail: string, variant: string): string {
  return `
    <article class="story-panel story-panel--${variant}">
      <span>${index}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

function modelRoadmap(stage: string, title: string, detail: string): string {
  return `
    <article class="roadmap-item">
      <span>${escapeHtml(stage)}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

function pipelineStep(title: string, detail: string, status: AdapterStatus): string {
  return `
    <article class="pipe pipe--${status}">
      <span></span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function configRow(name: string, path: string, detail: string): string {
  return `
    <article class="config-row">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <code>${escapeHtml(path)}</code>
    </article>
  `;
}

function adapterStatus(health: HubHealth, kind: AdapterKind): AdapterStatus {
  const adapters = health.adapters.filter((adapter) => adapter.kind === kind);
  if (!adapters.length) return "missing";
  if (adapters.every((adapter) => adapter.status === "ready")) return "ready";
  if (adapters.some((adapter) => adapter.status === "error")) return "error";
  if (adapters.some((adapter) => adapter.status === "needs_action")) return "needs_action";
  return "partial";
}

function chooseNextAction(adapters: AdapterHealth[]): AdapterHealth | undefined {
  return adapters.find((adapter) => adapter.status === "missing" || adapter.status === "needs_action") ??
    adapters.find((adapter) => adapter.status === "partial");
}

function guideItems(health: HubHealth): Array<{
  title: string;
  detail: string;
  status: AdapterStatus;
  action?: AdapterAction;
}> {
  const nextAction = chooseNextAction(health.adapters);
  const inbox = health.adapters.find((adapter) => adapter.id === "local-inbox");
  const codex = health.adapters.find((adapter) => adapter.id === "codex");

  return [
    {
      title: "确认 NOOS Hub 状态",
      detail: `本机 Hub 位于 ${health.noos_home}，Doctor 会刷新 workspace、consumer skill、browser extension 和 GitHub auth。`,
      status: "ready",
      action: { id: "doctor", label: "运行 Doctor" }
    },
    {
      title: nextAction ? `处理 ${nextAction.name}` : "核心链路已就绪",
      detail: nextAction ? nextAction.summary : "可以开始从浏览器捕获 handoff，并交给 coding agent 消费。",
      status: nextAction?.status ?? "ready",
      action: nextAction?.actions[0]
    },
    {
      title: "补齐本地上下文收件箱",
      detail: inbox?.status === "ready" ? "Local Inbox 已可用于 download 和跨工具交换。" : "Local Inbox 可以作为 Chatbox 到本机 agent 的最低摩擦传输层。",
      status: inbox?.status ?? "missing",
      action: { id: "create-inbox", label: "创建 Inbox" }
    },
    {
      title: "准备模型引导层",
      detail: codex?.status === "ready" ? "Codex consumer 已就绪，后续可加入模型解释层。" : "先使用 Local Guide；配置 provider key 或 NOOS Cloud Relay 后再启用模型解释。",
      status: "partial"
    }
  ];
}

async function runAction(action: string): Promise<void> {
  if (!action) return;
  setLog(`运行：${action}\n`);
  try {
    const output = await invoke<string>("run_hub_action", { action });
    setLog(output || "完成。");
    await loadHealth({ force: true });
  } catch (error) {
    if (!isTauriRuntime()) {
      setLog(`浏览器预览模式不会执行本机动作：${action}`);
      return;
    }
    setLog(`失败：${String(error)}`);
  }
}

function setLog(value: string): void {
  const panel = appElement.querySelector<HTMLElement>("#log");
  const pre = panel?.querySelector("pre");
  if (!panel || !pre) return;
  pre.textContent = value;
  panel.hidden = value.length === 0;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function mockHealth(): HubHealth {
  return {
    repo_root: "/Users/you/Projects/noos-shuttle",
    noos_home: "/Users/you/.noos",
    local_write: {
      endpoint: "http://127.0.0.1:17642",
      paired: true
    },
    vault_stats: {
      handoffs_active: 3,
      crystals_active: 2,
      browser_handoffs: 1,
      browser_crystals: 1
    },
    recent_files: {
      handoffs: [
        {
          name: "2026-05-20-noos-hub-vault.md",
          path: "/Users/you/.noos/vault/handoffs/active/2026-05-20-noos-hub-vault.md",
          modified_epoch: 1779290000,
          title: "NOOS Hub Vault 改版",
          key: "noos-hub-vault"
        }
      ],
      crystals: [
        {
          name: "2026-05-20-handoff-vs-crystal.md",
          path: "/Users/you/.noos/vault/crystals/active/2026-05-20-handoff-vs-crystal.md",
          modified_epoch: 1779290000,
          title: "Handoff 与 Crystal 分工",
          key: "handoff-vs-crystal"
        }
      ]
    },
    adapters: [
      mockAdapter("browser-extension", "Browser Shuttle", "capture", "needs_action", "ChatGPT 网页端生成、捕获和交付 handoff 的扩展。"),
      mockAdapter("local-inbox", "Local Inbox", "transport", "missing", "本地 handoff 收件箱，用于 download 和跨工具交换。"),
      mockAdapter("noos-vault", "NOOS Vault", "transport", "ready", "NOOS 本机存储中心，包含 Wiki、Handoff 和 Crystal。"),
      mockAdapter("github", "Git Sync", "transport", "ready", "把本机 NOOS Handoff Vault 同步到项目 Git 仓库。"),
      mockAdapter("workspace", "Workspace Kit", "workspace", "ready", "项目级 .noos 工作区和 agent 入口文件。"),
      mockAdapter("codex", "Codex", "consumer", "partial", "Codex 消费 NOOS handoff 的用户级 skill。"),
      mockAdapter("claude-code", "Claude Code", "consumer", "missing", "Claude Code 消费 NOOS handoff 的用户级和项目级 skill。")
    ]
  };
}

function mockSleepRecoveryStatus(): SleepRecoveryStatus {
  return {
    state: "running",
    last_reason: "browser preview",
    attempts: 0,
    local_write_healthy: true,
    relaunch_recommended: false,
    message: "NOOS Hub sleep recovery is ready."
  };
}

function mockAdapter(
  id: string,
  name: string,
  kind: AdapterKind,
  status: AdapterStatus,
  summary: string
): AdapterHealth {
  return {
    id,
    name,
    kind,
    status,
    summary,
    checks: [
      { label: "主要文件", status, detail: status === "ready" ? "detected" : "needs setup" },
      { label: "配置", status: status === "missing" ? "missing" : "ready", detail: "NOOS config" }
    ],
    actions: [{ id: id === "browser-extension" ? "browser-dev-profile" : "doctor", label: "处理", requires_user_action: status === "needs_action" }]
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
