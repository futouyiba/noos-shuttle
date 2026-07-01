import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import noosLogoUrl from "./assets/noos-logo.png";
import { mockHealth, mockSleepRecoveryStatus } from "./mock";
import { renderAdapters } from "./pages/adapters";
import { renderConfig } from "./pages/config";
import { renderGuide } from "./pages/guide";
import { renderLogs } from "./pages/logs";
import { renderNoosIntro } from "./pages/noos-intro";
import { renderOverview } from "./pages/overview";
import { renderVault } from "./pages/vault";
import { sleepRecoveryDisplay } from "./status";
import "./styles.css";
import type { HubHealth, SleepRecoveryStatus, UpdateCheckMode, UpdateStatus } from "./types";
import { renderUpdateBannerHtml, renderUpdateDialogHtml } from "./update/render";
import { escapeHtml } from "./ui/html";
import { setVaultFileActionDataRuns } from "./vault-file-actions";

type SectionId = "noos" | "overview" | "guide" | "adapters" | "vault" | "config" | "logs";

const silentUpdateCheckDelayMs = 2500;
const navItems: Array<{
  id: SectionId;
  label: string;
  eyebrow: string;
  title: string;
  summary: string;
}> = [
  {
    id: "noos",
    label: "工作台",
    eyebrow: "NOOS Hub Desktop",
    title: "本机上下文中枢",
    summary: "把浏览器、Vault、Agent 和项目之间的上下文收进来、放稳、交出去。"
  },
  {
    id: "overview",
    label: "状态",
    eyebrow: "System Health",
    title: "当前是否可用",
    summary: "先看阻塞点，再判断捕获、存储、解析和消费链路是否完整。"
  },
  {
    id: "guide",
    label: "修复",
    eyebrow: "Guided Setup",
    title: "下一步怎么处理",
    summary: "把 Doctor 和连接器状态压缩成少量可确认动作。"
  },
  {
    id: "adapters",
    label: "连接器",
    eyebrow: "Adapters",
    title: "连接器安装状态",
    summary: "检查浏览器、Git、工作区和下游 agent 的可用性。"
  },
  {
    id: "vault",
    label: "Vault",
    eyebrow: "NOOS Vault",
    title: "本机产物与交接",
    summary: "管理 Handoff、Crystal、Browser Mirror 和 Agent Projection。"
  },
  {
    id: "config",
    label: "配置",
    eyebrow: "Settings",
    title: "本机配置与更新",
    summary: "查看路径、更新入口和内置 Shuttle 扩展。"
  },
  {
    id: "logs",
    label: "输出",
    eyebrow: "Run Output",
    title: "最近一次动作输出",
    summary: "Doctor、安装和修复动作的 stdout 会保留在这里。"
  }
];

let currentHealth: HubHealth | null = null;
let currentRecoveryStatus: SleepRecoveryStatus | null = null;
let currentLog = "";
let activeHubAction: string | null = null;
let activeSection: SectionId = parseSectionId(window.location.hash.slice(1), "noos");
let healthLoadInFlight = false;
let updateStatus: UpdateStatus = "idle";
let updateDialogVisible = false;
let updateBannerVisible = false;
let updateCheckInFlight = false;
let updateMessage = "";
let updateDownloadedBytes = 0;
let updateTotalBytes: number | undefined;
let availableUpdate: Update | null = null;
let dismissedUpdateVersion: string | null = null;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}
const appElement = app;

renderShell();
window.addEventListener("popstate", restoreSectionFromLocation);
window.addEventListener("hashchange", restoreSectionFromLocation);
void installSleepRecoveryListeners();
void installUpdateMenuListeners();
void loadHealth();
void loadSleepRecoveryStatus();
scheduleSilentUpdateCheck();

