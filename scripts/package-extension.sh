#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
PACKAGE_DIR="$ROOT_DIR/release"
PACKAGE_PATH="$PACKAGE_DIR/noos-shuttle-extension-$VERSION.zip"

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required to package the browser extension." >&2
  exit 1
fi

cd "$ROOT_DIR"
npm run build
mkdir -p "$PACKAGE_DIR"
rm -f "$PACKAGE_PATH"

(
  cd "$ROOT_DIR/dist"
  zip -qr "$PACKAGE_PATH" .
)

echo "$PACKAGE_PATH"
