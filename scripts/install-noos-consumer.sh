#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAMES=("noos-consume-handoff" "noos-transfer-handoff" "noos-hub-launcher")
USER_NOOS_DIR="$HOME/.noos"
USER_CONFIG="$USER_NOOS_DIR/config.json"
USER_CONFIG_EXAMPLE="$ROOT_DIR/.noos/config.example.json"
PROJECT_CONFIG="$ROOT_DIR/.noos/project.json"
LOCAL_EXAMPLE="$ROOT_DIR/.noos/local.json.example"

for skill_name in "${SKILL_NAMES[@]}"; do
  if [[ ! -f "$ROOT_DIR/.noos/skills/$skill_name/SKILL.md" ]]; then
    echo "Missing source skill: $ROOT_DIR/.noos/skills/$skill_name/SKILL.md" >&2
    exit 1
  fi
done

install_skill() {
  local target_root="$1"
  local skill_name="$2"
  local source_dir="$ROOT_DIR/.noos/skills/$skill_name"
  local target_dir="$target_root/$skill_name"

  mkdir -p "$target_root"
  rm -rf "$target_dir"
  cp -R "$source_dir" "$target_dir"
  echo "Installed $skill_name -> $target_dir"
}

install_all_skills() {
  local target_root="$1"
  local skill_name

  for skill_name in "${SKILL_NAMES[@]}"; do
    install_skill "$target_root" "$skill_name"
  done
}

install_project_claude_skill() {
  local skill_name="$1"
  local source_dir="$ROOT_DIR/.noos/skills/$skill_name"
  local target_dir="$ROOT_DIR/.claude/skills/$skill_name"

  mkdir -p "$ROOT_DIR/.claude/skills"
  rm -rf "$target_dir"
  cp -R "$source_dir" "$target_dir"
  echo "Installed project-local Claude skill -> $target_dir"
}

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

install_all_skills "$CODEX_HOME/skills"
install_all_skills "$CLAUDE_HOME/skills"

for skill_name in "${SKILL_NAMES[@]}"; do
  install_project_claude_skill "$skill_name"
done

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
echo "Codex skills: ${SKILL_NAMES[*]}"
echo "Codex skill root: $CODEX_HOME/skills"
echo "Claude user skill root: $CLAUDE_HOME/skills"
echo "Claude project skill root: $ROOT_DIR/.claude/skills"
echo "User config: $USER_CONFIG"
echo "Project config: $PROJECT_CONFIG"