function renderShell(): void {
  const shellItem = navItems.find((item) => item.id === activeSection) ?? navItems[0];

  appElement.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <img class="mark" src="${noosLogoUrl}" alt="" aria-hidden="true" />
        <div>
          <strong>NOOS Hub</strong>
          <span>Context Control Plane · FuTou 2026</span>
        </div>
      </div>
      <nav>
        ${navItems.map((item) => navButton(item.id, item.label)).join("")}
      </nav>
      <div class="sidebar-note">
        <span></span>
        本机中枢只写入 NOOS 配置和已确认的连接器文件。FuTou 2026。
      </div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow" id="section-eyebrow">${shellItem.eyebrow}</p>
          <h1 id="section-title">${shellItem.title}</h1>
          <p class="topbar-summary" id="section-summary">${shellItem.summary}</p>
        </div>
        <div class="topbar-actions">
          <span class="recovery-pill" data-recovery-state="running">睡眠恢复：检查中</span>
          <button type="button" data-action="refresh">刷新</button>
          <button type="button" data-action="doctor">运行 Doctor</button>
        </div>
      </header>
      <section class="update-banner" id="update-banner" hidden></section>
      <section id="content" class="content">
        <div class="loading">读取本机 NOOS 状态…</div>
      </section>
      <section id="update-dialog-root"></section>
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
      setActiveSection(parseSectionId(button.dataset.section, activeSection));
    });
  });
  appElement.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
    void loadHealth({ force: true });
  });
  appElement.querySelector('[data-action="doctor"]')?.addEventListener("click", () => {
    void runAction("doctor");
  });
  appElement.querySelector('[data-action="clear-log"]')?.addEventListener("click", () => setLog(""));
}

function navButton(section: SectionId, label: string): string {
  const active = activeSection === section;
  return `<button type="button" data-section="${section}" class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${label}</button>`;
}

function parseSectionId(value: string | undefined, fallback: SectionId = "overview"): SectionId {
  return navItems.some((item) => item.id === value) ? (value as SectionId) : fallback;
}

function setActiveSection(section: SectionId, options: { updateHistory?: boolean } = {}): void {
  if (activeSection === section) {
    return;
  }

  activeSection = section;
  if (options.updateHistory !== false) {
    window.history.pushState(null, "", `#${section}`);
  }
  renderCurrentSection();
}

function restoreSectionFromLocation(): void {
  const nextSection = parseSectionId(window.location.hash.slice(1), "noos");
  if (nextSection !== activeSection) {
    setActiveSection(nextSection, { updateHistory: false });
  }
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
  content.innerHTML = `<div class="loading">读取本机 NOOS 状态…</div>`;

  try {
    currentHealth = await getHubHealth();
    renderCurrentSection();
  } catch (error) {
    content.innerHTML = `<div class="error">读取失败：${escapeHtml(String(error))}</div>`;
  } finally {
    healthLoadInFlight = false;
  }
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

async function installUpdateMenuListeners(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await listen("noos://check-update", () => {
    void checkForHubUpdate({ mode: "manual" });
  });
}

function scheduleSilentUpdateCheck(): void {
  if (!isTauriRuntime()) {
    return;
  }

  window.setTimeout(() => {
    void checkForHubUpdate({ mode: "silent" });
  }, silentUpdateCheckDelayMs);
}

async function recoverFromSleep(reason: string): Promise<void> {
  currentRecoveryStatus = {
    ...(currentRecoveryStatus ?? mockSleepRecoveryStatus()),
    state: "recovering",
    message: "正在从唤醒状态恢复本机写入服务。"
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
      message: "系统已休眠；Hub 会在唤醒后恢复。"
    };
  }
  renderSleepRecoveryStatus();
}

function renderSleepRecoveryStatus(): void {
  const pill = appElement.querySelector<HTMLElement>(".recovery-pill");
  if (!pill || !currentRecoveryStatus) {
    return;
  }

  const display = sleepRecoveryDisplay(currentRecoveryStatus, isTauriRuntime());
  pill.dataset.recoveryState = display.dataState;
  pill.textContent = display.text;
  pill.title = display.title;
}

