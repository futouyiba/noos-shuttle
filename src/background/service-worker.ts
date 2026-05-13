chrome.runtime.onInstalled.addListener(() => {
  console.info("NOOS Shuttle installed.");
});

const HUB_LOCAL_WRITE_URL = "http://127.0.0.1:17642/v1/handoffs";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isVaultSaveMessage(message)) {
    return false;
  }

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
});

interface VaultSaveMessage {
  type: "NOOS_SAVE_HANDOFF_TO_VAULT";
  filename: string;
  content: string;
}

function isVaultSaveMessage(value: unknown): value is VaultSaveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<VaultSaveMessage>;
  return message.type === "NOOS_SAVE_HANDOFF_TO_VAULT" && typeof message.filename === "string" && typeof message.content === "string";
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
  try {
    const response = await fetch(HUB_LOCAL_WRITE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      errorCode: payload.error_code
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "hub_unavailable",
      message: error instanceof Error ? error.message : "NOOS Hub local write unavailable."
    };
  }
}

function sanitizeFilename(filename: string): string {
  const base = filename
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();

  return base.endsWith(".md") && base.length > 3 ? base : "noos-thread.md";
}
