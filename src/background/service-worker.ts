chrome.runtime.onInstalled.addListener(() => {
  console.info("NOOS Shuttle installed.");
});

const HUB_LOCAL_WRITE_URL = "http://127.0.0.1:17642/v1/ingest";
const HUB_HEALTH_URL = "http://127.0.0.1:17642/health";
const HUB_PAIR_URL = "http://127.0.0.1:17642/pair";
const HUB_VAULT_RECENT_URL = "http://127.0.0.1:17642/v1/vault/recent";
const HUB_VAULT_BROWSE_URL = "http://127.0.0.1:17642/v1/vault/browse";
const HUB_VAULT_OBJECT_URL = "http://127.0.0.1:17642/v1/vault/object";
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
  kind: "handoff" | "crystal",
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
  const artifactLabel = kind === "crystal" ? "crystal" : "handoff";
  const relativePath = `NOOS/vault/${kind === "crystal" ? "crystals" : "handoffs"}/active/${safeFilename}`;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: objectUrl,
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
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function saveMarkdownToHub(
  filename: string,
  content: string,
  kind: "handoff" | "crystal",
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
  kind: "handoff" | "crystal",
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
