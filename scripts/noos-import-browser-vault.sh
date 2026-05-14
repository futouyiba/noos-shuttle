#!/usr/bin/env bash
set -euo pipefail

NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"

has_markers() {
  local file="$1"
  local begin="$2"
  local end="$3"
  grep -Fq "$begin" "$file" && grep -Fq "$end" "$file"
}

copy_artifacts() {
  local label="$1"
  local source_dir="$2"
  local target_dir="$3"
  local begin_marker="$4"
  local end_marker="$5"
  local copied=0
  local skipped=0

  mkdir -p "$target_dir" "$source_dir"

  while IFS= read -r -d '' file; do
    if has_markers "$file" "$begin_marker" "$end_marker"; then
      cp "$file" "$target_dir/$(basename "$file")"
      copied=$((copied + 1))
    else
      skipped=$((skipped + 1))
    fi
  done < <(find "$source_dir" -maxdepth 1 -type f -name "*.md" -print0)

  echo "$label browser mirror: $source_dir"
  echo "$label local vault: $target_dir"
  echo "Imported $copied $label file(s)."
  if [[ "$skipped" -gt 0 ]]; then
    echo "Skipped $skipped markdown file(s) without expected NOOS markers."
  fi
}

copy_artifacts \
  "Handoff" \
  "$HOME/Downloads/NOOS/vault/handoffs/active" \
  "$NOOS_HOME/vault/handoffs/active" \
  "<!-- NOOS:THREAD:BEGIN -->" \
  "<!-- NOOS:THREAD:END -->"

copy_artifacts \
  "Crystal" \
  "$HOME/Downloads/NOOS/vault/crystals/active" \
  "$NOOS_HOME/vault/crystals/active" \
  "<!-- NOOS:CRYSTAL:BEGIN -->" \
  "<!-- NOOS:CRYSTAL:END -->"
