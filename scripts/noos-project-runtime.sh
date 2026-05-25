#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUERY="${1:-}"
TASK_KEY="${2:-}"
RUNTIME_ROOT="$ROOT_DIR/.noos/runtime"
TASKS_DIR="$RUNTIME_ROOT/tasks"
CURRENT_DIR="$RUNTIME_ROOT/current"
CURRENT_JSON="$RUNTIME_ROOT/current.json"

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/noos-project-runtime.sh <key-or-path> [task-key]

Creates a coding-agent runtime projection under:
  .noos/runtime/tasks/<task-key>/

It also writes .noos/runtime/current.json and refreshes .noos/runtime/current/
as a compatibility mirror for agents that expect a stable current path.
EOF
}

if [[ -z "$QUERY" || "$QUERY" == "-h" || "$QUERY" == "--help" ]]; then
  usage
  exit $([[ -z "$QUERY" ]] && echo 1 || echo 0)
fi

if [[ -f "$QUERY" ]]; then
  source_path="$QUERY"
else
  source_path="$("$ROOT_DIR/scripts/noos-open.sh" "$QUERY" | head -n 1)"
fi

if [[ -z "${source_path:-}" || ! -f "$source_path" ]]; then
  echo "No readable NOOS source found for: $QUERY" >&2
  exit 2
fi

source_name="$(basename "$source_path")"
if [[ -z "$TASK_KEY" ]]; then
  TASK_KEY="$(basename "$source_name" .md)"
fi
TASK_KEY="$(printf "%s" "$TASK_KEY" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
if [[ -z "$TASK_KEY" ]]; then
  TASK_KEY="$(date +%Y%m%d)-noos-task"
fi

TASK_DIR="$TASKS_DIR/$TASK_KEY"
rm -rf "$TASK_DIR" "$CURRENT_DIR"
mkdir -p \
  "$TASK_DIR/sources" \
  "$TASK_DIR/sources/wiki" \
  "$TASK_DIR/sources/crystals" \
  "$TASK_DIR/sources/briefs" \
  "$TASK_DIR/sources/skills" \
  "$TASK_DIR/artifacts" \
  "$TASK_DIR/output"

cp "$source_path" "$TASK_DIR/sources/$source_name"

if grep -q "NOOS:THREAD:BEGIN" "$source_path"; then
  cp "$source_path" "$TASK_DIR/TASK.md"
  context_note="TASK.md contains the handoff. Treat it as the primary task source."
else
  cat > "$TASK_DIR/TASK.md" <<EOF
# TASK

## Intent

Use the projected NOOS context in this directory to continue the current task.

## Source

- key or path: $QUERY
- projected source: sources/$source_name
EOF
  cp "$source_path" "$TASK_DIR/CONTEXT_PACK.md"
  context_note="CONTEXT_PACK.md contains the selected context. Use it as background, not as permission to edit unrelated files."
fi

if [[ ! -f "$TASK_DIR/CONTEXT_PACK.md" ]]; then
  cat > "$TASK_DIR/CONTEXT_PACK.md" <<EOF
# Context Pack

## Summary

This projection was created from a NOOS task object.

## Key Context

### 1. Source Object

Source:
- path: sources/$source_name

Content:
Read TASK.md and the copied source object for the canonical task details.

Relevance:
This is the primary context for the current coding-agent run.
EOF
fi

cat > "$TASK_DIR/READ_ME_FIRST.md" <<EOF
# READ ME FIRST

You are processing a NOOS runtime projection.

Follow this order:

1. Read TASK.md.
2. Read CONTEXT_PACK.md.
3. Inspect FILE_MAP.md.
4. If more background is needed, read only files under sources/.
5. Do not read unprojected files from the user's NOOS Vault.
6. Before editing code, produce a concise implementation plan.
7. After finishing, write RESULT_SUMMARY.md.

## Current Task Key

$TASK_KEY

## Allowed Read Scope

- The current repository.
- .noos/runtime/tasks/$TASK_KEY/
- Paths explicitly listed in FILE_MAP.md.

## Forbidden

- Do not scan the full NOOS Vault.
- Do not read private, secrets, or credentials files.
- Do not upload projected context to external services.

## Note

$context_note
EOF

cat > "$TASK_DIR/FILE_MAP.md" <<EOF
# File Map

## Must Read

1. TASK.md
2. CONTEXT_PACK.md
3. FILE_MAP.md

## Relevant Sources

- sources/$source_name
  - original: $source_path
  - reason: source object used to create this runtime projection

## Optional

- SOURCES.md
- GRAPH.md
- GRAPH.json
EOF

cat > "$TASK_DIR/SOURCES.md" <<EOF
# Sources

| Path | Original |
| --- | --- |
| sources/$source_name | $source_path |
EOF

cat > "$TASK_DIR/GRAPH.md" <<EOF
# Graph

- $TASK_KEY uses sources/$source_name as primary projected context.
EOF

cat > "$TASK_DIR/GRAPH.json" <<EOF
{
  "task_key": "$TASK_KEY",
  "nodes": [
    {
      "key": "$TASK_KEY",
      "type": "runtime_projection",
      "title": "NOOS Runtime Projection",
      "path": ".noos/runtime/tasks/$TASK_KEY"
    },
    {
      "key": "$(basename "$source_name" .md)",
      "type": "source",
      "title": "$source_name",
      "path": "sources/$source_name"
    }
  ],
  "edges": [
    {
      "from": "$(basename "$source_name" .md)",
      "to": "$TASK_KEY",
      "relation": "background_for"
    }
  ]
}
EOF

cat > "$TASK_DIR/READ_LOG.md" <<'EOF'
# Read Log

## Files Read

## Key Conclusions

## Missing Context
EOF

cat > "$TASK_DIR/RESULT_SUMMARY.md" <<EOF
# Result Summary

## Task Key

$TASK_KEY

## What Changed

## Files Modified

## Tests / Checks

## Remaining Issues

## Suggested Next Steps
EOF

mkdir -p "$RUNTIME_ROOT"
cat > "$CURRENT_JSON" <<EOF
{
  "task_key": "$TASK_KEY",
  "task_path": ".noos/runtime/tasks/$TASK_KEY",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

mkdir -p "$CURRENT_DIR"
cp -R "$TASK_DIR"/. "$CURRENT_DIR"/

echo "NOOS runtime projection created: $TASK_DIR"
echo "Current projection metadata: $CURRENT_JSON"