function renderCurrentSection(): void {
  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content || !currentHealth) return;

  renderShellContext();
  appElement.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === activeSection);
    if (button.dataset.section === activeSection) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  switch (activeSection) {
    case "noos":
      content.innerHTML = renderNoosIntro(currentHealth);
      break;
    case "guide":
      content.innerHTML = renderGuide(currentHealth);
      break;
    case "adapters":
      content.innerHTML = renderAdapters(currentHealth);
      break;
    case "vault":
      content.innerHTML = renderVault(currentHealth);
      break;
    case "config":
      content.innerHTML = renderConfig(currentHealth);
      break;
    case "logs":
      content.innerHTML = renderLogs(currentLog);
      break;
    case "overview":
    default:
      content.innerHTML = renderOverview(currentHealth);
      break;
  }

  setVaultFileActionDataRuns(content, [
    { id: "handoffs", files: currentHealth.recent_files.handoffs },
    { id: "crystals", files: currentHealth.recent_files.crystals }
  ]);

  content.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", () => {
      void runAction(button.dataset.run ?? "");
    });
  });
  syncRunActionButtons();
  content.querySelector('[data-action="check-update"]')?.addEventListener("click", () => {
    void checkForHubUpdate({ mode: "manual" });
  });
}

function renderShellContext(): void {
  const item = navItems.find((entry) => entry.id === activeSection) ?? navItems[0];
  const eyebrow = appElement.querySelector<HTMLElement>("#section-eyebrow");
  const title = appElement.querySelector<HTMLElement>("#section-title");
  const summary = appElement.querySelector<HTMLElement>("#section-summary");

  if (eyebrow) {
    eyebrow.textContent = item.eyebrow;
  }
  if (title) {
    title.textContent = item.title;
  }
  if (summary) {
    summary.textContent = item.summary;
  }
}

async function runAction(action: string): Promise<void> {
  if (!action) return;
  if (activeHubAction) return;

  activeHubAction = action;
  syncRunActionButtons();
  setLog(actionStartMessage(action));
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
  } finally {
    activeHubAction = null;
    syncRunActionButtons();
  }
}

function actionStartMessage(action: string): string {
  if (action === "browser-manual-unpacked") {
    return "正在打开日常 Chrome 安装向导…\n如果 Chrome 要求确认，请按向导加载 dist 目录。";
  }
  if (action === "browser-dev-profile") {
    return "正在启动带 NOOS Shuttle 的专用 Chrome profile…";
  }
  return `运行：${action}\n`;
}

function syncRunActionButtons(): void {
  const running = activeHubAction !== null;
  appElement.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    const isCurrentAction = button.dataset.run === activeHubAction;
    button.disabled = running;
    button.toggleAttribute("aria-busy", running && isCurrentAction);
    if (running && isCurrentAction) {
      if (!button.dataset.idleLabel) {
        button.dataset.idleLabel = button.textContent ?? "";
      }
      button.textContent = "正在运行…";
    } else if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  });
}

async function checkForHubUpdate({ mode }: { mode: UpdateCheckMode }): Promise<void> {
  if (!isTauriRuntime()) {
    setLog("浏览器预览模式不会检查 GitHub Release 更新。");
    return;
  }
  if (updateCheckInFlight) {
    if (mode === "manual") {
      updateDialogVisible = true;
      renderUpdateSurfaces();
    }
    return;
  }

  updateCheckInFlight = true;
  updateStatus = "checking";
  updateMessage = "正在检查 GitHub Releases 上的签名更新。";
  updateDownloadedBytes = 0;
  updateTotalBytes = undefined;
  if (mode === "manual") {
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  }

  try {
    const update = await check();
    if (!update) {
      availableUpdate = null;
      updateStatus = "up-to-date";
      updateMessage = "NOOS Hub 已是最新。";
      updateBannerVisible = false;
      if (mode === "manual") {
        renderUpdateSurfaces();
      }
      return;
    }
    availableUpdate = update;
    updateStatus = "available";
    updateMessage = `发现版本 ${update.version}。`;
    if (mode === "silent") {
      updateBannerVisible = dismissedUpdateVersion !== update.version;
      updateDialogVisible = false;
    } else {
      updateBannerVisible = false;
      updateDialogVisible = true;
    }
    renderUpdateSurfaces();
  } catch (error) {
    updateStatus = "error";
    updateMessage = `无法检查更新：${String(error)}`;
    updateBannerVisible = false;
    if (mode === "manual") {
      updateDialogVisible = true;
      renderUpdateSurfaces();
    }
  } finally {
    updateCheckInFlight = false;
  }
}

