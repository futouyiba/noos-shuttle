#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
QUERY="${1:-}"

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/noos-open.sh <key-or-text>

Prints the best matching NOOS Vault object path. It checks the local Vault
index first, then falls back to handoff/crystal/result directories and the
Browser Vault Mirror.
EOF
}

if [[ -z "$QUERY" || "$QUERY" == "-h" || "$QUERY" == "--help" ]]; then
  usage
  exit $([[ -z "$QUERY" ]] && echo 1 || echo 0)
fi

if command -v node >/dev/null 2>&1; then
  indexed_path="$(
    NOOS_HOME="$NOOS_HOME" QUERY="$QUERY" node <<'NODE'
const fs = require("fs");
const path = require("path");
const noosHome = process.env.NOOS_HOME;
const query = process.env.QUERY;
const keysPath = path.join(noosHome, "vault/index/keys.json");
const objectsPath = path.join(noosHome, "vault/index/objects.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const keys = readJson(keysPath);
if (keys[query]?.path) {
  console.log(keys[query].path);
  process.exit(0);
}

const objects = readJson(objectsPath);
const match = Object.values(objects).find((item) => {
  if (!item || typeof item !== "object") return false;
  return [item.lookup_key, item.key, item.title, item.source_url, item.path]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query.toLowerCase()));
});
if (match?.path) {
  console.log(match.path);
}
NODE
  )"
  if [[ -n "$indexed_path" && -f "$indexed_path" ]]; then
    printf "%s\n" "$indexed_path"
    exit 0
  fi
fi

if "$ROOT_DIR/scripts/noos-find-artifact.sh" --kind all "$QUERY"; then
  exit 0
fi

echo "No NOOS object found for: $QUERY" >&2
exit 2
