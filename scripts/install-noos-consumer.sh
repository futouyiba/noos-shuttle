#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAME="noos-consume-handoff"
SOURCE_DIR="$ROOT_DIR/.noos/skills/$SKILL_NAME"
USER_NOOS_DIR="$HOME/.noos"
USER_CONFIG="$USER_NOOS_DIR/config.json"
USER_CONFIG_EXAMPLE="$ROOT_DIR/.noos/config.example.json"
PROJECT_CONFIG="$ROOT_DIR/.noos/project.json"
LOCAL_EXAMPLE="$ROOT_DIR/.noos/local.json.example"

if [[ ! -f "$SOURCE_DIR/SKILL.md" ]]; then
  echo "Missing source skill: $SOURCE_DIR/SKILL.md" >&2
  exit 1
fi

install_skill() {
  local target_root="$1"
  local target_dir="$target_root/$SKILL_NAME"

  mkdir -p "$target_root"
  rm -rf "$target_dir"
  cp -R "$SOURCE_DIR" "$target_dir"
  echo "Installed $SKILL_NAME -> $target_dir"
}

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

install_skill "$CODEX_HOME/skills"
install_skill "$CLAUDE_HOME/skills"

mkdir -p "$ROOT_DIR/.claude/skills"
rm -rf "$ROOT_DIR/.claude/skills/$SKILL_NAME"
cp -R "$SOURCE_DIR" "$ROOT_DIR/.claude/skills/$SKILL_NAME"
echo "Installed project-local Claude skill -> $ROOT_DIR/.claude/skills/$SKILL_NAME"

mkdir -p "$USER_NOOS_DIR"
if [[ ! -f "$USER_CONFIG" ]]; then
  cp "$USER_CONFIG_EXAMPLE" "$USER_CONFIG"
  echo "Created user NOOS config -> $USER_CONFIG"
else
  echo "Kept existing user NOOS config -> $USER_CONFIG"
fi

if [[ ! -f "$PROJECT_CONFIG" ]]; then
  cat > "$PROJECT_CONFIG" <<'JSON'
{
  "schema_version": "0.1",
  "project": "unnamed-project",
  "handoff_dirs": {
    "active": ".noos/handoffs/active",
    "done": ".noos/handoffs/done"
  },
  "github": {
    "repo": null,
    "default_branch": "main",
    "handoff_path": ".noos/handoffs/active"
  }
}
JSON
  echo "Created project NOOS config -> $PROJECT_CONFIG"
else
  echo "Kept existing project NOOS config -> $PROJECT_CONFIG"
fi

if [[ ! -f "$LOCAL_EXAMPLE" ]]; then
  cat > "$LOCAL_EXAMPLE" <<'JSON'
{
  "schema_version": "0.1",
  "preferred_local_inbox": "~/NOOS/inbox",
  "last_consumed_handoff": null
}
JSON
  echo "Created local config example -> $LOCAL_EXAMPLE"
fi

echo
echo "Done."
echo "Codex skill: $CODEX_HOME/skills/$SKILL_NAME"
echo "Claude user skill: $CLAUDE_HOME/skills/$SKILL_NAME"
echo "Claude project skill: $ROOT_DIR/.claude/skills/$SKILL_NAME"
echo "User config: $USER_CONFIG"
echo "Project config: $PROJECT_CONFIG"
