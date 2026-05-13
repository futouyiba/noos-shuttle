#!/usr/bin/env bash
set -euo pipefail

NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
LOCAL_VAULT="$NOOS_HOME/vault/handoffs/active"
BROWSER_VAULT="$HOME/Downloads/NOOS/vault/handoffs/active"

is_noos_handoff() {
  local file="$1"
  grep -q "<!-- NOOS:THREAD:BEGIN -->" "$file" && grep -q "<!-- NOOS:THREAD:END -->" "$file"
}

copy_handoffs() {
  local copied=0
  local skipped=0

  mkdir -p "$LOCAL_VAULT" "$BROWSER_VAULT"

  while IFS= read -r -d '' file; do
    if is_noos_handoff "$file"; then
      cp "$file" "$LOCAL_VAULT/$(basename "$file")"
      copied=$((copied + 1))
    else
      skipped=$((skipped + 1))
    fi
  done < <(find "$BROWSER_VAULT" -maxdepth 1 -type f -name "*.md" -print0)

  echo "Browser vault mirror: $BROWSER_VAULT"
  echo "NOOS local handoff vault: $LOCAL_VAULT"
  echo "Imported $copied handoff(s)."
  if [[ "$skipped" -gt 0 ]]; then
    echo "Skipped $skipped markdown file(s) without NOOS thread markers."
  fi
}

copy_handoffs
