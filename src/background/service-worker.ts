chrome.runtime.onInstalled.addListener(() => {
  console.info("NOOS Shuttle installed.");
});

const HUB_LOCAL_WRITE_URL = "http://127.0.0.1:17642/v1/ingest";
const HUB_HEALTH_URL = "http://127.0.0.1:17642/health";
const HUB_PAIR_URL = "http://127.0.0.1:17642/pair";
const HUB_VAULT_RECENT_URL = "http://127.0.0.1:17642/v1/vault/recent";
const HUB_VAULT_BROWSE_URL = "http://127.0.0.1:17642/v1/vault/browse";
const HUB_VAULT_OBJECT_URL = "http://127.0.0.1:17642/v1/vault/object";
const HUB_WIKI_TARGET_URL = "http://127.0.0.1:17642/v1/wiki/default-target";
const HUB_ACTION_URL = "http://127.0.0.1:17642/v1/actions";
const HUB_TOKEN_STORAGE_KEY = "noosHubShuttleToken";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isVaultSaveMessage(message)) {
    saveMarkdownToVault(message.filename, message.content, "handoff", sender.tab?.url)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "NOOS Vault save failed."
        });
      });

    return true;
  }

  if (isCrystalSaveMessage(message)) {
    saveMarkdownToVault(message.filename, message.content, "crystal", sender.tab?.url)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "NOOS Vault save failed."
        });
      });

    return true;
  }

  if (isContextPackSaveMessage(message)) {
    saveContextPackToVault(message.directory, message.files, message.sourceUrl)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "context_pack_save_failed",
          message: error instanceof Error ? error.message : "Context Pack save failed."
        });
      });

    return true;
  }

  if (isArtifactDownloadMessage(message)) {
    downloadArtifactsToMirror(message.directory, message.files)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "artifact_download_failed",
          message: error instanceof Error ? error.message : "Artifact download failed."
        });
      });

    return true;
  }

  if (isVaultStatusMessage(message)) {
    getVaultStatus().then(sendResponse);
    return true;
  }

  if (isVaultRecentMessage(message)) {
    getVaultRecentObjects()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "Could not load NOOS Vault objects."
        });
      });
    return true;
  }

  if (isVaultBrowseMessage(message)) {
    getVaultBrowseObjects(message.folder, message.query)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "Could not browse NOOS Vault."
        });
      });
    return true;
  }

  if (isVaultObjectMessage(message)) {
    getVaultObject(message.lookupKey)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "vault_failed",
          message: error instanceof Error ? error.message : "Could not load NOOS Vault object."
        });
      });
    return true;
  }

  if (isWikiTargetMessage(message)) {
    getWikiTarget()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          errorCode: "hub_unavailable",
          message: error instanceof Error ? error.message : "Could not load default Wiki project."
        });
      });
    return true;
  }

  if (isFeishuWikiActionMessage(message)) {
    runFeishuWikiAction(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          status: "hub_unavailable",
          errorCode: "hub_unavailable",
          message: error instanceof Error ? error.message : "NOOS Hub action failed."
        });
      });
    return true;
  }

  return false;
});

interface VaultSaveMessage {
  type: "NOOS_SAVE_HANDOFF_TO_VAULT";
  filename: string;
  content: string;
}

interface CrystalSaveMessage {
  type: "NOOS_SAVE_CRYSTAL_TO_VAULT";
  filename: string;
  content: string;
}

interface ContextPackSaveMessage {
  type: "NOOS_SAVE_CONTEXT_PACK_TO_VAULT";
  directory: string;
  files: Array<{ path: string; content: string }>;
  sourceUrl?: string;
}

interface ArtifactDownloadMessage {
  type: "NOOS_DOWNLOAD_ARTIFACTS";
  directory: string;
  files: Array<{ filename: string; url: string }>;
}

interface VaultStatusMessage {
  type: "NOOS_GET_VAULT_STATUS";
}

interface VaultRecentMessage {
  type: "NOOS_GET_VAULT_RECENT";
}

