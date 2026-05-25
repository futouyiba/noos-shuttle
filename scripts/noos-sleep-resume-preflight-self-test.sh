#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

write_acceptance_complete() {
  local path="$1"
  local wiki_project="$2"
  cat > "$path" <<EOF
NOOS Sleep / Resume Acceptance
Validation session: controlled-preflight-self-test
Epoch: $(( $(date '+%s') + 60 ))
Controlled overrides: no
Skipped checks: no
ok      Hub health endpoint responds: http://127.0.0.1:17642/health
ok      Hub CPU settled after wake: 1.0% <= 25%
ok      LLM Wiki CPU settled after wake: 1.0% <= 25%
Hub write probe: yes
ok      Hub local handoff write probe accepted and verified: /tmp/handoff.md
ok      Hub local crystal write probe accepted and verified: /tmp/crystal.md
Wiki watcher probe: yes
Wiki watcher project path: $wiki_project
ok      File watcher state includes fresh post-wake probe
NOOS sleep/resume acceptance passed.
EOF
}

start_hub_mock() {
  local port_file="$1"
  local log_file="$2"
  python3 - "$port_file" > "$log_file" 2>&1 <<'PY' &
import http.server
import json
import socketserver
import sys
from pathlib import Path

port_file = Path(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_json({"ok": True})
        else:
            self.send_error(404)

    def send_json(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass

with socketserver.TCPServer(("127.0.0.1", 0), Handler) as httpd:
    port_file.write_text(str(httpd.server_address[1]))
    httpd.serve_forever()
PY
}

start_snapshot_mock() {
  local project="$1"
  (
    while true; do
      probe="$(find "$project/raw/sources/noos/pre-sleep-probes" -type f -name '*.md' -print -quit 2>/dev/null || true)"
      if [[ -n "$probe" ]]; then
        basename "$probe" > "$project/.llm-wiki/file-snapshot.json"
        exit 0
      fi
      sleep 0.1
    done
  ) &
}

start_stale_snapshot_mock() {
  local project="$1"
  (
    while true; do
      probe="$(find "$project/raw/sources/noos/pre-sleep-probes" -type f -name '*.md' -print -quit 2>/dev/null || true)"
      if [[ -n "$probe" ]]; then
        basename "$probe" > "$project/.llm-wiki/file-snapshot.json"
        touch -t 200001010000 "$project/.llm-wiki/file-snapshot.json"
        exit 0
      fi
      sleep 0.1
    done
  ) &
}

tmpdir="$(mktemp -d)"
server_pid=""
snapshot_pid=""
stale_snapshot_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$snapshot_pid" ]]; then
    kill "$snapshot_pid" >/dev/null 2>&1 || true
    wait "$snapshot_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$stale_snapshot_pid" ]]; then
    kill "$stale_snapshot_pid" >/dev/null 2>&1 || true
    wait "$stale_snapshot_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT

port_file="$tmpdir/port"
server_log="$tmpdir/hub-mock.log"
start_hub_mock "$port_file" "$server_log"
server_pid=$!

for _ in 1 2 3 4 5; do
  [[ -s "$port_file" ]] && break
  sleep 0.2
done

if [[ ! -s "$port_file" ]]; then
  fail "Hub mock did not start"
  cat "$server_log"
  exit 1
fi

port="$(cat "$port_file")"
project="$tmpdir/wiki-project"
mkdir -p "$project/.llm-wiki" "$project/raw/sources/noos/pre-sleep-probes"
echo '[]' > "$project/.llm-wiki/file-snapshot.json"
start_snapshot_mock "$project"
snapshot_pid=$!

noos_home="$tmpdir/noos-home"
mkdir -p "$noos_home/reports"

if ! NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_PRE_SLEEP_HUB_PID="$server_pid" \
  NOOS_PRE_SLEEP_WIKI_PID="$$" \
  NOOS_PRE_SLEEP_CPU_LIMIT=999 \
  NOOS_WIKI_PRE_SLEEP_WATCHER_TIMEOUT=3 \
  "$ROOT_DIR/scripts/noos-sleep-resume-preflight.sh" --wiki-project "$project" > "$tmpdir/preflight.out" 2>&1; then
  fail "controlled preflight run failed"
  cat "$tmpdir/preflight.out"
  exit 1
fi

preflight="$(ls -t "$noos_home/reports"/noos-sleep-resume-preflight-*.txt | head -n 1)"

if ! rg -q '^Controlled overrides: yes$' "$preflight"; then
  fail "controlled preflight report did not mark controlled overrides"
  cat "$preflight"
  exit 1
fi

if ! rg -q '^ok      Preflight passed$' "$preflight"; then
  fail "controlled preflight report did not pass underlying checks"
  cat "$preflight"
  exit 1
fi

stale_project="$tmpdir/wiki-project-stale"
mkdir -p "$stale_project/.llm-wiki" "$stale_project/raw/sources/noos/pre-sleep-probes"
echo '[]' > "$stale_project/.llm-wiki/file-snapshot.json"
start_stale_snapshot_mock "$stale_project"
stale_snapshot_pid=$!

set +e
NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_PRE_SLEEP_HUB_PID="$server_pid" \
  NOOS_PRE_SLEEP_WIKI_PID="$$" \
  NOOS_PRE_SLEEP_CPU_LIMIT=999 \
  NOOS_WIKI_PRE_SLEEP_WATCHER_TIMEOUT=3 \
  "$ROOT_DIR/scripts/noos-sleep-resume-preflight.sh" --wiki-project "$stale_project" > "$tmpdir/preflight-stale.out" 2>&1
stale_exit=$?
set -e

if [[ "$stale_exit" == "0" ]]; then
  fail "controlled preflight accepted stale snapshot evidence"
  cat "$tmpdir/preflight-stale.out"
  exit 1
fi

if ! rg -q 'Wiki watcher state did not include pre-sleep probe' "$tmpdir/preflight-stale.out"; then
  fail "controlled preflight did not reject stale snapshot evidence"
  cat "$tmpdir/preflight-stale.out"
  exit 1
fi

write_acceptance_complete "$noos_home/reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "$project"

set +e
NOOS_HOME="$noos_home" \
  NOOS_SLEEP_STATUS_SELF_TEST=1 \
  NOOS_SLEEP_STATUS_SKIP_WAKE_CHECK=1 \
  "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmpdir/status.out" 2>&1
status_exit=$?
set -e

if [[ "$status_exit" == "0" ]]; then
  fail "status accepted a controlled preflight report"
  cat "$tmpdir/status.out"
  exit 1
fi

if ! rg -q 'Latest preflight used controlled overrides' "$tmpdir/status.out"; then
  fail "status did not report controlled preflight rejection"
  cat "$tmpdir/status.out"
  exit 1
fi

pass "controlled preflight reports are rejected by status"
pass "stale preflight snapshot evidence is rejected"
