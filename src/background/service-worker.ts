chrome.runtime.onInstalled.addListener(() => {
  console.info("NOOS Shuttle installed.");
});

const HUB_LOCAL_WRITE_URL = "http://127.0.0.1:17642/v1/handoffs";
const HUB_HEALTH_URL = "http://127.0.0.1:17642/health";
const HUB_PAIR_URL = "http://127.0.0.1:17642/pair";
const HUB_TOKEN_STORAGE_KEY = "noosHubShuttleToken";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isVaultSaveMessage(message)) {
    saveHandoffToVault(message.filename, message.content)
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

  return false;
});

interface VaultSaveMessage {
  type: "NOOS_SAVE_HANDOFF_TO_VAULT";
  filename: string;
  content: string;
}

interface VaultStatusMessage {
  type: "NOOS_GET_VAULT_STATUS";
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

function isVaultStatusMessage(value: unknown): value is VaultStatusMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<VaultStatusMessage>).type === "NOOS_GET_VAULT_STATUS";
}

async function getVaultStatus(): Promise<VaultStatusResponse> {
  const token = await getHubToken();
  try {
    const response = await fetch(HUB_HEALTH_URL);
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; paired?: boolean };
    if (response.ok && payload.ok) {
      const paired = Boolean(token);
      return {
        ok: true,
        backend: paired ? "hub_local" : "downloads_mirror",
        hubAvailable: true,
        paired,
        message: paired ? "Hub local write connected." : "NOOS Hub is running. Pair Browser Shuttle before direct writes."
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

async function saveHandoffToVault(
  filename: string,
  content: string
): Promise<{ ok: boolean; backend: string; location: string; importHint: string; message: string }> {
  const hubResult = await saveHandoffToHub(filename, content);
  if (hubResult.ok) {
    return {
      ok: true,
      backend: "hub_local",
      location: hubResult.location ?? "",
      importHint: "Saved directly to the local NOOS Vault.",
      message: hubResult.message ?? "Saved directly to the local NOOS Vault."
    };
  }

  const safeFilename = sanitizeFilename(filename);
  const relativePath = `NOOS/vault/handoffs/active/${safeFilename}`;
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
      importHint: "Open NOOS Hub and run Import Browser Mirror to move this handoff into the local NOOS Vault.",
      message: `Saved to Downloads/${relativePath}. Import it in NOOS Hub.`
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function saveHandoffToHub(
  filename: string,
  content: string
): Promise<{ ok: boolean; location?: string; message?: string; errorCode?: string }> {
  const firstAttempt = await postHandoffToHub(filename, content, await getHubToken());
  if (firstAttempt.ok) {
    return firstAttempt;
  }
  if (firstAttempt.errorCode !== "unauthorized") {
    return firstAttempt;
  }

  const pairedToken = await pairWithHub();
  if (!pairedToken) {
    return firstAttempt;
  }

  return postHandoffToHub(filename, content, pairedToken);
}

async function postHandoffToHub(
  filename: string,
  content: string,
  token: string | null
): Promise<{ ok: boolean; location?: string; message?: string; errorCode?: string }> {
  try {
    const response = await fetch(HUB_LOCAL_WRITE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        filename,
        content,
        source: {
          app: "browser-shuttle"
        }
      })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      location?: string;
      message?: string;
      error_code?: string;
    };
    return {
      ok: response.ok && payload.ok === true,
      location: payload.location,
      message: payload.message,
      errorCode: payload.error_code ?? (response.status === 401 ? "unauthorized" : undefined)
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "hub_unavailable",
      message: error instanceof Error ? error.message : "NOOS Hub local write unavailable."
    };
  }
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

async function getHubToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(HUB_TOKEN_STORAGE_KEY);
    const token = result[HUB_TOKEN_STORAGE_KEY];
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}

function sanitizeFilename(filename: string): string {
  const base = filename
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();

  return base.endsWith(".md") && base.length > 3 ? base : "noos-thread.md";
}
