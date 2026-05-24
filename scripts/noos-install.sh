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
  scripts/noos-install.sh browser dev-profile
  scripts/noos-install.sh browser manual-unpacked
  scripts/noos-install.sh inbox
  scripts/noos-install.sh vault
  scripts/noos-install.sh doctor

Browser modes:
  dev-profile       Launch a dedicated Chrome profile with the local extension loaded.
  manual-unpacked   Build extension, open chrome://extensions, and reveal dist/.
EOF
}

ensure_noos_home() {
  mkdir -p \
    "$NOOS_HOME/inbox" \
    "$NOOS_HOME/outbox" \
    "$NOOS_HOME/logs" \
    "$NOOS_HOME/cache" \
    "$NOOS_HOME/vault/wiki" \
    "$NOOS_HOME/vault/handoffs/active" \
    "$NOOS_HOME/vault/handoffs/done" \
    "$NOOS_HOME/vault/handoffs/archived" \
    "$NOOS_HOME/vault/crystals/active" \
    "$NOOS_HOME/vault/crystals/curated" \
    "$NOOS_HOME/vault/crystals/archived" \
    "$NOOS_HOME/vault/results/inbox" \
    "$NOOS_HOME/vault/results/accepted" \
    "$NOOS_HOME/vault/results/archived" \
    "$NOOS_HOME/vault/artifacts/files" \
    "$NOOS_HOME/vault/artifacts/sidecars" \
    "$NOOS_HOME/vault/artifacts/thumbs" \
    "$NOOS_HOME/vault/briefs/active" \
    "$NOOS_HOME/vault/briefs/archived" \
    "$NOOS_HOME/vault/packs/context/active" \
    "$NOOS_HOME/vault/packs/context/archived" \
    "$NOOS_HOME/vault/packs/prompt/active" \
    "$NOOS_HOME/vault/packs/prompt/sent" \
    "$NOOS_HOME/vault/packs/prompt/archived" \
    "$NOOS_HOME/vault/threads/active" \
    "$NOOS_HOME/vault/threads/archived" \
    "$NOOS_HOME/vault/runtime/projections/current" \
    "$NOOS_HOME/vault/runtime/projections/history" \
    "$NOOS_HOME/vault/index" \
    "$NOOS_HOME/vault/inbox" \
    "$NOOS_HOME/vault/outbox" \
    "$NOOS_HOME/vault/tmp" \
    "$NOOS_HOME/vault/logs" \
    "$NOOS_HOME/vault/references/raw" \
    "$NOOS_HOME/vault/references/briefs" \
    "$NOOS_HOME/vault/references/patterns" \
    "$NOOS_HOME/vault/references/anti-patterns" \
    "$NOOS_HOME/vault/references/flows" \
    "$NOOS_HOME/vault/references/assets" \
    "$NOOS_HOME/vault/skills/installed" \
    "$NOOS_HOME/vault/skills/local" \
    "$NOOS_HOME/vault/skills/archived" \
    "$NOOS_HOME/vault/sync/git" \
    "$NOOS_HOME/vault/sync/exports" \
    "$NOOS_HOME/vault/sync/imports" \
    "$NOOS_HOME/vault/policies" \
    "$HOME/Downloads/NOOS/vault/handoffs/active" \
    "$HOME/Downloads/NOOS/vault/crystals/active"
  for index_file in keys objects backlinks; do
    if [[ ! -f "$NOOS_HOME/vault/index/$index_file.json" ]]; then
      printf '{}\n' > "$NOOS_HOME/vault/index/$index_file.json"
    fi
  done
  if [[ ! -f "$NOOS_HOME/vault/index/graph.json" ]]; then
    printf '{ "edges": [] }\n' > "$NOOS_HOME/vault/index/graph.json"
  fi
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
    "$ROOT_DIR/.noos/crystals/active" \
    "$ROOT_DIR/.noos/crystals/done" \
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

chrome_app_name() {
  local app_path="$1"
  basename "$app_path" .app
}

open_chrome_url() {
  local app_path="$1"
  local url="$2"
  local app_name
  app_name="$(chrome_app_name "$app_path")"

  open -a "$app_path" || true
  sleep 1
  osascript <<OSA || open -a "$app_path" "$url" || true
tell application "$app_name"
  activate
  if (count of windows) = 0 then
    make new window
  end if
  set URL of active tab of front window to "$url"
end tell
OSA
}

open_chrome_manual_install_tabs() {
  local app_path="$1"
  local guide_path="$2"
  local app_name
  local guide_url
  app_name="$(chrome_app_name "$app_path")"
  guide_url="file://$guide_path"

  open -a "$app_path" || true
  sleep 1
  if ! osascript <<OSA
tell application "$app_name"
  activate
  if (count of windows) = 0 then
    make new window
  end if
  tell front window
    make new tab with properties {URL:"$guide_url"}
    make new tab with properties {URL:"chrome://extensions/"}
    set active tab index to (count of tabs)
  end tell
end tell
OSA
  then
    open -a "$app_path" "$guide_url" || true
    open_chrome_url "$app_path" "chrome://extensions/"
  fi
}

write_manual_install_guide() {
  local guide="$NOOS_HOME/cache/chrome-install-guide.html"
  mkdir -p "$(dirname "$guide")"
  cat > "$guide" <<EOF
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>NOOS Shuttle Chrome 安装向导</title>
    <style>
      body { margin: 0; background: #eef2ef; color: #17201a; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { max-width: 860px; margin: 48px auto; background: #fff; border: 1px solid rgba(23,32,26,.12); border-radius: 10px; padding: 32px; }
      h1 { margin: 0 0 12px; font-size: 30px; line-height: 1.15; }
      h2 { margin: 28px 0 8px; font-size: 18px; }
      code { display: block; margin: 10px 0; padding: 12px; background: #f4f7f5; border-radius: 8px; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
      li { margin: 10px 0; }
      .note { margin-top: 20px; padding: 14px; border-left: 4px solid #8b5a11; background: #fff8ec; }
    </style>
  </head>
  <body>
    <main>
      <h1>安装 NOOS Shuttle 到日常 Chrome</h1>
      <p>脚本已经构建扩展，并会打开 Chrome 的扩展管理页和 dist 文件夹。Chrome 安全策略要求你手动完成最后两步。</p>
      <h2>步骤</h2>
      <ol>
        <li>在 Chrome 地址栏确认当前页面是 <strong>chrome://extensions/</strong>。</li>
        <li>打开右上角 <strong>Developer mode / 开发者模式</strong>。</li>
        <li>点击 <strong>Load unpacked / 加载已解压的扩展程序</strong>。</li>
        <li>选择这个文件夹：</li>
      </ol>
      <code>$ROOT_DIR/dist</code>
      <div class="note">如果页面没有自动跳转，请手动在 Chrome 地址栏输入 <strong>chrome://extensions/</strong>。</div>
    </main>
  </body>
</html>
EOF
  printf "%s\n" "$guide"
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
  local guide
  guide="$(write_manual_install_guide)"

  local app
  if app="$(chrome_app)"; then
    open_chrome_manual_install_tabs "$app" "$guide"
  else
    echo "Chrome app was not found; open chrome://extensions manually."
    open "$guide"
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

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode)
        mode="${2:-}"
        shift 2
        ;;
      dev-profile|manual-unpacked)
        mode="$1"
        shift
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
    install_browser --mode dev-profile
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
  vault)
    ensure_noos_home
    echo "NOOS vault: $NOOS_HOME/vault"
    echo "Browser vault mirror: $HOME/Downloads/NOOS/vault"
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
