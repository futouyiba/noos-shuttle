#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

write_preflight_complete() {
  local path="$1"
  local epoch="$2"
  local wiki_project="$3"
  cat > "$path" <<EOF
NOOS Sleep / Resume Preflight
Validation session: controlled-acceptance-self-test
Epoch: $epoch
Controlled overrides: no
ok      Hub health endpoint responds before sleep: http://127.0.0.1:17642/health
ok      Hub CPU baseline settled before sleep: 1.0% <= 25%
ok      LLM Wiki CPU baseline settled before sleep: 1.0% <= 25%
Wiki watcher project: yes
Wiki watcher project path: $wiki_project
ok      Wiki watcher state includes fresh pre-sleep probe
ok      Preflight passed
EOF
}

write_pmset_log_between() {
  local path="$1"
  local preflight_epoch="$2"
  python3 - "$path" "$preflight_epoch" <<'PY'
import datetime as dt
import sys

path = sys.argv[1]
preflight_epoch = int(sys.argv[2])
sleep = dt.datetime.fromtimestamp(preflight_epoch + 20)
wake = dt.datetime.fromtimestamp(preflight_epoch + 40)
with open(path, "w") as handle:
    handle.write(f"{sleep:%Y-%m-%d %H:%M:%S} +0800 Sleep                 Entering Sleep state\n")
    handle.write(f"{wake:%Y-%m-%d %H:%M:%S} +0800 Wake                  Wake from Normal Sleep\n")
PY
}

start_hub_mock() {
  local port_file="$1"
  local log_file="$2"
  local noos_home="$3"
  python3 - "$port_file" "$noos_home" > "$log_file" 2>&1 <<'PY' &
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
        elif self.path == "/pair":
            self.send_json({"token": "test-token"})
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        body = b""
        if length:
            body = self.rfile.read(length)
        if self.path == "/v1/ingest" and self.headers.get("authorization") == "Bearer test-token":
            payload = json.loads(body.decode())
            object_type = payload["object_type"]
            lookup_key = payload.get("suggested", {}).get("lookup_key") or f"post-wake-{object_type}"
            noos_home = Path(sys.argv[2])
            target = noos_home / "vault" / f"{object_type}s" / "active" / f"noos-acceptance-self-test-{object_type}.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(payload["content"]["text"])
            index_path = noos_home / "vault" / "index" / "keys.json"
            index_path.parent.mkdir(parents=True, exist_ok=True)
            if index_path.exists():
                keys = json.loads(index_path.read_text())
            else:
                keys = {}
            keys[lookup_key] = {
                "lookup_key": lookup_key,
                "key": lookup_key,
                "object_type": object_type,
                "type": object_type,
                "path": str(target),
            }
            index_path.write_text(json.dumps(keys))
            self.send_json({"path": str(target), "lookup_key": lookup_key, "object_type": object_type})
        else:
            self.send_error(403)

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
      probe="$(find "$project/raw/sources/noos/post-wake-probes" -type f -name '*.md' -print -quit 2>/dev/null || true)"
      if [[ -n "$probe" ]]; then
        basename "$probe" > "$project/.llm-wiki/file-snapshot.json"
        exit 0
      fi
      sleep 0.1
    done
  ) &
}

tmpdir="$(mktemp -d)"
server_pid=""
snapshot_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$snapshot_pid" ]]; then
    kill "$snapshot_pid" >/dev/null 2>&1 || true
    wait "$snapshot_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT

noos_home="$tmpdir/noos-home"
mkdir -p "$noos_home/reports" "$noos_home/vault"
port_file="$tmpdir/port"
server_log="$tmpdir/hub-mock.log"
start_hub_mock "$port_file" "$server_log" "$noos_home"
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
mkdir -p "$project/.llm-wiki" "$project/raw/sources/noos/post-wake-probes"
echo '[]' > "$project/.llm-wiki/file-snapshot.json"
start_snapshot_mock "$project"
snapshot_pid=$!

set +e
NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_POST_WAKE_PID="$server_pid" \
  NOOS_POST_WAKE_SAMPLES=1 \
  NOOS_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_POST_WAKE_CPU_LIMIT=999 \
  NOOS_WIKI_POST_WAKE_PID="$$" \
  NOOS_WIKI_POST_WAKE_SAMPLES=1 \
  NOOS_WIKI_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT=3 \
  "$ROOT_DIR/scripts/noos-sleep-resume-acceptance.sh" --wiki-project "$project" > "$tmpdir/missing-session.out" 2>&1
missing_session_status=$?
set -e

