#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/noos-hub-launch.sh"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
RUN_DIR="$NOOS_HOME/run"
LOG_DIR="$NOOS_HOME/logs"
PID_FILE="$RUN_DIR/noos-hub.pid"
WATCHDOG_PID_FILE="$RUN_DIR/noos-hub-watchdog.pid"
WATCHDOG_PLIST="$RUN_DIR/com.noos.hub.watchdog.plist"
WATCHDOG_RUNNER="$RUN_DIR/noos-hub-watchdog-runner.sh"
WATCHDOG_LABEL="com.noos.hub.watchdog"
LOG_FILE="$LOG_DIR/noos-hub.log"
HUB_DIR="$ROOT_DIR/apps/noos-hub"
APP_PATH="$ROOT_DIR/apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app"
APP_BINARY="$APP_PATH/Contents/MacOS/noos-hub"
# The local write port is the single source of truth for "which Hub is
# serving"; kill/health/verify below all key off port ownership.
HUB_PORT="${NOOS_HUB_PORT:-17642}"
# The launcher owns the install location. Deploying = replacing this copy, so
# Spotlight/Dock always open the newest dogfood build.
INSTALL_APP="${NOOS_HUB_INSTALL_APP:-/Applications/NOOS Hub.app}"
HEALTH_URL="http://127.0.0.1:${HUB_PORT}/health"
WATCHDOG_INTERVAL_SECONDS="${NOOS_HUB_WATCHDOG_INTERVAL_SECONDS:-60}"
WATCHDOG_HIGH_CPU_PERCENT="${NOOS_HUB_WATCHDOG_HIGH_CPU_PERCENT:-80}"
WATCHDOG_FAILURE_LIMIT="${NOOS_HUB_WATCHDOG_FAILURE_LIMIT:-2}"

