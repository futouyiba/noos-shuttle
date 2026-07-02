import type { HubHealth } from "../types";
import { escapeHtml, formatDisplayPath } from "../ui/html";

export interface ConfigData {
  default_wiki_project?: string;
  default_agent?: string;
  github?: { default_account?: string | null; auth_provider?: string };
  schema_version?: string;
}

export function renderConfig(health: HubHealth, config: ConfigData | null): string {
  const wikiPath = config?.default_wiki_project ?? "";
  const agent = config?.default_agent ?? "codex";
  const githubAccount = config?.github?.default_account ?? "";
  const configLoaded = config !== null;

  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">设置</p>
        <h2>配置与偏好</h2>
      </div>
      <div class="section-actions">
        <button type="button" data-action="check-update">检查更新</button>
      </div>
    </section>

    <section class="cfg-section">
      <p class="eyebrow">偏好</p>
      <div class="cfg-list">
        ${editableRow({
          label: "Wiki 项目路径",
          key: "default_wiki_project",
          value: wikiPath,
          placeholder: "~/Projects/my-wiki",
          hint: "飞书文档导出、LLM Wiki 同步的默认目标项目",
          loaded: configLoaded
        })}
        ${selectRow({
          label: "默认 Agent",
          key: "default_agent",
          value: agent,
          options: [
            { value: "codex", label: "Codex" },
            { value: "claude-code", label: "Claude Code" },
            { value: "opencode", label: "OpenCode" }
          ],
          hint: "Handoff 消费和 Projection 生成时优先使用的 agent",
          loaded: configLoaded
        })}
        ${editableRow({
          label: "GitHub 账户",
          key: "github.default_account",
          value: githubAccount,
          placeholder: "futouyiba",
          hint: "同步 Handoff 到 Git 时使用的 GitHub 账户",
          loaded: configLoaded
        })}
      </div>
    </section>

    <section class="cfg-section">
      <p class="eyebrow">连接</p>
      <div class="cfg-list">
        ${actionRow({
          label: "浏览器连接",
          value: health.local_write.paired ? "已连接" : "未连接",
          hint: "本机 token 用于授权浏览器插件写入 Hub",
          action: { id: "reset-browser-connection", label: "重置连接" }
        })}
        ${actionRow({
          label: "GitHub 认证",
          value: config?.github?.auth_provider === "gh" ? "gh CLI" : "未配置",
          hint: "通过 gh auth login 配置 GitHub 认证",
          action: { id: "doctor", label: "检查状态" }
        })}
      </div>
    </section>

    <section class="cfg-section">
      <p class="eyebrow">更新</p>
      <div class="cfg-list">
        ${readonlyRow({
          label: "当前版本",
          value: "NOOS Hub 0.1.4",
          hint: "FuTou 2026 · 检查签名更新"
        })}
        ${actionRow({
          label: "软件更新",
          value: "GitHub Releases",
          hint: "自动检查签名 manifest，下载并安装更新",
          action: { id: "", label: "检查更新", dataAction: "check-update" }
        })}
      </div>
    </section>

    <section class="cfg-section">
      <p class="eyebrow">路径</p>
      <div class="cfg-list">
        ${readonlyRow({
          label: "用户配置",
          value: formatDisplayPath(`${health.noos_home}/config.json`, health.noos_home),
          hint: "用户级配置"
        })}
        ${readonlyRow({
          label: "Vault",
          value: formatDisplayPath(`${health.noos_home}/vault`, health.noos_home),
          hint: "本机 Handoff、Crystal 存储中心"
        })}
      </div>
    </section>

    <section class="panel">
      <h3>浏览器插件</h3>
      <p>Hub 更新包自带当前版本的 Shuttle 扩展目录。在浏览器扩展页启用开发者模式并加载该目录。</p>
      <button type="button" data-run="open-bundled-shuttle-extension">打开内置插件目录</button>
    </section>
  `;
}

interface EditableRowParams {
  label: string;
  key: string;
  value: string;
  placeholder: string;
  hint: string;
  loaded: boolean;
}

function editableRow(p: EditableRowParams): string {
  return `
    <article class="cfg-row">
      <div class="cfg-row-info">
        <strong>${escapeHtml(p.label)}</strong>
        <span>${escapeHtml(p.hint)}</span>
      </div>
      <div class="cfg-row-value" data-config-key="${escapeHtml(p.key)}">
        <span class="cfg-value-text">${p.loaded ? escapeHtml(p.value || "—") : "加载中…"}</span>
        <button type="button" class="cfg-edit-btn" data-config-edit="${escapeHtml(p.key)}" title="编辑">✎</button>
        <div class="cfg-edit-form" hidden>
          <input type="text" data-config-input="${escapeHtml(p.key)}" value="${escapeHtml(p.value)}" placeholder="${escapeHtml(p.placeholder)}" />
          <button type="button" data-config-save="${escapeHtml(p.key)}">保存</button>
          <button type="button" data-config-cancel="${escapeHtml(p.key)}">取消</button>
        </div>
      </div>
    </article>
  `;
}

interface SelectRowParams {
  label: string;
  key: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  hint: string;
  loaded: boolean;
}

function selectRow(p: SelectRowParams): string {
  const displayValue = p.options.find((o) => o.value === p.value)?.label ?? p.value;

  return `
    <article class="cfg-row">
      <div class="cfg-row-info">
        <strong>${escapeHtml(p.label)}</strong>
        <span>${escapeHtml(p.hint)}</span>
      </div>
      <div class="cfg-row-value" data-config-key="${escapeHtml(p.key)}">
        <span class="cfg-value-text">${p.loaded ? escapeHtml(displayValue) : "加载中…"}</span>
        <button type="button" class="cfg-edit-btn" data-config-edit="${escapeHtml(p.key)}" title="编辑">✎</button>
        <div class="cfg-edit-form" hidden>
          <select data-config-select="${escapeHtml(p.key)}">
            ${p.options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === p.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
          </select>
          <button type="button" data-config-save="${escapeHtml(p.key)}">保存</button>
          <button type="button" data-config-cancel="${escapeHtml(p.key)}">取消</button>
        </div>
      </div>
    </article>
  `;
}

interface ActionRowParams {
  label: string;
  value: string;
  hint: string;
  action: { id: string; label: string; dataAction?: string };
}

function actionRow(p: ActionRowParams): string {
  return `
    <article class="cfg-row">
      <div class="cfg-row-info">
        <strong>${escapeHtml(p.label)}</strong>
        <span>${escapeHtml(p.hint)}</span>
      </div>
      <div class="cfg-row-value">
        <span class="cfg-value-text">${escapeHtml(p.value)}</span>
        ${p.action.dataAction
          ? `<button type="button" data-action="${escapeHtml(p.action.dataAction)}">${escapeHtml(p.action.label)}</button>`
          : p.action.id
            ? `<button type="button" data-run="${escapeHtml(p.action.id)}">${escapeHtml(p.action.label)}</button>`
            : ""}
      </div>
    </article>
  `;
}

interface ReadonlyRowParams {
  label: string;
  value: string;
  hint: string;
}

function readonlyRow(p: ReadonlyRowParams): string {
  return `
    <article class="cfg-row">
      <div class="cfg-row-info">
        <strong>${escapeHtml(p.label)}</strong>
        <span>${escapeHtml(p.hint)}</span>
      </div>
      <div class="cfg-row-value">
        <code>${escapeHtml(p.value)}</code>
      </div>
    </article>
  `;
}