interface VaultBrowseMessage {
  type: "NOOS_BROWSE_VAULT";
  folder?: string;
  query?: string;
}

interface VaultObjectMessage {
  type: "NOOS_GET_VAULT_OBJECT";
  lookupKey: string;
}

interface WikiTargetMessage {
  type: "NOOS_GET_WIKI_TARGET";
}

interface FeishuWikiActionMessage {
  type: "NOOS_FEISHU_WIKI_ACTION";
  action:
    | "export_md"
    | "organize_wiki"
    | "export_md_and_organize"
    | "open_markdown_folder"
    | "open_wiki_folder"
    | "sync_markdown"
    | "sync_markdown_and_organize";
  url: string;
  title?: string;
  wikiProjectPath?: string;
}

interface VaultStatusResponse {
  ok: boolean;
  backend: "hub_local" | "downloads_mirror";
  hubAvailable: boolean;
  paired: boolean;
  message: string;
}

function isVaultSaveMessage(value: unknown): value is VaultSaveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<VaultSaveMessage>;
  return message.type === "NOOS_SAVE_HANDOFF_TO_VAULT" && typeof message.filename === "string" && typeof message.content === "string";
}

function isCrystalSaveMessage(value: unknown): value is CrystalSaveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<CrystalSaveMessage>;
  return message.type === "NOOS_SAVE_CRYSTAL_TO_VAULT" && typeof message.filename === "string" && typeof message.content === "string";
}

function isContextPackSaveMessage(value: unknown): value is ContextPackSaveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ContextPackSaveMessage>;
  return (
    message.type === "NOOS_SAVE_CONTEXT_PACK_TO_VAULT" &&
    typeof message.directory === "string" &&
    Array.isArray(message.files) &&
    message.files.every((file) => typeof file?.path === "string" && typeof file?.content === "string")
  );
}

function isArtifactDownloadMessage(value: unknown): value is ArtifactDownloadMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ArtifactDownloadMessage>;
  return (
    message.type === "NOOS_DOWNLOAD_ARTIFACTS" &&
    typeof message.directory === "string" &&
    Array.isArray(message.files) &&
    message.files.every((file) => typeof file?.filename === "string" && typeof file?.url === "string")
  );
}

function isVaultStatusMessage(value: unknown): value is VaultStatusMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<VaultStatusMessage>).type === "NOOS_GET_VAULT_STATUS";
}

function isVaultRecentMessage(value: unknown): value is VaultRecentMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<VaultRecentMessage>).type === "NOOS_GET_VAULT_RECENT";
}

function isVaultBrowseMessage(value: unknown): value is VaultBrowseMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<VaultBrowseMessage>;
  return (
    message.type === "NOOS_BROWSE_VAULT" &&
    (message.folder === undefined || typeof message.folder === "string") &&
    (message.query === undefined || typeof message.query === "string")
  );
}

function isVaultObjectMessage(value: unknown): value is VaultObjectMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<VaultObjectMessage>;
  return message.type === "NOOS_GET_VAULT_OBJECT" && typeof message.lookupKey === "string";
}

function isWikiTargetMessage(value: unknown): value is WikiTargetMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<WikiTargetMessage>).type === "NOOS_GET_WIKI_TARGET";
}

function isFeishuWikiActionMessage(value: unknown): value is FeishuWikiActionMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<FeishuWikiActionMessage>;
  return (
    message.type === "NOOS_FEISHU_WIKI_ACTION" &&
    (message.action === "export_md" ||
      message.action === "sync_markdown" ||
      message.action === "organize_wiki" ||
      message.action === "export_md_and_organize" ||
      message.action === "sync_markdown_and_organize" ||
      message.action === "open_markdown_folder" ||
      message.action === "open_wiki_folder") &&
    typeof message.url === "string" &&
    (message.title === undefined || typeof message.title === "string") &&
    (message.wikiProjectPath === undefined || typeof message.wikiProjectPath === "string")
  );
}

