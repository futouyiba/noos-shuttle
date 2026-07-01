# NOOS Hub Updater Signing

NOOS Hub uses Tauri updater signatures for desktop auto-update trust. The signing
private key is only needed when building updater artifacts for a release. It must
never be committed to the repository or referenced from frontend code.

## Source of Truth

- Tracked public key: `apps/noos-hub/src-tauri/tauri.conf.json` at `plugins.updater.pubkey`.
- Local private key: `~/.noos/keys/noos-hub-updater.key`.
- Local key password: `~/.noos/keys/noos-hub-updater.password`.
- GitHub repository: `futouyiba/noos-shuttle`.
- GitHub Actions secrets:
  - `NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY`
  - `NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The current keypair was provisioned on 2026-07-01. The private key and password
are intentionally not stored in git; back them up through a secure offline or
password-manager workflow.

## Normal Release Flow

1. Push a `v*` tag to trigger `.github/workflows/release.yml`.
2. The workflow maps the NOOS secret names into Tauri's expected variables:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
3. `npm run hub:bundle` builds the Hub app, updater tarball, and updater
   signature.
4. The workflow publishes `noos-hub-latest.json`, the updater tarball, its
   signature, and the macOS installer artifacts to GitHub Releases.

Local builds do not require signing secrets. Without a signing key,
`npm run hub:bundle` disables updater artifacts and still builds a runnable app
bundle.

## Local Signed Verification

Use this when checking that the local key still matches the tracked public key:

```sh
NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.noos/keys/noos-hub-updater.key" \
NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$HOME/.noos/keys/noos-hub-updater.password")" \
npm run hub:bundle
```

Expected signed updater artifacts:

- `apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app.tar.gz`
- `apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app.tar.gz.sig`

Confirm the GitHub secrets exist without printing values:

```sh
gh secret list --repo futouyiba/noos-shuttle | rg 'NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY'
```

## Key Rotation

Rotate the key if the private key or password is lost, suspected compromised, or
intentionally moved to a new custody workflow.

1. Archive the old local files outside git if they still exist.
2. Generate a new password and Tauri updater keypair under `~/.noos/keys/`.
3. Replace `plugins.updater.pubkey` in `apps/noos-hub/src-tauri/tauri.conf.json`
   with the generated `.pub` file content.
4. Upload the new private key and password to GitHub Actions secrets:

```sh
gh secret set NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY --repo futouyiba/noos-shuttle < "$HOME/.noos/keys/noos-hub-updater.key"
gh secret set NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo futouyiba/noos-shuttle < "$HOME/.noos/keys/noos-hub-updater.password"
```

5. Run local signed verification.
6. After the next tagged release, confirm GitHub Releases contains the updater
   tarball, `.sig`, and `noos-hub-latest.json`.

## Agent Rules

- Do not read, print, summarize, or commit private key/password contents.
- Do not store signing material in `.env`, docs, source files, or NOOS runtime
  projections.
- It is safe to reference key paths, public key location, and GitHub secret
  names.
