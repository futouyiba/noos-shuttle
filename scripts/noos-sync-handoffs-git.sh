#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
LOCAL_VAULT="$NOOS_HOME/vault/handoffs/active"
PROJECT_ACTIVE="$ROOT_DIR/.noos/handoffs/active"

is_noos_handoff() {
  local file="$1"
  grep -q "<!-- NOOS:THREAD:BEGIN -->" "$file" && grep -q "<!-- NOOS:THREAD:END -->" "$file"
}

copy_handoffs() {
  local source_dir="$1"
  local target_dir="$2"
  local copied=0
  [[ -d "$source_dir" ]] || return 0

  while IFS= read -r -d '' file; do
    if is_noos_handoff "$file"; then
      cp "$file" "$target_dir/$(basename "$file")"
      copied=$((copied + 1))
    fi
  done < <(find "$source_dir" -maxdepth 1 -type f -name "*.md" -print0)

  printf "%s" "$copied"
}

mkdir -p "$LOCAL_VAULT" "$PROJECT_ACTIVE"

"$ROOT_DIR/scripts/noos-import-browser-vault.sh"
project_count="$(copy_handoffs "$LOCAL_VAULT" "$PROJECT_ACTIVE")"

echo "Copied $project_count handoff(s) from $LOCAL_VAULT to $PROJECT_ACTIVE"

cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git worktree; copied files locally only."
  exit 0
fi

git add .noos/handoffs/active

if git diff --cached --quiet -- .noos/handoffs/active; then
  echo "No handoff changes to sync."
  exit 0
fi

git commit -m "同步 NOOS handoff"
git push

echo "NOOS handoffs synced to Git."
