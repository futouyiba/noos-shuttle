# NOOS Hub Local Write Channel

## Problem

The browser extension needs to save handoffs into the NOOS local filesystem, but Chrome extensions cannot silently write arbitrary files to `~/.noos`.

The current v0 bridge writes to:

```text
~/Downloads/NOOS/vault/handoffs/active/
```

That is useful as a fallback, but it is not the final product experience. The user expectation is `Save 2 Vault` meaning "save into NOOS", not "download a file and let Hub import it later".

## Recommended Direction

NOOS Hub should expose a local write channel owned by the desktop app:

```text
Browser Shuttle extension
  -> localhost NOOS Hub write endpoint
  -> ~/.noos/vault/handoffs/active/
  -> optional Hub-driven Git sync
```

This keeps the browser extension small and keeps filesystem authority inside Hub.

## Transport Choice

Use a localhost HTTP endpoint first, with Native Messaging as a later fallback for managed or locked-down browser environments.

### Why Localhost HTTP First

- Works with Chrome extension `fetch`.
- Works while Hub is running as a desktop app or background helper.
- Easy to debug with curl.
- Allows a clear health endpoint for the extension.
- Can later support other browser extensions and local tools.

### Why Not Native Messaging First

Native Messaging is powerful, but it requires installing a browser-specific host manifest. That increases first-run setup complexity and makes the install story harder on Windows and macOS. It should remain a fallback for environments where localhost is blocked.

## Security Model

The local write endpoint must not be an unauthenticated open port.

Hub should create a machine-local pairing secret:

```text
~/.noos/runtime/shuttle-token.json
```

Suggested shape:

```json
{
  "version": 1,
  "origin": "chrome-extension://<extension-id>",
  "token": "<random 256-bit token>",
  "created_at": "2026-05-06T00:00:00Z"
}
```

The extension obtains the token through one explicit pairing step:

1. User opens NOOS Hub.
2. Hub shows `Connect Browser Shuttle`.
3. Hub opens or copies a one-time pairing URL/token.
4. Extension stores the token in `chrome.storage.local`.
5. Future saves use the stored token.

Requests include:

```http
POST http://127.0.0.1:<port>/v1/handoffs
Authorization: Bearer <token>
Content-Type: application/json
```

Payload:

```json
{
  "filename": "2026-05-06-example.md",
  "content": "<NOOS handoff markdown>",
  "source": {
    "app": "chatgpt",
    "url": "https://chatgpt.com/..."
  }
}
```

Hub validates:

- token matches
- request origin is allowed when available
- content contains NOOS begin/end markers
- filename is sanitized
- write path stays inside `~/.noos/vault/handoffs/active/`

## UX Behavior

The extension should use a three-step save strategy:

1. Try Hub local write endpoint.
2. If Hub is not running, show `Open NOOS Hub` and keep the handoff in the panel.
3. If the user chooses fallback, write to `Downloads/NOOS/vault/handoffs/active/`.

The default should not silently fall back to Downloads forever. Downloads is a recovery bridge, not the primary vault.

## Hub Responsibilities

Hub owns:

- creating the local vault directories
- pairing Browser Shuttle
- receiving handoffs
- validating and writing handoff files
- showing recent handoffs
- retrying failed writes
- Git sync as a separate user action

The browser extension owns:

- generating and capturing handoffs
- previewing validation warnings
- sending a save request to Hub
- fallback download only when Hub is unavailable

## Minimal v1 Plan

1. Add a Hub background listener on `127.0.0.1` with a random available port.
2. Persist the port and token under `~/.noos/runtime/`.
3. Add `Connect Browser Shuttle` in Hub.
4. Add extension settings for local Hub connection status.
5. Change `NoosVaultAdapter` to try Hub HTTP first, Downloads mirror second.
6. Keep `Sync Handoff to Git` as an explicit Hub button.

This gives a smooth default path while preserving a clear safety boundary: only Hub writes to the NOOS filesystem.
