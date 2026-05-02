#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAME="noos-consume-handoff"
SOURCE_DIR="$ROOT_DIR/.noos/skills/$SKILL_NAME"

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

echo
echo "Done."
echo "Codex skill: $CODEX_HOME/skills/$SKILL_NAME"
echo "Claude user skill: $CLAUDE_HOME/skills/$SKILL_NAME"
echo "Claude project skill: $ROOT_DIR/.claude/skills/$SKILL_NAME"