async function getVaultRecentObjects(): Promise<unknown> {
  return getAuthorizedHubJson(HUB_VAULT_RECENT_URL);
}

async function getVaultBrowseObjects(folder?: string, query?: string): Promise<unknown> {
  const params = new URLSearchParams();
  if (folder) {
    params.set("folder", folder);
  }
  if (query) {
    params.set("q", query);
  }
  const suffix = params.toString();
  return getAuthorizedHubJson(suffix ? `${HUB_VAULT_BROWSE_URL}?${suffix}` : HUB_VAULT_BROWSE_URL);
}

async function getVaultObject(lookupKey: string): Promise<unknown> {
  return getAuthorizedHubJson(`${HUB_VAULT_OBJECT_URL}?key=${encodeURIComponent(lookupKey)}`);
}

async function getWikiTarget(): Promise<unknown> {
  return normalizeHubPayload(await getAuthorizedHubJson(HUB_WIKI_TARGET_URL));
}

async function runFeishuWikiAction(message: FeishuWikiActionMessage): Promise<unknown> {
  const payload = await postAuthorizedHubJson(HUB_ACTION_URL, {
    command: feishuCommandForAction(message.action),
    url: message.url,
    title: message.title,
    wiki_project_path: message.wikiProjectPath,
    force: message.action === "organize_wiki"
  });
  return normalizeHubPayload(payload);
}

export function feishuCommandForAction(action: FeishuWikiActionMessage["action"]): string {
  const commandByAction: Record<FeishuWikiActionMessage["action"], string> = {
    export_md: "feishu.exportMd",
    sync_markdown: "feishu.syncMarkdown",
    organize_wiki: "wiki.organizeSource",
    export_md_and_organize: "feishu.exportMdAndOrganize",
    sync_markdown_and_organize: "feishu.syncMarkdownAndOrganize",
    open_markdown_folder: "wiki.openFeishuSourceFolder",
    open_wiki_folder: "wiki.openProjectFolder"
  };
  return commandByAction[action];
}

async function getAuthorizedHubJson(url: string): Promise<unknown> {
  const token = await getOrPairHubToken();
  if (!token) {
    return {
      ok: false,
      errorCode: "hub_unavailable",
      message: "NOOS Hub is not reachable."
    };
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      ...(typeof payload === "object" && payload ? payload : {}),
      errorCode: (payload as { error_code?: string }).error_code ?? (response.status === 401 ? "unauthorized" : "hub_request_failed")
    };
  }
  return payload;
}

async function postAuthorizedHubJson(url: string, body: unknown): Promise<unknown> {
  const token = await getOrPairHubToken();
  if (!token) {
    return {
      ok: false,
      status: "hub_unavailable",
      errorCode: "hub_unavailable",
      message: "NOOS Hub is not reachable."
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      ...(typeof payload === "object" && payload ? payload : {}),
      errorCode: (payload as { error_code?: string }).error_code ?? (response.status === 401 ? "unauthorized" : "hub_request_failed")
    };
  }
  return payload;
}

function normalizeHubPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const value = payload as Record<string, unknown>;
  return {
    ...value,
    errorCode: value.errorCode ?? value.error_code,
    projectPath: value.projectPath ?? value.project_path,
    wikiProjectPath: value.wikiProjectPath ?? value.wiki_project_path,
    sourcePath: value.sourcePath ?? value.source_path
  };
}

async function getVaultStatus(): Promise<VaultStatusResponse> {
  try {
    const response = await fetch(HUB_HEALTH_URL);
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; paired?: boolean };
    if (response.ok && payload.ok) {
      const token = await getOrPairHubToken();
      const paired = Boolean(token);
      return {
        ok: true,
        backend: paired ? "hub_local" : "downloads_mirror",
        hubAvailable: true,
        paired,
        message: paired ? "Hub local write connected." : "NOOS Hub is running, but Browser Shuttle could not connect."
      };
    }
  } catch {
    // Fall through to the mirror status.
  }

  return {
    ok: true,
    backend: "downloads_mirror",
    hubAvailable: false,
    paired: false,
    message: "NOOS Hub is not reachable. Saves will use the Browser Vault Mirror."
  };
}

