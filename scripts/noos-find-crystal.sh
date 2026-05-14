#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
QUERY="${1:-}"

if [[ -z "$QUERY" ]]; then
  echo "Usage: scripts/noos-find-crystal.sh <crystal-key-or-text>" >&2
  exit 1
fi

SEARCH_DIRS=(
  "$NOOS_HOME/vault/crystals/active"
  "$ROOT_DIR/.noos/crystals/active"
  "$HOME/Downloads/NOOS/vault/crystals/active"
)

found=0
for dir in "${SEARCH_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' file; do
    if grep -Fqi -- "$QUERY" "$file"; then
      printf "%s\n" "$file"
      found=1
    fi
  done < <(find "$dir" -maxdepth 1 -type f -name "*.md" -print0)
done

if [[ "$found" -eq 0 ]]; then
  echo "No NOOS crystal found for: $QUERY" >&2
  exit 2
fi
