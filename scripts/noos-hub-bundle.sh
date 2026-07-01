#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HUB_DIR="$ROOT_DIR/apps/noos-hub"

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY"
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY_PATH"
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PATH"
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" && -n "${NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
fi

cd "$HUB_DIR"

remove_stale_updater_artifacts() {
  local target_dir="$HUB_DIR/src-tauri/target"
  if [[ -d "$target_dir" ]]; then
    find "$target_dir" -path "*/bundle/*" -type f \
      \( -name "*.app.tar.gz" -o -name "*.app.tar.gz.sig" -o -name "latest.json" \) \
      -delete
  fi
}

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  npm run tauri -- build "$@"
else
  echo "No Tauri updater signing key found; building NOOS Hub without updater artifacts." >&2
  echo "Set TAURI_SIGNING_PRIVATE_KEY or NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY to build signed updater artifacts." >&2
  remove_stale_updater_artifacts
  npm run tauri -- build --config '{"bundle":{"createUpdaterArtifacts":false}}' "$@"
  remove_stale_updater_artifacts
fi