async function saveMarkdownToVault(
  filename: string,
  content: string,
  kind: "handoff" | "crystal" | "context_pack_file",
  sourceUrl?: string
): Promise<{ ok: boolean; backend: string; location: string; importHint: string; message: string; lookupKey?: string; key?: string; objectId?: string }> {
  const hubResult = await saveMarkdownToHub(filename, content, kind, sourceUrl);
  if (hubResult.ok) {
    return {
      ok: true,
      backend: "hub_local",
      location: hubResult.location ?? "",
      lookupKey: hubResult.lookupKey,
      key: hubResult.key,
      objectId: hubResult.objectId,
      importHint: "Saved directly to the local NOOS Vault.",
      message: hubResult.lookupKey
        ? `${hubResult.message ?? "Saved directly to the local NOOS Vault."} Key: ${hubResult.lookupKey}`
        : hubResult.message ?? "Saved directly to the local NOOS Vault."
    };
  }

  const safeFilename = sanitizeFilename(filename);
  const artifactLabel = kind === "crystal" ? "crystal" : kind === "context_pack_file" ? "context pack file" : "handoff";
  const relativePath =
    kind === "context_pack_file"
      ? `NOOS/vault/context-packs/${sanitizeRelativePath(filename)}`
      : `NOOS/vault/${kind === "crystal" ? "crystals" : "handoffs"}/active/${safeFilename}`;
  await chrome.downloads.download({
    url: `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`,
    filename: relativePath,
    conflictAction: "uniquify",
    saveAs: false
  });

  return {
    ok: true,
    backend: "downloads_mirror",
    location: `Downloads/${relativePath}`,
    importHint: `Open NOOS Hub and run Import Browser Mirror to move this ${artifactLabel} into the local NOOS Vault.`,
    message: `Saved to Downloads/${relativePath}. Import it in NOOS Hub.`
  };
}

async function saveMarkdownToHub(
  filename: string,
  content: string,
  kind: "handoff" | "crystal" | "context_pack_file",
  sourceUrl?: string
): Promise<{ ok: boolean; location?: string; message?: string; errorCode?: string; lookupKey?: string; key?: string; objectId?: string }> {
  const firstAttempt = await postMarkdownToHub(filename, content, kind, await getOrPairHubToken(), sourceUrl);
  if (firstAttempt.ok) {
    return firstAttempt;
  }
  if (firstAttempt.errorCode !== "unauthorized") {
    return firstAttempt;
  }

  await clearHubToken();
  const pairedToken = await pairWithHub();
  if (!pairedToken) {
    return firstAttempt;
  }

  return postMarkdownToHub(filename, content, kind, pairedToken, sourceUrl);
}

async function postMarkdownToHub(
  filename: string,
  content: string,
  kind: "handoff" | "crystal" | "context_pack_file",
  token: string | null,
  sourceUrl?: string
): Promise<{ ok: boolean; location?: string; message?: string; errorCode?: string; lookupKey?: string; key?: string; objectId?: string }> {
  try {
    const response = await fetch(HUB_LOCAL_WRITE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        protocol_version: 1,
        request_id: crypto.randomUUID(),
        idempotency_key: await createIdempotencyKey(kind, sourceUrl ?? "", content),
        object_type: kind,
        source: {
          app: "browser-shuttle",
          url: sourceUrl,
          captured_at: new Date().toISOString()
        },
        suggested: {
          filename,
          status: "active"
        },
        content: {
          media_type: "text/markdown",
          text: content
        }
      })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      location?: string;
      message?: string;
      error_code?: string;
      lookup_key?: string;
      key?: string;
      object_id?: string;
      path?: string;
    };
    return {
      ok: response.ok && payload.ok === true,
      location: payload.location ?? payload.path,
      message: payload.message,
      errorCode: payload.error_code ?? (response.status === 401 ? "unauthorized" : undefined),
      lookupKey: payload.lookup_key ?? payload.key,
      key: payload.lookup_key ?? payload.key,
      objectId: payload.object_id
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "hub_unavailable",
      message: error instanceof Error ? error.message : "NOOS Hub local write unavailable."
    };
  }
}

