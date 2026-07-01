#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCE_DIR="$ROOT_DIR/apps/noos-hub/src-tauri/resources/noos-shuttle-extension"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"

cd "$ROOT_DIR"
npm run build

rm -rf "$RESOURCE_DIR"
mkdir -p "$RESOURCE_DIR"
cp -R "$ROOT_DIR/dist/." "$RESOURCE_DIR/"
printf '%s\n' "$VERSION" > "$RESOURCE_DIR/.noos-shuttle-version"

echo "$RESOURCE_DIR"
