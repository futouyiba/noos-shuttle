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

## Risks and Product Traps

The final local write channel has several sharp edges:

- Local port exposure: even a localhost-only service can be called by other local software and sometimes by web pages through browser-mediated requests. Hub must authenticate every write.
- Token lifecycle: pairing tokens can be lost when the user changes Chrome profiles, reinstalls the extension, migrates machines, or runs dev and release builds side by side.
- Hub availability: the browser extension can be active while Hub is closed. The extension must keep a recovery path rather than pretending the handoff reached the real vault.
- Version drift: old Hub plus new extension, or new Hub plus old extension, can disagree on protocol shape. `/health` must report protocol version.
- Path safety: the extension must never be allowed to choose arbitrary filesystem paths. It may suggest a filename; Hub decides the final path.
- Duplicate writes: users may click save several times or collect multiple revisions. Hub should use sanitized filenames, content hash checks, and atomic writes.
- Privacy boundary: handoffs can contain private project context. Git sync must remain a separate explicit action, and logs should not print full handoff bodies.
- Cross-platform install: Native Messaging registration and filesystem conventions differ across macOS, Windows, and Linux. Localhost HTTP is easier to ship first.
- Corporate browser policy: some managed machines may block localhost, extension host permissions, downloads, or Native Messaging.
- UX ambiguity: users need to know whether a handoff is in the real local vault, only in the browser mirror, or synced to Git.

## UX Behavior

The extension should use a three-step save strategy:

1. Try Hub local write endpoint.
2. If Hub is not running, show `Open NOOS Hub` and keep the handoff in the panel.
3. If the user chooses fallback, write to `Downloads/NOOS/vault/handoffs/active/`.

The default should not silently fall back to Downloads forever. Downloads is a recovery bridge, not the primary vault.

## Phase 1: Downloads Mirror Bridge

The first implementation stage keeps the browser extension within Chrome's built-in permissions:

```text
Browser Shuttle
  -> chrome.downloads
  -> ~/Downloads/NOOS/vault/handoffs/active/
  -> Hub action: Import Browser Mirror
  -> ~/.noos/vault/handoffs/active/
```

This stage intentionally does not open a localhost write endpoint yet. It improves the current bridge by making the boundary explicit:

- `Save 2 Vault` in the extension saves to the browser-writable mirror.
- The extension UI labels this as a mirror that Hub can import.
- Hub exposes `Import Browser Mirror` as a local-only action.
- `Sync Handoff to Git` remains separate and can import from the local vault as part of its workflow.
- Release packages include the standalone `scripts/noos-import-browser-vault.sh` helper.

This gives users a predictable local file path today while preserving the final architecture where Hub owns direct writes to `~/.noos`.

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

## v0.2 Alpha Implementation

The first direct-write implementation uses a deliberately small local protocol:

```text
GET  http://127.0.0.1:17642/health
POST http://127.0.0.1:17642/v1/handoffs
```

The browser extension tries the Hub endpoint first. If Hub is unavailable, it falls back to:

```text
~/Downloads/NOOS/vault/handoffs/active/
```

Hub writes successful requests directly to:

```text
~/.noos/vault/handoffs/active/
```

Implemented checks:

- Listen only on `127.0.0.1`.
- Accept `POST /v1/handoffs` only.
- Reject non-extension origins when an `Origin` header is present.
- Validate NOOS begin/end markers before writing.
- Sanitize filenames and force `.md`.
- Keep writes inside `~/.noos/vault/handoffs/active/`.
- Write through a temporary file and then rename.
- Generate a unique filename when a target already exists.

Known gaps:

- Pairing token is not implemented yet.
- Port discovery is fixed to `17642`; future Hub should persist runtime port data under `~/.noos/runtime/`.
- Extension status UI does not yet show "Hub connected" separately from "Downloads fallback".
- CORS still allows broad local response headers; request-level origin checks are the real guard in this alpha.

The next hardening step is pairing:

1. Hub creates a random token.
2. Hub exposes the token through a user-initiated `Connect Browser Shuttle` action.
3. The extension stores it in `chrome.storage.local`.
4. `/v1/handoffs` requires `Authorization: Bearer <token>`.