async function installHubUpdate(): Promise<void> {
  if (!isTauriRuntime()) {
    setLog("浏览器预览模式不会安装更新。");
    return;
  }

  try {
    const update = availableUpdate ?? (await check());
    if (!update) {
      availableUpdate = null;
      updateStatus = "up-to-date";
      updateMessage = "NOOS Hub 已是最新。";
      updateDialogVisible = true;
      updateBannerVisible = false;
      renderUpdateSurfaces();
      return;
    }

    let downloaded = 0;
    availableUpdate = update;
    updateStatus = "downloading";
    updateMessage = `正在下载 NOOS Hub ${update.version}。`;
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();

    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        downloaded = 0;
        updateDownloadedBytes = 0;
        updateTotalBytes = event.data.contentLength;
        updateMessage = `正在下载 NOOS Hub ${update.version}。`;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        updateDownloadedBytes = downloaded;
      } else if (event.event === "Finished") {
        updateStatus = "restarting";
        updateMessage = `NOOS Hub ${update.version} 已安装，正在重启。`;
      }
      renderUpdateSurfaces();
    });
    await relaunch();
  } catch (error) {
    updateStatus = "error";
    updateMessage = `无法安装更新：${String(error)}`;
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  }
}

function renderUpdateSurfaces(): void {
  renderUpdateBanner();
  renderUpdateDialog();
}

function renderUpdateBanner(): void {
  const banner = appElement.querySelector<HTMLElement>("#update-banner");
  if (!banner) return;

  const visible = updateBannerVisible && !!availableUpdate && updateStatus === "available";
  banner.hidden = !visible;
  if (!visible || !availableUpdate) {
    banner.innerHTML = "";
    return;
  }

  banner.innerHTML = renderUpdateBannerHtml(availableUpdate);
  banner.querySelector('[data-update-action="show"]')?.addEventListener("click", () => {
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  });
  banner.querySelector('[data-update-action="dismiss"]')?.addEventListener("click", () => {
    dismissedUpdateVersion = availableUpdate?.version ?? null;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  });
}

function renderUpdateDialog(): void {
  const root = appElement.querySelector<HTMLElement>("#update-dialog-root");
  if (!root) return;

  if (!updateDialogVisible) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = renderUpdateDialogHtml({
    status: updateStatus,
    message: updateMessage,
    availableUpdate,
    downloadedBytes: updateDownloadedBytes,
    totalBytes: updateTotalBytes
  });

  root.querySelector('[data-update-action="close"]')?.addEventListener("click", closeUpdateDialog);
  root.querySelector('[data-update-action="later"]')?.addEventListener("click", closeUpdateDialog);
  root.querySelector('[data-update-action="retry"]')?.addEventListener("click", () => {
    void checkForHubUpdate({ mode: "manual" });
  });
  root.querySelector('[data-update-action="install"]')?.addEventListener("click", () => {
    void installHubUpdate();
  });
}

function closeUpdateDialog(): void {
  updateDialogVisible = false;
  renderUpdateSurfaces();
}

function setLog(value: string): void {
  currentLog = value;
  const panel = appElement.querySelector<HTMLElement>("#log");
  const pre = panel?.querySelector("pre");
  if (!panel || !pre) return;
  pre.textContent = value;
  panel.hidden = value.length === 0;
  syncLogPage();
}

function syncLogPage(): void {
  const output = appElement.querySelector<HTMLElement>(".log-page-output");
  if (!output) return;

  const hasOutput = currentLog.trim().length > 0;
  const title = appElement.querySelector<HTMLElement>("[data-log-title]");
  output.textContent = hasOutput ? currentLog : "运行 Doctor 或其他动作后，这里会显示输出。";
  if (title) {
    title.textContent = hasOutput ? "最近输出" : "还没有输出";
  }
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