if [[ "$missing_session_status" == "0" ]]; then
  fail "acceptance unexpectedly passed without preflight session"
  cat "$tmpdir/missing-session.out"
  exit 1
fi

if ! rg -q 'Missing validation session' "$tmpdir/missing-session.out"; then
  fail "acceptance did not explain missing preflight session"
  cat "$tmpdir/missing-session.out"
  exit 1
fi

if ! rg -q 'npm run sleep:guided -- --wiki-project <path>' "$tmpdir/missing-session.out"; then
  fail "acceptance missing-session guidance does not recommend guided validation"
  cat "$tmpdir/missing-session.out"
  exit 1
fi

cat > "$noos_home/reports/noos-sleep-resume-current-session.txt" <<EOF
Validation session: controlled-acceptance-self-test
Preflight report: $noos_home/reports/noos-sleep-resume-preflight-20260525T000000Z.txt
Wiki watcher project path: $project
EOF

set +e
NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_POST_WAKE_PID="$server_pid" \
  NOOS_POST_WAKE_SAMPLES=1 \
  NOOS_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_POST_WAKE_CPU_LIMIT=999 \
  NOOS_WIKI_POST_WAKE_PID="$$" \
  NOOS_WIKI_POST_WAKE_SAMPLES=1 \
  NOOS_WIKI_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT=3 \
  "$ROOT_DIR/scripts/noos-sleep-resume-acceptance.sh" --wiki-project "$project" > "$tmpdir/missing-preflight-report.out" 2>&1
missing_preflight_report_status=$?
set -e

if [[ "$missing_preflight_report_status" == "0" ]]; then
  fail "acceptance unexpectedly passed without preflight report"
  cat "$tmpdir/missing-preflight-report.out"
  exit 1
fi

if ! rg -q 'Missing preflight report from validation session' "$tmpdir/missing-preflight-report.out"; then
  fail "acceptance did not explain missing preflight report"
  cat "$tmpdir/missing-preflight-report.out"
  exit 1
fi

if ! rg -q 'npm run sleep:guided -- --wiki-project <path>' "$tmpdir/missing-preflight-report.out"; then
  fail "acceptance missing-report guidance does not recommend guided validation"
  cat "$tmpdir/missing-preflight-report.out"
  exit 1
fi

preflight_epoch="$(( $(date '+%s') - 60 ))"
write_preflight_complete "$noos_home/reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "$preflight_epoch" "$project"

perl -0pi -e 's/Validation session: controlled-acceptance-self-test/Validation session: mismatched-acceptance-self-test/' "$noos_home/reports/noos-sleep-resume-preflight-20260525T000000Z.txt"

set +e
NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_POST_WAKE_PID="$server_pid" \
  NOOS_POST_WAKE_SAMPLES=1 \
  NOOS_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_POST_WAKE_CPU_LIMIT=999 \
  NOOS_WIKI_POST_WAKE_PID="$$" \
  NOOS_WIKI_POST_WAKE_SAMPLES=1 \
  NOOS_WIKI_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT=3 \
  "$ROOT_DIR/scripts/noos-sleep-resume-acceptance.sh" --wiki-project "$project" > "$tmpdir/mismatched-session.out" 2>&1
mismatched_session_status=$?
set -e

if [[ "$mismatched_session_status" == "0" ]]; then
  fail "acceptance unexpectedly passed with mismatched preflight session"
  cat "$tmpdir/mismatched-session.out"
  exit 1
fi

if ! rg -q 'Preflight report validation session does not match current session' "$tmpdir/mismatched-session.out"; then
  fail "acceptance did not explain mismatched preflight session"
  cat "$tmpdir/mismatched-session.out"
  exit 1
fi

write_preflight_complete "$noos_home/reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "$preflight_epoch" "$project"

perl -0pi -e 's#Wiki watcher project path: \Q'"$project"'\E#Wiki watcher project path: /tmp/different-wiki-project#' "$noos_home/reports/noos-sleep-resume-preflight-20260525T000000Z.txt"

set +e
NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_POST_WAKE_PID="$server_pid" \
  NOOS_POST_WAKE_SAMPLES=1 \
  NOOS_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_POST_WAKE_CPU_LIMIT=999 \
  NOOS_WIKI_POST_WAKE_PID="$$" \
  NOOS_WIKI_POST_WAKE_SAMPLES=1 \
  NOOS_WIKI_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT=3 \
  "$ROOT_DIR/scripts/noos-sleep-resume-acceptance.sh" --wiki-project "$project" > "$tmpdir/mismatched-preflight-wiki.out" 2>&1
