#!/usr/bin/env bash
set -euo pipefail

NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
KIND="all"
WIKI_PROJECT=""
INCLUDE_TEMPORARY=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki
  scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki --kind crystal
  scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki --include-temporary
  scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki --dry-run

Projects durable NOOS Vault objects into an LLM Wiki project's raw source
folder:

  <wiki-project>/raw/sources/noos/{crystals,handoffs,results}/

LLM Wiki should then ingest those files through its normal source watcher or
manual ingest flow. NOOS does not write directly into <wiki-project>/wiki/.

Durability rules:
  - Crystals are durable by default unless marked temporary.
  - Handoffs and Results are temporary by default unless marked durable.
  - --include-temporary projects every matching object.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wiki-project)
      WIKI_PROJECT="${2:-}"
      shift 2
      ;;
    --kind)
      KIND="${2:-}"
      shift 2
      ;;
    --include-temporary)
      INCLUDE_TEMPORARY=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$WIKI_PROJECT" || ! "$KIND" =~ ^(all|crystal|handoff|result)$ ]]; then
  usage >&2
  exit 1
fi

WIKI_PROJECT="${WIKI_PROJECT/#\~/$HOME}"
if [[ ! -d "$WIKI_PROJECT" ]]; then
  echo "LLM Wiki project does not exist: $WIKI_PROJECT" >&2
  exit 2
fi
WIKI_PROJECT="$(cd "$WIKI_PROJECT" && pwd)"
RAW_NOOS_DIR="$WIKI_PROJECT/raw/sources/noos"

is_temporary_marker() {
  local file="$1"
  grep -Eiq '^(permanence|persistence|lifecycle|retention|noos_lifecycle):[[:space:]]*(temporary|transient|ephemeral|scratch|discard)' "$file" \
    || grep -Eiq '^(noos_wiki|wiki):[[:space:]]*false' "$file"
}

is_durable_marker() {
  local file="$1"
  grep -Eiq '^(permanence|persistence|lifecycle|retention|noos_lifecycle):[[:space:]]*(permanent|durable|long[-_ ]?term|curated|wiki)' "$file" \
    || grep -Eiq '^(noos_wiki|wiki):[[:space:]]*true' "$file" \
    || grep -Eiq '^curation_status:[[:space:]]*(curated|permanent|accepted)' "$file" \
    || grep -Eiq '^tags:.*\b(wiki|long-term|durable|permanent)\b' "$file"
}

should_project() {
  local kind="$1"
  local file="$2"

  if [[ "$INCLUDE_TEMPORARY" -eq 1 ]]; then
    return 0
  fi

  if is_temporary_marker "$file"; then
    return 1
  fi

  case "$kind" in
    crystal)
      return 0
      ;;
    handoff|result)
      is_durable_marker "$file"
      ;;
    *)
      return 1
      ;;
  esac
}

extract_field() {
  local file="$1"
  local key="$2"
  awk -F': *' -v k="$key" '
    $1 == k {
      value = substr($0, index($0, ":") + 1)
      gsub(/^[ \t"'\''"]+|[ \t"'\''"]+$/, "", value)
      print value
      exit
    }
  ' "$file"
}

lookup_key_for() {
  local file="$1"
  local key
  for field in lookup_key crystal_key handoff_key result_key key; do
    key="$(extract_field "$file" "$field")"
    if [[ -n "$key" ]]; then
      printf "%s\n" "$key"
      return
    fi
  done
  basename "$file" .md
}

title_for() {
  local file="$1"
  local title
  title="$(extract_field "$file" "title")"
  if [[ -n "$title" ]]; then
    printf "%s\n" "$title"
    return
  fi
  awk '/^# / { sub(/^# +/, ""); print; exit }' "$file"
}

yaml_double_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

project_one() {
  local kind="$1"
  local file="$2"
  local plural="$3"

  if ! should_project "$kind" "$file"; then
    echo "Skipped $kind temporary/undecided: $file"
    return
  fi

  local target_dir="$RAW_NOOS_DIR/$plural"
  local lookup_key title target tmp now source_path quoted_title quoted_key quoted_path quoted_now
  lookup_key="$(lookup_key_for "$file")"
  title="$(title_for "$file")"
  [[ -n "$title" ]] || title="$lookup_key"
  target="$target_dir/$(basename "$file")"
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  source_path="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
  quoted_title="$(yaml_double_quote "$title")"
  quoted_key="$(yaml_double_quote "$lookup_key")"
  quoted_path="$(yaml_double_quote "$source_path")"
  quoted_now="$(yaml_double_quote "$now")"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Would project $kind: $source_path -> $target"
    return
  fi

  mkdir -p "$target_dir"
  tmp="$(mktemp)"
  {
    cat <<EOF
---
type: noos_llm_wiki_source
version: 0.1
title: $quoted_title
noos_object_type: $kind
noos_lookup_key: $quoted_key
noos_source_path: $quoted_path
noos_bridge_version: 0.1
projected_at: $quoted_now
tags: [noos, $kind]
---

# $title

This file is a NOOS object projected for LLM Wiki ingest.

- NOOS object type: $kind
- NOOS lookup key: $lookup_key
- Original NOOS file: $source_path

The original object content follows.

---

EOF
    cat "$file"
  } > "$tmp"

  if [[ -f "$target" ]] && cmp -s "$tmp" "$target"; then
    rm -f "$tmp"
    echo "Unchanged $kind: $target"
    return
  fi

  mv "$tmp" "$target"
  echo "Projected $kind: $target"
}

scan_kind() {
  local kind="$1"
  local plural="$2"
  shift 2
  local dir file

  for dir in "$@"; do
    [[ -d "$dir" ]] || continue
    while IFS= read -r -d '' file; do
      project_one "$kind" "$file" "$plural"
    done < <(find "$dir" -maxdepth 1 -type f -name "*.md" -print0)
  done
}

if [[ "$KIND" == "all" || "$KIND" == "crystal" ]]; then
  scan_kind crystal crystals \
    "$NOOS_HOME/vault/crystals/active" \
    "$NOOS_HOME/vault/crystals/curated"
fi

if [[ "$KIND" == "all" || "$KIND" == "handoff" ]]; then
  scan_kind handoff handoffs \
    "$NOOS_HOME/vault/handoffs/active" \
    "$NOOS_HOME/vault/handoffs/done"
fi

if [[ "$KIND" == "all" || "$KIND" == "result" ]]; then
  scan_kind result results \
    "$NOOS_HOME/vault/results/accepted"
fi

echo "LLM Wiki source bridge: $RAW_NOOS_DIR"
echo "Next: open LLM Wiki and ingest or enable source folder auto-watch."
