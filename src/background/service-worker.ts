chrome.runtime.onInstalled.addListener(() => {
  console.info("NOOS Shuttle installed.");
});

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

async function saveHandoffToVault(filename: string, content: string): Promise<{ ok: boolean; location: string; message: string }> {
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
      location: `Downloads/${relativePath}`,
      message: `Saved to Downloads/${relativePath}.`
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function sanitizeFilename(filename: string): string {
  const base = filename
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();

  return base.endsWith(".md") && base.length > 3 ? base : "noos-thread.md";
}