mismatched_preflight_wiki_status=$?
set -e

if [[ "$mismatched_preflight_wiki_status" == "0" ]]; then
  fail "acceptance unexpectedly passed with mismatched preflight Wiki project"
  cat "$tmpdir/mismatched-preflight-wiki.out"
  exit 1
fi

if ! rg -q 'Preflight report Wiki project does not match current session' "$tmpdir/mismatched-preflight-wiki.out"; then
  fail "acceptance did not explain mismatched preflight Wiki project"
  cat "$tmpdir/mismatched-preflight-wiki.out"
  exit 1
fi

write_preflight_complete "$noos_home/reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "$preflight_epoch" "$project"

empty_pmset_log="$tmpdir/empty-pmset.log"
: > "$empty_pmset_log"

set +e
NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_POST_WAKE_PID="$server_pid" \
  NOOS_POST_WAKE_SAMPLES=1 \
  NOOS_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_POST_WAKE_CPU_LIMIT=999 \
  NOOS_WIKI_POST_WAKE_PID="$$" \
  NOOS_WIKI_POST_WAKE_SAMPLES=1 \
  NOOS_WIKI_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT=3 \
  NOOS_SLEEP_ACCEPTANCE_SELF_TEST=1 \
  NOOS_SLEEP_ACCEPTANCE_PMSET_LOG_FILE="$empty_pmset_log" \
  "$ROOT_DIR/scripts/noos-sleep-resume-acceptance.sh" --wiki-project "$project" > "$tmpdir/missing-sleep-wake.out" 2>&1
missing_sleep_wake_status=$?
set -e

if [[ "$missing_sleep_wake_status" == "0" ]]; then
  fail "acceptance unexpectedly passed without Sleep/Wake evidence"
  cat "$tmpdir/missing-sleep-wake.out"
  exit 1
fi

if ! rg -q 'No ordered macOS Sleep -> Wake/DarkWake event pair found' "$tmpdir/missing-sleep-wake.out"; then
  fail "acceptance did not explain missing Sleep/Wake evidence"
  cat "$tmpdir/missing-sleep-wake.out"
  exit 1
fi

pmset_log="$tmpdir/pmset.log"
write_pmset_log_between "$pmset_log" "$preflight_epoch"

if ! NOOS_HOME="$noos_home" \
  NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
  NOOS_POST_WAKE_PID="$server_pid" \
  NOOS_POST_WAKE_SAMPLES=1 \
  NOOS_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_POST_WAKE_CPU_LIMIT=999 \
  NOOS_WIKI_POST_WAKE_PID="$$" \
  NOOS_WIKI_POST_WAKE_SAMPLES=1 \
  NOOS_WIKI_POST_WAKE_SAMPLE_DELAY=0 \
  NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT=3 \
  NOOS_SLEEP_ACCEPTANCE_SELF_TEST=1 \
  NOOS_SLEEP_ACCEPTANCE_PMSET_LOG_FILE="$pmset_log" \
  "$ROOT_DIR/scripts/noos-sleep-resume-acceptance.sh" --wiki-project "$project" > "$tmpdir/acceptance.out" 2>&1; then
  fail "controlled acceptance run failed"
  cat "$tmpdir/acceptance.out"
  exit 1
fi

acceptance="$(ls -t "$noos_home/reports"/noos-sleep-resume-acceptance-*.txt | head -n 1)"

if ! rg -q '^Controlled overrides: yes$' "$acceptance"; then
  fail "controlled acceptance report did not mark controlled overrides"
  cat "$acceptance"
  exit 1
fi

if ! rg -q '^NOOS sleep/resume acceptance passed\.$' "$acceptance"; then
  fail "controlled acceptance report did not pass underlying checks"
  cat "$acceptance"
  exit 1
fi

set +e
NOOS_HOME="$noos_home" \
  NOOS_SLEEP_STATUS_SELF_TEST=1 \
  NOOS_SLEEP_STATUS_SKIP_WAKE_CHECK=1 \
  "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmpdir/status.out" 2>&1
status_exit=$?
set -e

if [[ "$status_exit" == "0" ]]; then
  fail "status accepted a controlled acceptance report"
  cat "$tmpdir/status.out"
  exit 1
fi

if ! rg -q 'Latest acceptance used controlled overrides' "$tmpdir/status.out"; then
  fail "status did not report controlled acceptance rejection"
  cat "$tmpdir/status.out"
  exit 1
fi

pass "acceptance requires preflight session, real Sleep/Wake evidence, and controlled reports are rejected by status"
