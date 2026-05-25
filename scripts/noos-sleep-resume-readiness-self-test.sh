#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
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

tmpdir="$(mktemp -d)"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT

project="$tmpdir/wiki-project"
mkdir -p "$project/.llm-wiki"
echo '[]' > "$project/.llm-wiki/file-snapshot.json"
noos_home="$tmpdir/noos-home"
mkdir -p "$noos_home/run"
echo "$$" > "$noos_home/run/noos-hub-watchdog.pid"

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

if ! NOOS_HOME="$noos_home" \
  NOOS_SLEEP_READY_SELF_TEST=1 \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_PRE_SLEEP_HUB_PID="$server_pid" \
  NOOS_PRE_SLEEP_WIKI_PID="$$" \
  NOOS_PRE_SLEEP_CPU_LIMIT=999 \
  "$ROOT_DIR/scripts/noos-sleep-resume-readiness.sh" --wiki-project "$project" > "$tmpdir/ready.out" 2>&1; then
  fail "controlled readiness self-test run failed"
  cat "$tmpdir/ready.out"
  exit 1
fi

if ! rg -q '^ok      Sleep/resume readiness passed$' "$tmpdir/ready.out"; then
  fail "readiness self-test did not pass"
  cat "$tmpdir/ready.out"
  exit 1
fi

set +e
NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_PRE_SLEEP_HUB_PID="$server_pid" \
  NOOS_PRE_SLEEP_WIKI_PID="$$" \
  NOOS_PRE_SLEEP_CPU_LIMIT=999 \
  "$ROOT_DIR/scripts/noos-sleep-resume-readiness.sh" --wiki-project "$project" > "$tmpdir/controlled-rejected.out" 2>&1
controlled_status=$?
set -e

if [[ "$controlled_status" == "0" ]]; then
  fail "readiness accepted controlled overrides outside self-test"
  cat "$tmpdir/controlled-rejected.out"
  exit 1
fi

if ! rg -q 'Controlled overrides are set' "$tmpdir/controlled-rejected.out"; then
  fail "readiness did not explain controlled override rejection"
  cat "$tmpdir/controlled-rejected.out"
  exit 1
fi

missing_snapshot="$tmpdir/wiki-missing-snapshot"
mkdir -p "$missing_snapshot/.llm-wiki"
set +e
NOOS_HOME="$noos_home" \
  NOOS_SLEEP_READY_SELF_TEST=1 \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_PRE_SLEEP_HUB_PID="$server_pid" \
  NOOS_PRE_SLEEP_WIKI_PID="$$" \
  NOOS_PRE_SLEEP_CPU_LIMIT=999 \
  "$ROOT_DIR/scripts/noos-sleep-resume-readiness.sh" --wiki-project "$missing_snapshot" > "$tmpdir/missing-snapshot.out" 2>&1
missing_snapshot_status=$?
set -e

if [[ "$missing_snapshot_status" == "0" ]]; then
  fail "readiness accepted missing Wiki snapshot"
  cat "$tmpdir/missing-snapshot.out"
  exit 1
fi

if ! rg -q 'Wiki file snapshot is missing' "$tmpdir/missing-snapshot.out"; then
  fail "readiness did not explain missing Wiki snapshot"
  cat "$tmpdir/missing-snapshot.out"
  exit 1
fi

if ! rg -q 'npm run hub:launch' "$tmpdir/missing-snapshot.out"; then
  fail "readiness failure did not recommend Hub launch setup"
  cat "$tmpdir/missing-snapshot.out"
  exit 1
fi

if ! rg -q 'npm --prefix apps/noos-hub install' "$tmpdir/missing-snapshot.out"; then
  fail "readiness failure did not recommend Hub dependency setup"
  cat "$tmpdir/missing-snapshot.out"
  exit 1
fi

if ! rg -q 'npm run wiki:launch' "$tmpdir/missing-snapshot.out"; then
  fail "readiness failure did not recommend Wiki launch setup"
  cat "$tmpdir/missing-snapshot.out"
  exit 1
fi

if ! rg -q 'npm --prefix apps/llm-wiki install' "$tmpdir/missing-snapshot.out"; then
  fail "readiness failure did not recommend Wiki dependency setup"
  cat "$tmpdir/missing-snapshot.out"
  exit 1
fi

rm -f "$noos_home/run/noos-hub-watchdog.pid"

set +e
NOOS_HOME="$noos_home" \
  NOOS_SLEEP_READY_SELF_TEST=1 \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_PRE_SLEEP_HUB_PID="$server_pid" \
  NOOS_PRE_SLEEP_WIKI_PID="$$" \
  NOOS_PRE_SLEEP_CPU_LIMIT=999 \
  "$ROOT_DIR/scripts/noos-sleep-resume-readiness.sh" --wiki-project "$project" > "$tmpdir/missing-watchdog.out" 2>&1
missing_watchdog_status=$?
set -e

if [[ "$missing_watchdog_status" == "0" ]]; then
  fail "readiness accepted missing Hub watchdog"
  cat "$tmpdir/missing-watchdog.out"
  exit 1
fi

if ! rg -q 'NOOS Hub watchdog is not running' "$tmpdir/missing-watchdog.out"; then
  fail "readiness did not explain missing Hub watchdog"
  cat "$tmpdir/missing-watchdog.out"
  exit 1
fi

pass "sleep readiness accepts complete controlled self-test state"
pass "sleep readiness rejects controlled overrides outside self-test"
pass "sleep readiness rejects missing Wiki snapshot"
pass "sleep readiness rejects missing Hub watchdog"
pass "sleep readiness failure prints setup commands"
