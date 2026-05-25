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

The endpoint also accepts NOOS Crystal writes through the same local channel:

```json
{
  "kind": "crystal",
  "filename": "2026-05-14-discussion-snapshot.md",
  "content": "<NOOS crystal markdown>"
}
```

When `kind` is omitted, Hub treats the artifact as a handoff for backward compatibility. `kind: "crystal"` writes to `~/.noos/vault/crystals/active/` and validates `NOOS:CRYSTAL` markers.

Context Pack file requests use `kind: "context_pack_file"` and a safe relative `filename` such as:

```json
{
  "kind": "context_pack_file",
  "filename": "2026-05-25-chatgpt-context/manifest.yaml",
  "content": "type: noos_context_pack\n..."
}
```

Hub writes those files under:

```text
~/.noos/vault/context-packs/
```

Browser fallback writes the same relative structure under:

```text
~/Downloads/NOOS/vault/context-packs/
```

Hub validates:

- token matches
- request origin is allowed when available
- content contains NOOS begin/end markers
- filename is sanitized
- write path stays inside the matching artifact vault, such as `~/.noos/vault/handoffs/active/`, `~/.noos/vault/crystals/active/`, or `~/.noos/vault/context-packs/`

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

Hub writes successful handoff requests directly to:

```text
~/.noos/vault/handoffs/active/
```

Crystal requests with `kind: "crystal"` are written directly to:

```text
~/.noos/vault/crystals/active/
```

Implemented checks:

- Listen only on `127.0.0.1`.
- Accept `POST /v1/handoffs` only.
- Reject non-extension origins when an `Origin` header is present.
- Validate NOOS begin/end markers before writing.
- Sanitize filenames and force `.md`.
- Keep writes inside the matching NOOS Vault artifact directory.
- Write through a temporary file and then rename.
- Generate a unique filename when a target already exists.

Known gaps:

- Port discovery is fixed to `17642`; future Hub should persist runtime port data under `~/.noos/runtime/`.
- Extension status UI does not yet show "Hub connected" separately from "Downloads fallback".
- CORS still allows broad local response headers; request-level origin checks are the real guard in this alpha.

## v0.2 Pairing Token

The alpha direct-write endpoint now has a minimal pairing token flow:

```text
Hub action: Connect Browser Shuttle
  -> create ~/.noos/runtime/shuttle-token.json
  -> open ~/.noos/runtime/shuttle-pairing.json for 120 seconds

Browser Shuttle
  -> POST /v1/handoffs without token
  -> receive 401 unauthorized
  -> GET /pair during the pairing window
  -> store token in chrome.storage.local
  -> retry POST /v1/handoffs with Authorization: Bearer <token>
```

`/pair` only returns a token during the user-opened pairing window and only to extension origins. After the token is claimed, Hub removes the pairing-window file.

Implemented token checks:

- `POST /v1/handoffs` requires `Authorization: Bearer <token>`.
- Hub stores the token under `~/.noos/runtime/shuttle-token.json`.
- Browser Shuttle stores the token in `chrome.storage.local`.
- Hub `/health` reports whether a token exists, but does not return the token.

Remaining hardening:

- Add token rotation and disconnect UI.
- Bind token metadata to the expected extension id where possible.
- Move from fixed port to runtime discovery.

## Extension Status UI

Browser Shuttle displays the active vault route in its panel:

- Hub direct write connected.
- Hub is running but Browser Shuttle is not paired.
- Hub is unavailable; saves use the Browser Vault Mirror.
- Checking route while the background service worker probes Hub.

The status is refreshed when the panel opens, when the user clicks refresh, and after a vault save. This keeps the user-facing language aligned with the actual storage path used for the latest operation.
