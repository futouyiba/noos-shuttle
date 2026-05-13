#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
PACKAGE_DIR="$ROOT_DIR/release"
SKILLS_PATH="$PACKAGE_DIR/noos-agent-skills-$VERSION.tar.gz"
HUB_PATH="$PACKAGE_DIR/noos-hub-source-$VERSION.tar.gz"

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required to package NOOS release artifacts." >&2
  exit 1
fi

cd "$ROOT_DIR"
mkdir -p "$PACKAGE_DIR"

"$ROOT_DIR/scripts/package-extension.sh"

rm -f "$SKILLS_PATH" "$HUB_PATH"

tar \
  --exclude=".DS_Store" \
  -czf "$SKILLS_PATH" \
  AGENTS.md \
  CLAUDE.md \
  .noos/agent-registry.json \
  .noos/skills

tar \
  --exclude=".DS_Store" \
  --exclude="apps/noos-hub/node_modules" \
  --exclude="apps/noos-hub/dist" \
  --exclude="apps/noos-hub/src-tauri/target" \
  --exclude="apps/noos-hub/src-tauri/gen" \
  -czf "$HUB_PATH" \
  apps/noos-hub \
  scripts/noos-hub-launch.sh \
  scripts/noos-import-browser-vault.sh \
  scripts/noos-sync-handoffs-git.sh \
  scripts/noos-install.sh \
  scripts/noos-doctor.sh

printf '%s\n' "$SKILLS_PATH" "$HUB_PATH"