usage() {
  cat <<'EOF'
Usage: scripts/noos-hub-launch.sh [start|status|stop|restart|logs|watchdog]

Commands:
  start     Deploy: snapshot runtime state, stop any Hub owning the port,
            rebuild the bundle if stale, install it to the install path
            (/Applications/NOOS Hub.app by default), launch, verify the
            served build commit matches this checkout, then restart the
            watchdog.
  status    Show whether the background NOOS Hub process is running.
  stop      Stop the Hub that owns the local write port (any install
            location), not just instances started by this launcher.
  restart   Stop, then start NOOS Hub.
  logs      Print the NOOS Hub launcher log.
  watchdog  Internal command used by start. Monitors health and restarts Hub.

Environment overrides: NOOS_HUB_PORT (default 17642), NOOS_HUB_INSTALL_APP
(default /Applications/NOOS Hub.app), NOOS_HOME, NOOS_HUB_WATCHDOG_* .
EOF
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

find_hub_pid() {
  pgrep -f "$INSTALL_APP/Contents/MacOS/noos-hub|$APP_PATH/Contents/MacOS/noos-hub|$ROOT_DIR/apps/noos-hub/src-tauri/target/debug/noos-hub|$ROOT_DIR/apps/noos-hub/node_modules/.bin/tauri dev|target/debug/noos-hub" | head -n 1 || true
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

read_watchdog_pid() {
  if [[ -f "$WATCHDOG_PID_FILE" ]]; then
    tr -d '[:space:]' < "$WATCHDOG_PID_FILE"
  fi
}

watchdog_is_running() {
  local watchdog_pid
  watchdog_pid="$(read_watchdog_pid)"
  pid_is_running "$watchdog_pid"
}

clear_stale_watchdog_pid() {
  local watchdog_pid
  watchdog_pid="$(read_watchdog_pid)"
  if [[ -n "$watchdog_pid" ]] && ! pid_is_running "$watchdog_pid"; then
    rm -f "$WATCHDOG_PID_FILE"
  fi
}

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
}

hub_bundle_needs_rebuild() {
  if [[ ! -x "$APP_BINARY" ]]; then
    return 0
  fi

  local newer
  newer="$(find \
    "$HUB_DIR/src" \
    "$HUB_DIR/src-tauri/src" \
    "$HUB_DIR/src-tauri/Cargo.toml" \
    "$HUB_DIR/src-tauri/tauri.conf.json" \
    "$HUB_DIR/package.json" \
    "$ROOT_DIR/src" \
    "$ROOT_DIR/public" \
    "$ROOT_DIR/package.json" \
    "$ROOT_DIR/vite.config.ts" \
    -newer "$APP_BINARY" \
    -print \
    -quit)"
  [[ -n "$newer" ]]
}

launch_app() {
  echo "Opening NOOS Hub..." >&2
  open -na "$INSTALL_APP"
  local pid
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    pid="$(find_hub_pid)"
    if pid_is_running "$pid"; then
      echo "$pid"
      return 0
    fi
  done
  echo ""
}

hub_health_ok() {
  curl --max-time 3 -fsS "$HEALTH_URL" >/dev/null 2>&1
}

hub_cpu_percent() {
  local pid="${1:-}"
  if ! pid_is_running "$pid"; then
    echo "0"
    return 0
  fi
  ps -p "$pid" -o %cpu= 2>/dev/null | awk '{ printf "%.0f\n", $1 }' || echo "0"
}

any_pid_running() {
  local pid
  for pid in "$@"; do
    if pid_is_running "$pid"; then
      return 0
    fi
  done
  return 1
}

port_owner_pids() {
  lsof -nP -i "tcp:$HUB_PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

port_is_free() {
  [[ -z "$(port_owner_pids)" ]]
}

launchctl_cleanup() {
  command -v launchctl >/dev/null 2>&1 || return 0
  local label
  while IFS= read -r label; do
    [[ -n "$label" ]] || continue
    launchctl remove "$label" >/dev/null 2>&1 || true
  done < <(launchctl list 2>/dev/null | awk '/application\.app\.noos\.shuttle\.hub/ {print $NF}')
}

health_json() {
  curl --max-time 3 -fsS "$HEALTH_URL" 2>/dev/null || true
}

health_field() {
  local payload="$1" field="$2"
  [[ -n "$payload" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  python3 - "$payload" "$field" <<'PY'
import json, sys
try:
    value = json.loads(sys.argv[1]).get(sys.argv[2], "")
except Exception:
    sys.exit(1)
print(value)
PY
}

expected_build_commit() {
  git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true
}

wait_health() {
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if hub_health_ok; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Fail-closed deploy verification: a healthy old instance must never pass as a
# fresh deploy. The served build_commit must equal this checkout's HEAD and
# started_at must be recent.
verify_deploy() {
  local expected payload commit started now
  expected="$(expected_build_commit)"
  payload="$(health_json)"
  commit="$(health_field "$payload" build_commit || true)"
  started="$(health_field "$payload" started_at || true)"
  now="$(date +%s)"

  if [[ -z "$expected" ]]; then
    echo "Deploy verification FAILED: cannot resolve repo HEAD." >&2
    return 1
  fi
  if [[ "$commit" != "$expected" ]]; then
    echo "Deploy verification FAILED: served build_commit='${commit:-<none>}' != HEAD '${expected}'." >&2
    return 1
  fi
  if [[ -z "$started" ]] || (( now - started > 180 )); then
    echo "Deploy verification FAILED: started_at='${started:-<none>}' missing or stale (now=${now})." >&2
    return 1
  fi
  echo "Deploy verified: commit=${commit:0:12} version=$(health_field "$payload" version || echo "?") started_at=${started}"
  return 0
}

# Snapshot the small runtime state files (pairing token etc.) before a
# deploy replaces the Hub, rotating to the newest 20 snapshots.
snapshot_runtime_state() {
  local runtime_dir="$NOOS_HOME/runtime"
  local snapshot_dir="$runtime_dir/snapshots"
  [[ -d "$runtime_dir" ]] || return 0
  mkdir -p "$snapshot_dir"
  local file name old
  for file in "$runtime_dir"/*.json; do
    [[ -f "$file" ]] || continue
    name="$(basename "$file" .json)"
    cp "$file" "$snapshot_dir/${name}.$(date -u '+%Y%m%dT%H%M%SZ').snapshot.json"
  done
  ls -t "$snapshot_dir" 2>/dev/null | tail -n +21 | while IFS= read -r old; do
    rm -f "$snapshot_dir/$old"
  done
}

install_bundle() {
  if [[ ! -d "$APP_PATH" ]]; then
    echo "Hub bundle not found: $APP_PATH" >&2
    return 1
  fi
  mkdir -p "$(dirname "$INSTALL_APP")"
  rm -rf "$INSTALL_APP"
  ditto "$APP_PATH" "$INSTALL_APP"
}

start_watchdog() {
  local watchdog_pid
  watchdog_pid="$(read_watchdog_pid)"
  if pid_is_running "$watchdog_pid"; then
    return 0
  fi

  clear_stale_watchdog_pid

  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    local root_dir_q install_app_q health_url_q pid_file_q watchdog_pid_file_q log_file_q interval_q high_cpu_q failure_limit_q
    printf -v root_dir_q "%q" "$ROOT_DIR"
    printf -v install_app_q "%q" "$INSTALL_APP"
    printf -v health_url_q "%q" "$HEALTH_URL"
    printf -v pid_file_q "%q" "$PID_FILE"
    printf -v watchdog_pid_file_q "%q" "$WATCHDOG_PID_FILE"
    printf -v log_file_q "%q" "$LOG_FILE"
    printf -v interval_q "%q" "$WATCHDOG_INTERVAL_SECONDS"
    printf -v high_cpu_q "%q" "$WATCHDOG_HIGH_CPU_PERCENT"
    printf -v failure_limit_q "%q" "$WATCHDOG_FAILURE_LIMIT"

    cat > "$WATCHDOG_RUNNER" <<EOF
#!/usr/bin/env bash
set +e

ROOT_DIR=$root_dir_q
INSTALL_APP=$install_app_q
HEALTH_URL=$health_url_q
PID_FILE=$pid_file_q
WATCHDOG_PID_FILE=$watchdog_pid_file_q
LOG_FILE=$log_file_q
WATCHDOG_INTERVAL_SECONDS=$interval_q
WATCHDOG_HIGH_CPU_PERCENT=$high_cpu_q
WATCHDOG_FAILURE_LIMIT=$failure_limit_q

cd "\$ROOT_DIR" 2>/dev/null || cd /

pid_is_running() {
  local pid="\${1:-}"
  [[ -n "\$pid" ]] && kill -0 "\$pid" >/dev/null 2>&1
}

find_hub_pid() {
  pgrep -f "\$INSTALL_APP/Contents/MacOS/noos-hub|\$ROOT_DIR/apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app/Contents/MacOS/noos-hub|\$ROOT_DIR/apps/noos-hub/src-tauri/target/debug/noos-hub|\$ROOT_DIR/apps/noos-hub/node_modules/.bin/tauri dev|target/debug/noos-hub" | head -n 1 || true
}

read_pid() {
  if [[ -f "\$PID_FILE" ]]; then
    tr -d '[:space:]' < "\$PID_FILE"
  fi
}

launch_app() {
  echo "Opening NOOS Hub..." >&2
  open -na "\$INSTALL_APP"
  local pid
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    pid="\$(find_hub_pid)"
    if pid_is_running "\$pid"; then
      echo "\$pid"
      return 0
    fi
  done
  echo ""
}

hub_health_ok() {
  curl --max-time 3 -fsS "\$HEALTH_URL" >/dev/null 2>&1
}

hub_cpu_percent() {
  local pid="\${1:-}"
  if ! pid_is_running "\$pid"; then
    echo "0"
    return 0
  fi
  ps -p "\$pid" -o %cpu= 2>/dev/null | awk '{ printf "%.0f\n", \$1 }' || echo "0"
}

echo "\$\$" > "\$WATCHDOG_PID_FILE"
echo "NOOS Hub watchdog started at \$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

failure_count=0
while true; do
  pid="\$(read_pid)"
  if ! pid_is_running "\$pid"; then
    pid="\$(find_hub_pid)"
  fi

  if ! pid_is_running "\$pid"; then
    echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Hub missing; relaunching."
    pid="\$(launch_app)"
    if pid_is_running "\$pid"; then
      echo "\$pid" > "\$PID_FILE"
    fi
    failure_count=0
    sleep "\$WATCHDOG_INTERVAL_SECONDS"
    continue
  fi

  cpu="\$(hub_cpu_percent "\$pid")"
  if hub_health_ok && (( cpu < WATCHDOG_HIGH_CPU_PERCENT )); then
    failure_count=0
  else
    failure_count=\$((failure_count + 1))
    echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Hub unhealthy: pid=\$pid cpu=\${cpu}% failures=\$failure_count"
  fi

  if (( failure_count >= WATCHDOG_FAILURE_LIMIT )); then
    echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Restarting unhealthy NOOS Hub: pid=\$pid"
    kill "\$pid" >/dev/null 2>&1 || true
    pkill -P "\$pid" >/dev/null 2>&1 || true
    sleep 2
    pid="\$(launch_app)"
    if pid_is_running "\$pid"; then
      echo "\$pid" > "\$PID_FILE"
      echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] NOOS Hub relaunched: pid=\$pid"
    else
      rm -f "\$PID_FILE"
      echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] NOOS Hub relaunch failed."
    fi
    failure_count=0
  fi

  sleep "\$WATCHDOG_INTERVAL_SECONDS"
done
EOF
    chmod +x "$WATCHDOG_RUNNER"

    cat > "$WATCHDOG_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$WATCHDOG_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$WATCHDOG_RUNNER</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/</string>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$WATCHDOG_LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$WATCHDOG_PLIST"
    launchctl kickstart -k "gui/$(id -u)/$WATCHDOG_LABEL" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5; do
      watchdog_pid="$(read_watchdog_pid)"
      if pid_is_running "$watchdog_pid"; then
        return 0
      fi
      sleep 1
    done
    echo "NOOS Hub watchdog did not report a running PID after launchctl bootstrap." >&2
    return 1
  fi

  nohup "$SCRIPT_PATH" watchdog >> "$LOG_FILE" 2>&1 &
  echo "$!" > "$WATCHDOG_PID_FILE"
}

stop_watchdog() {
  local watchdog_pid
  watchdog_pid="$(read_watchdog_pid)"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/$WATCHDOG_LABEL" >/dev/null 2>&1 || true
  fi
  if pid_is_running "$watchdog_pid"; then
    kill "$watchdog_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$WATCHDOG_PID_FILE" "$WATCHDOG_PLIST" "$WATCHDOG_RUNNER"
}

status() {
  local pid
  pid="$(read_pid)"
  if ! pid_is_running "$pid"; then
    pid="$(find_hub_pid)"
  fi

  if pid_is_running "$pid"; then
    echo "$pid" > "$PID_FILE"
    echo "NOOS Hub is running: pid=$pid"
    echo "Health: $(hub_health_ok && echo ok || echo failed)"
    local payload
    payload="$(health_json)"
    if [[ -n "$payload" ]]; then
      echo "Version: $(health_field "$payload" version || echo unknown) commit: $(health_field "$payload" build_commit || echo unknown)"
    fi
    echo "Port ${HUB_PORT} owner: $(port_owner_pids | tr '\n' ' ')"
    echo "CPU: $(hub_cpu_percent "$pid")%"
    local watchdog_pid
    watchdog_pid="$(read_watchdog_pid)"
    if pid_is_running "$watchdog_pid"; then
      echo "Watchdog is running: pid=$watchdog_pid"
    elif [[ -n "$watchdog_pid" ]]; then
      echo "Watchdog is not running. Stale pid file: $watchdog_pid"
    else
      echo "Watchdog is not running."
    fi
    echo "Log: $LOG_FILE"
  else
    echo "NOOS Hub is not running."
    rm -f "$PID_FILE"
  fi
}

start() {
  ensure_dirs
  cd "$ROOT_DIR"

  # start means "make the latest build serve": always redeploy, never reuse
  # an already-running instance (its build identity may be stale).
  snapshot_runtime_state
  stop

  if hub_bundle_needs_rebuild; then
    echo "Building NOOS Hub app bundle..."
    npm run hub:bundle || {
      echo "hub:bundle failed; aborting start." >&2
      exit 1
    }
  fi

  echo "Installing NOOS Hub bundle to: $INSTALL_APP"
  install_bundle || exit 1

  local pid
  pid="$(launch_app)"
  if ! pid_is_running "$pid"; then
    echo "NOOS Hub failed to stay running. Log: $LOG_FILE" >&2
    exit 1
  fi
  echo "$pid" > "$PID_FILE"

  if ! wait_health; then
    echo "NOOS Hub health check failed at $HEALTH_URL. Log: $LOG_FILE" >&2
    exit 1
  fi
  if ! verify_deploy; then
    echo "Deploy verification failed; leaving the process running for inspection. Log: $LOG_FILE" >&2
    exit 1
  fi

  start_watchdog
  echo "NOOS Hub started: pid=$pid"
  echo "Log: $LOG_FILE"
}

stop() {
  stop_watchdog

  # Port ownership is authoritative: it catches instances this launcher never
  # started (Spotlight/Dock launches of any installed copy, manual tauri dev).
  local pids pid
  pids="$(port_owner_pids)"
  if [[ -z "$pids" ]]; then
    pid="$(read_pid)"
    if ! pid_is_running "$pid"; then
      pid="$(find_hub_pid)"
    fi
    [[ -n "$pid" ]] && pids="$pid"
  fi

  if [[ -z "$pids" ]]; then
    echo "NOOS Hub is not running."
    rm -f "$PID_FILE"
    launchctl_cleanup
    return 0
  fi

  echo "Stopping NOOS Hub: pid(s) $(echo $pids | tr '\n' ' ')" >&2
  for pid in $pids; do
    kill "$pid" >/dev/null 2>&1 || true
  done

  local _
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if port_is_free && ! any_pid_running $pids; then
      rm -f "$PID_FILE"
      launchctl_cleanup
      echo "NOOS Hub stopped."
      return 0
    fi
    sleep 1
  done

  pkill -f "$INSTALL_APP/Contents/MacOS/noos-hub" >/dev/null 2>&1 || true
  pkill -f "$APP_PATH/Contents/MacOS/noos-hub" >/dev/null 2>&1 || true
  pkill -f "$ROOT_DIR/apps/noos-hub/src-tauri/target/debug/noos-hub" >/dev/null 2>&1 || true
  pkill -f "$ROOT_DIR/apps/noos-hub/node_modules/.bin/vite --host 127.0.0.1 --port 1430" >/dev/null 2>&1 || true

  echo "NOOS Hub did not exit after SIGTERM; sending SIGKILL." >&2
  for pid in $pids; do
    kill -9 "$pid" >/dev/null 2>&1 || true
  done

  for _ in 1 2 3 4 5; do
    if port_is_free; then
      rm -f "$PID_FILE"
      launchctl_cleanup
      echo "NOOS Hub stopped (SIGKILL)."
      return 0
    fi
    sleep 1
  done

  echo "NOOS Hub port ${HUB_PORT} is still occupied after SIGKILL." >&2
  exit 1
}

watchdog() {
  set +e
  ensure_dirs
  cd "$ROOT_DIR" 2>/dev/null || cd /
  echo "$$" > "$WATCHDOG_PID_FILE"
  echo "NOOS Hub watchdog started at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  local failure_count=0
  while true; do
    local pid
    pid="$(read_pid)"
    if ! pid_is_running "$pid"; then
      pid="$(find_hub_pid)"
    fi

    if ! pid_is_running "$pid"; then
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Hub missing; relaunching."
      pid="$(launch_app)"
      if pid_is_running "$pid"; then
        echo "$pid" > "$PID_FILE"
      fi
      failure_count=0
      sleep "$WATCHDOG_INTERVAL_SECONDS"
      continue
    fi

    local cpu
    cpu="$(hub_cpu_percent "$pid")"
    if hub_health_ok && (( cpu < WATCHDOG_HIGH_CPU_PERCENT )); then
      failure_count=0
    else
      failure_count=$((failure_count + 1))
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Hub unhealthy: pid=$pid cpu=${cpu}% failures=$failure_count"
    fi

    if (( failure_count >= WATCHDOG_FAILURE_LIMIT )); then
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Restarting unhealthy NOOS Hub: pid=$pid"
      kill "$pid" >/dev/null 2>&1 || true
      pkill -P "$pid" >/dev/null 2>&1 || true
      sleep 2
      pid="$(launch_app)"
      if pid_is_running "$pid"; then
        echo "$pid" > "$PID_FILE"
        echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] NOOS Hub relaunched: pid=$pid"
      else
        rm -f "$PID_FILE"
        echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] NOOS Hub relaunch failed."
      fi
      failure_count=0
    fi

    sleep "$WATCHDOG_INTERVAL_SECONDS"
  done
}

show_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 80 "$LOG_FILE"
  else
    echo "No NOOS Hub log yet: $LOG_FILE"
  fi
}

command="${1:-start}"
case "$command" in
  start)
    start
    ;;
  status)
    status
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  logs)
    show_logs
    ;;
  watchdog)
    watchdog
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 1
    ;;
esac
