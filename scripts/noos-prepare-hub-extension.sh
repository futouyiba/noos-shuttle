#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCE_DIR="$ROOT_DIR/apps/noos-hub/src-tauri/resources/noos-shuttle-extension"
NODE_ROOT_DIR="$ROOT_DIR"
if command -v cygpath >/dev/null 2>&1; then
  NODE_ROOT_DIR="$(cygpath -w "$ROOT_DIR")"
fi
VERSION="$(node -p "require(process.argv[1]).version" "$NODE_ROOT_DIR/package.json")"

cd "$ROOT_DIR"
npm run build

rm -rf "$RESOURCE_DIR"
mkdir -p "$RESOURCE_DIR"
cp -R "$ROOT_DIR/dist/." "$RESOURCE_DIR/"
printf '%s\n' "$VERSION" > "$RESOURCE_DIR/.noos-shuttle-version"

echo "$RESOURCE_DIR"
