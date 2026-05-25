#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
KIND="all"
QUERY=""

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/noos-find-artifact.sh <query>
  scripts/noos-find-artifact.sh --kind handoff <query>
  scripts/noos-find-artifact.sh --kind crystal <query>
  scripts/noos-find-artifact.sh --kind result <query>

Searches local NOOS Vault, project .noos folders, and Browser Vault Mirror by
filename, title, key, source_url, or body text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind)
      KIND="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      QUERY="$1"
      shift
      ;;
  esac
done

if [[ -z "$QUERY" || ! "$KIND" =~ ^(all|handoff|crystal|result)$ ]]; then
  usage
  exit 1
fi

search_dirs=()
if [[ "$KIND" == "all" || "$KIND" == "handoff" ]]; then
  search_dirs+=(
    "$NOOS_HOME/vault/handoffs/active"
    "$ROOT_DIR/.noos/handoffs/active"
    "$HOME/Downloads/NOOS/vault/handoffs/active"
  )
fi
if [[ "$KIND" == "all" || "$KIND" == "crystal" ]]; then
  search_dirs+=(
    "$NOOS_HOME/vault/crystals/active"
    "$ROOT_DIR/.noos/crystals/active"
    "$HOME/Downloads/NOOS/vault/crystals/active"
  )
fi
if [[ "$KIND" == "all" || "$KIND" == "result" ]]; then
  search_dirs+=(
    "$NOOS_HOME/vault/results/inbox"
    "$NOOS_HOME/vault/results/accepted"
    "$NOOS_HOME/vault/results/archived"
  )
fi

found=0
for dir in "${search_dirs[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' file; do
    if [[ "$(basename "$file")" == *"$QUERY"* ]] || grep -Fqi -- "$QUERY" "$file"; then
      printf "%s\n" "$file"
      found=1
    fi
  done < <(find "$dir" -maxdepth 1 -type f -name "*.md" -print0)
done

if [[ "$found" -eq 0 ]]; then
  echo "No NOOS artifact found for: $QUERY" >&2
  exit 2
fi
