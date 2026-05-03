#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"

usage() {
  cat <<'EOF'
Usage:
  scripts/noos-install.sh all
  scripts/noos-install.sh workspace
  scripts/noos-install.sh consumers
  scripts/noos-install.sh browser --mode dev-profile
  scripts/noos-install.sh browser --mode manual-unpacked
  scripts/noos-install.sh inbox
  scripts/noos-install.sh doctor

Browser modes:
  dev-profile       Launch a dedicated Chrome profile with the local extension loaded.
  manual-unpacked   Build extension, open chrome://extensions, and reveal dist/.
EOF
}

ensure_noos_home() {
  mkdir -p "$NOOS_HOME/inbox" "$NOOS_HOME/outbox" "$NOOS_HOME/logs" "$NOOS_HOME/cache"
  if [[ ! -f "$NOOS_HOME/config.json" ]]; then
    cp "$ROOT_DIR/.noos/config.example.json" "$NOOS_HOME/config.json"
    echo "Created $NOOS_HOME/config.json"
  else
    echo "Kept $NOOS_HOME/config.json"
  fi
}

install_workspace() {
  mkdir -p \
    "$ROOT_DIR/.noos/handoffs/active" \
    "$ROOT_DIR/.noos/handoffs/done" \
    "$ROOT_DIR/.noos/context/briefs"

  echo "Workspace kit ready in $ROOT_DIR/.noos"
}

install_consumers() {
  "$ROOT_DIR/scripts/install-noos-consumer.sh"
}

build_extension() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to build the browser extension." >&2
    exit 1
  fi
  (cd "$ROOT_DIR" && npm install --no-audit --no-fund && npm run build)
}

chrome_app() {
  local candidates=(
    "/Applications/Google Chrome.app"
    "/Applications/Google Chrome for Testing.app"
    "$HOME/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -d "$candidate" ]]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done

  return 1
}

install_browser_dev_profile() {
  build_extension

  local app
  if ! app="$(chrome_app)"; then
    echo "Chrome app was not found. Install Chrome or use manual-unpacked mode." >&2
    exit 1
  fi

  mkdir -p "$NOOS_HOME/chrome-profile"
  echo "Launching NOOS Shuttle browser profile..."
  open -na "$app" --args \
    "--user-data-dir=$NOOS_HOME/chrome-profile" \
    "--disable-extensions-except=$ROOT_DIR/dist" \
    "--load-extension=$ROOT_DIR/dist" \
    --no-first-run \
    --no-default-browser-check \
    https://chatgpt.com/
}

install_browser_manual_unpacked() {
  build_extension

  local app
  if app="$(chrome_app)"; then
    open -na "$app" --args chrome://extensions/ || true
  else
    echo "Chrome app was not found; open chrome://extensions manually."
  fi

  open "$ROOT_DIR/dist"
  cat <<EOF

Manual Chrome install:
1. Enable Developer Mode in chrome://extensions.
2. Click "Load unpacked".
3. Select:
   $ROOT_DIR/dist
4. Open https://chatgpt.com/ and look for the NS button.

Chrome requires this user action for unpacked extensions in a regular profile.
EOF
}

install_browser() {
  local mode="dev-profile"
  shift || true

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode)
        mode="${2:-}"
        shift 2
        ;;
      *)
        echo "Unknown browser option: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  case "$mode" in
    dev-profile)
      install_browser_dev_profile
      ;;
    manual-unpacked)
      install_browser_manual_unpacked
      ;;
    *)
      echo "Unknown browser mode: $mode" >&2
      exit 1
      ;;
  esac
}

command="${1:-}"
if [[ -z "$command" ]]; then
  usage
  exit 1
fi
shift || true

case "$command" in
  all)
    ensure_noos_home
    install_workspace
    install_consumers
    install_browser dev-profile
    "$ROOT_DIR/scripts/noos-doctor.sh"
    ;;
  workspace)
    ensure_noos_home
    install_workspace
    ;;
  consumers)
    ensure_noos_home
    install_consumers
    ;;
  inbox)
    ensure_noos_home
    echo "NOOS inbox: $NOOS_HOME/inbox"
    ;;
  browser)
    ensure_noos_home
    install_browser "$@"
    ;;
  doctor)
    "$ROOT_DIR/scripts/noos-doctor.sh"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