async function createIdempotencyKey(kind: string, sourceUrl: string, content: string): Promise<string> {
  const input = new TextEncoder().encode(`${kind}\n${sourceUrl}\n${content}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function saveContextPackToVault(
  directory: string,
  files: Array<{ path: string; content: string }>,
  sourceUrl?: string
): Promise<{ ok: boolean; backend: string; location: string; message: string; errorCode?: string }> {
  const safeDirectory = sanitizePathSegment(directory) || "context-pack";
  const results = [];

  for (const file of files) {
    const relativeFilePath = `${safeDirectory}/${sanitizeRelativePath(file.path)}`;
    results.push(await saveMarkdownToVault(relativeFilePath, file.content, "context_pack_file", sourceUrl));
  }

  const ok = results.every((result) => result.ok);
  const backend = results.find((result) => result.backend === "hub_local") ? "hub_local" : "downloads_mirror";
  const location =
    backend === "hub_local"
      ? results.find((result) => result.backend === "hub_local")?.location ?? ""
      : `Downloads/NOOS/vault/context-packs/${safeDirectory}`;

  return {
    ok,
    backend,
    location,
    errorCode: ok ? undefined : "context_pack_partial_save",
    message: ok
      ? `Context Pack saved to ${backend === "hub_local" ? "local NOOS Vault" : "Downloads Browser Vault Mirror"}: ${location}`
      : `Context Pack save finished with issues. Check ${location}. Source: ${sourceUrl ?? "current page"}`
  };
}

async function downloadArtifactsToMirror(
  directory: string,
  files: Array<{ filename: string; url: string }>
): Promise<{ ok: boolean; backend: string; location: string; message: string; count: number }> {
  const safeDirectory = sanitizeRelativePath(directory) || "chatgpt-images";
  const basePath = `NOOS/vault/artifacts/files/${safeDirectory}`;
  let count = 0;

  for (const file of files) {
    const filename = sanitizeFilename(file.filename);
    await chrome.downloads.download({
      url: file.url,
      filename: `${basePath}/${filename}`,
      conflictAction: "uniquify",
      saveAs: false
    });
    count += 1;
  }

  return {
    ok: true,
    backend: "downloads_mirror",
    location: `Downloads/${basePath}`,
    message: `Downloaded ${count} artifact(s) to Downloads/${basePath}.`,
    count
  };
}

async function pairWithHub(): Promise<string | null> {
  try {
    const response = await fetch(HUB_PAIR_URL);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { token?: string };
    if (!payload.token) {
      return null;
    }
    await chrome.storage.local.set({ [HUB_TOKEN_STORAGE_KEY]: payload.token });
    return payload.token;
  } catch {
    return null;
  }
}

async function getOrPairHubToken(): Promise<string | null> {
  return (await getHubToken()) ?? (await pairWithHub());
}

async function getHubToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(HUB_TOKEN_STORAGE_KEY);
    const token = result[HUB_TOKEN_STORAGE_KEY];
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}

async function clearHubToken(): Promise<void> {
  try {
    await chrome.storage.local.remove(HUB_TOKEN_STORAGE_KEY);
  } catch {
    // A failed token cleanup should not block the Downloads mirror fallback.
  }
}

function sanitizeFilename(filename: string): string {
  const base = filename
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();

  return base.endsWith(".md") && base.length > 3 ? base : "noos-thread.md";
}

function sanitizeRelativePath(path: string): string {
  const parts = path.split(/[\\/]/).map(sanitizePathSegment).filter(Boolean);
  return parts.length > 0 ? parts.join("/") : "file.md";
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[\\/:]/g, "-")
    .replace(/^\.+/, "")
    .trim();
}
