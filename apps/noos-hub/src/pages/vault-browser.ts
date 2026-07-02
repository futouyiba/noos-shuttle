import { escapeHtml, formatDisplayPath, formatModifiedAt } from "../ui/html";

export interface VaultBrowserState {
  folder: string;
  query: string;
  objects: VaultBrowseObject[];
  folders: VaultBrowseFolder[];
  expandedKey: string | null;
  expandedContent: string | null;
}

export interface VaultBrowseFolder {
  id: string;
  label: string;
  kind: string;
}

export interface VaultBrowseObject {
  object_type: string;
  lookup_key: string;
  key: string;
  title: string;
  name: string;
  path: string;
  source_url?: string;
  modified_epoch: number;
  folder: string;
}

export function createVaultBrowserState(): VaultBrowserState {
  return {
    folder: "latest",
    query: "",
    objects: [],
    folders: [],
    expandedKey: null,
    expandedContent: null
  };
}

export function renderVaultBrowser(state: VaultBrowserState, noosHome: string): string {
  const { folder, query, objects, folders, expandedKey, expandedContent } = state;

  const folderTabs = folders.length > 0
    ? folders.map((f) => {
        const active = f.id === folder;
        return `<button type="button" data-vault-folder="${escapeHtml(f.id)}" class="vb-tab ${active ? "vb-tab--active" : ""}">${escapeHtml(f.label)}</button>`;
      }).join("")
    : "";

  return `
    <section class="vb-root">
      <div class="vb-toolbar">
        <div class="vb-tabs">${folderTabs}</div>
        <div class="vb-search">
          <input type="search" data-vault-search placeholder="搜索文件名、标题或 key…" value="${escapeHtml(query)}" />
        </div>
      </div>
      <div class="vb-list">
        ${objects.length > 0
          ? objects
              .map((obj, index) => renderBrowserRow(obj, index, noosHome, expandedKey, expandedContent))
              .join("")
          : `<div class="vb-empty">${query ? "没有匹配的文件。" : "这个文件夹是空的。"}</div>`
        }
      </div>
    </section>
  `;
}

function renderBrowserRow(
  obj: VaultBrowseObject,
  index: number,
  noosHome: string,
  expandedKey: string | null,
  expandedContent: string | null
): string {
  const rowId = obj.path || obj.key;
  const isExpanded = expandedKey === rowId;
  const title = obj.title || obj.name;
  const typeLabel = obj.object_type === "crystal"
    ? "Crystal"
    : obj.object_type === "result"
      ? "Result"
      : obj.object_type === "artifact"
        ? "Artifact"
        : "Handoff";

  return `
    <article class="vb-row ${isExpanded ? "vb-row--expanded" : ""}">
      <div class="vb-row-main" data-vault-expand="${escapeHtml(rowId)}" data-vault-key="${escapeHtml(obj.key)}" data-vault-path="${escapeHtml(obj.path)}" data-vault-object-folder="${escapeHtml(obj.folder)}" data-vault-index="${index}">
        <div class="vb-row-left">
          <span class="vb-type-tag vb-type--${escapeHtml(obj.object_type)}">${typeLabel}</span>
          <div>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(obj.key)}</span>
            <code>${escapeHtml(formatDisplayPath(obj.path, noosHome))}</code>
          </div>
        </div>
        <div class="vb-row-right">
          <span class="vb-date">${escapeHtml(formatModifiedAt(obj.modified_epoch))}</span>
          <button type="button" data-vault-path="${escapeHtml(obj.path)}" data-vault-file-action="open-vault-file" class="vb-action">打开</button>
        </div>
      </div>
      ${isExpanded ? `
      <div class="vb-preview">
        ${expandedContent !== null
          ? `<pre>${escapeHtml(truncatePreview(expandedContent, 600))}</pre>`
          : `<div class="vb-preview-loading">加载中…</div>`
        }
      </div>` : ""}
    </article>
  `;
}

function truncatePreview(content: string, maxChars: number): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
}
