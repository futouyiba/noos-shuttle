import type { Update } from "@tauri-apps/plugin-updater";
import type { UpdateStatus } from "../types";
import { escapeHtml } from "../ui/html";

export interface UpdateViewState {
  status: UpdateStatus;
  message: string;
  availableUpdate: Update | null;
  downloadedBytes: number;
  totalBytes?: number;
}

export function renderUpdateBannerHtml(update: Update): string {
  return `
    <div>
      <strong>NOOS Hub ${escapeHtml(update.version)} 可更新。</strong>
      <span>${escapeHtml(updateSummary(update))}</span>
    </div>
    <button type="button" data-update-action="show">查看更新</button>
    <button type="button" data-update-action="dismiss" aria-label="关闭更新提醒">x</button>
  `;
}

export function renderUpdateDialogHtml(state: UpdateViewState): string {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <header>
          <div>
            <p class="eyebrow">软件更新</p>
            <h2 id="update-dialog-title">${escapeHtml(updateDialogTitle(state))}</h2>
          </div>
          <button type="button" data-update-action="close" aria-label="关闭更新对话框">x</button>
        </header>
        <div class="update-dialog-body">${updateDialogBody(state)}</div>
        <footer>${updateDialogActions(state.status)}</footer>
      </section>
    </div>
  `;
}

export function updateSummary(update: Update): string {
  return update.body ? trimReleaseNotes(update.body).split("\n")[0] || "已找到签名更新，可以安装。" : "已找到签名更新，可以安装。";
}

function updateDialogTitle({ status, availableUpdate }: UpdateViewState): string {
  if (status === "available") {
    return `NOOS Hub ${availableUpdate?.version ?? ""} 可更新`;
  }
  if (status === "up-to-date") {
    return "NOOS Hub 已是最新";
  }
  if (status === "downloading") {
    return "正在安装更新";
  }
  if (status === "restarting") {
    return "正在重启 NOOS Hub";
  }
  if (status === "error") {
    return "更新检查失败";
  }
  return "正在检查更新";
}

function updateDialogBody(state: UpdateViewState): string {
  if (state.status === "checking") {
    return `<p>${escapeHtml(state.message)}</p><div class="update-progress update-progress--indeterminate"><span></span></div>`;
  }
  if (state.status === "up-to-date") {
    return `<p>${escapeHtml(state.message)}</p>`;
  }
  if (state.status === "available" && state.availableUpdate) {
    return `
      <p>${escapeHtml(state.message)}</p>
      ${state.availableUpdate.body ? `<pre>${escapeHtml(trimReleaseNotes(state.availableUpdate.body))}</pre>` : ""}
    `;
  }
  if (state.status === "downloading") {
    const progress = updateProgressPercent(state.downloadedBytes, state.totalBytes);
    return `
      <p>${escapeHtml(state.message)}</p>
      <div class="update-progress"><span style="width: ${progress}%"></span></div>
      <small>${escapeHtml(formatUpdateProgress(state.downloadedBytes, state.totalBytes))}</small>
    `;
  }
  if (state.status === "restarting" || state.status === "error") {
    return `<p>${escapeHtml(state.message)}</p>`;
  }
  return `<p>${escapeHtml(state.message || "正在检查更新。")}</p>`;
}

function updateDialogActions(status: UpdateStatus): string {
  if (status === "available") {
    return `
      <button type="button" data-update-action="later">稍后</button>
      <button type="button" data-update-action="install">安装并重启</button>
    `;
  }
  if (status === "error") {
    return `
      <button type="button" data-update-action="later">关闭</button>
      <button type="button" data-update-action="retry">重试</button>
    `;
  }
  if (status === "checking" || status === "downloading" || status === "restarting") {
    return `<button type="button" disabled>${escapeHtml(status === "checking" ? "检查中..." : "处理中...")}</button>`;
  }
  return `<button type="button" data-update-action="later">关闭</button>`;
}

function trimReleaseNotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 900 ? `${trimmed.slice(0, 900).trim()}...` : trimmed;
}

function updateProgressPercent(downloadedBytes: number, totalBytes?: number): number {
  if (!totalBytes || totalBytes <= 0) return 20;
  return Math.max(4, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
}

function formatUpdateProgress(downloadedBytes: number, totalBytes?: number): string {
  if (!totalBytes) {
    return `已下载 ${formatBytes(downloadedBytes)}`;
  }
  return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
}

function formatBytes(value?: number): string {
  if (!value) return "未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
