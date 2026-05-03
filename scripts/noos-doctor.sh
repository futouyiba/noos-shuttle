#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
SKILL_NAME="noos-consume-handoff"

ok() {
  printf "ok      %s\n" "$1"
}

warn() {
  printf "warn    %s\n" "$1"
}

missing() {
  printf "missing %s\n" "$1"
}

check_file() {
  local path="$1"
  local label="$2"
  if [[ -f "$path" ]]; then
    ok "$label: $path"
  else
    missing "$label: $path"
  fi
}

check_dir() {
  local path="$1"
  local label="$2"
  if [[ -d "$path" ]]; then
    ok "$label: $path"
  else
    missing "$label: $path"
  fi
}

echo "NOOS Doctor"
echo

check_dir "$NOOS_HOME" "NOOS home"
check_dir "$NOOS_HOME/inbox" "NOOS inbox"
check_file "$NOOS_HOME/config.json" "User config"

echo
check_dir "$ROOT_DIR/.noos" "Project .noos"
check_file "$ROOT_DIR/.noos/project.json" "Project config"
check_dir "$ROOT_DIR/.noos/handoffs/active" "Active handoffs"
check_dir "$ROOT_DIR/.noos/handoffs/done" "Done handoffs"
check_file "$ROOT_DIR/AGENTS.md" "Codex entry"
check_file "$ROOT_DIR/CLAUDE.md" "Claude Code entry"

echo
check_file "$CODEX_HOME/skills/$SKILL_NAME/SKILL.md" "Codex user skill"
check_file "$CLAUDE_HOME/skills/$SKILL_NAME/SKILL.md" "Claude Code user skill"
check_file "$ROOT_DIR/.claude/skills/$SKILL_NAME/SKILL.md" "Claude project skill"

echo
if command -v node >/dev/null 2>&1; then
  ok "Node: $(node --version)"
else
  missing "Node"
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm: $(npm --version)"
else
  missing "npm"
fi

if [[ -f "$ROOT_DIR/dist/manifest.json" ]]; then
  ok "Browser extension build: $ROOT_DIR/dist"
else
  warn "Browser extension build missing. Run npm run build."
fi

if [[ -d "$NOOS_HOME/chrome-profile" ]]; then
  ok "NOOS Chrome profile: $NOOS_HOME/chrome-profile"
else
  warn "NOOS Chrome profile not created yet. Run scripts/noos-install.sh browser --mode dev-profile."
fi

echo
if command -v gh >/dev/null 2>&1; then
  ok "GitHub CLI: $(gh --version | head -1)"
  if gh auth status >/dev/null 2>&1; then
    ok "GitHub auth: authenticated"
  else
    warn "GitHub auth: run gh auth login if you want GitHub handoff delivery"
  fi
else
  warn "GitHub CLI missing. Install gh for GitHub handoff delivery."
fi
