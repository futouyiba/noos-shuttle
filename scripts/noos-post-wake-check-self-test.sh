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
  local noos_home="$3"
  local mode="$4"
  python3 - "$port_file" "$noos_home" "$mode" > "$log_file" 2>&1 <<'PY' &
import http.server
import json
import socketserver
import sys
from pathlib import Path

port_file = Path(sys.argv[1])
noos_home = Path(sys.argv[2])
mode = sys.argv[3]

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
        body = self.rfile.read(length) if length else b""
        if self.path != "/v1/ingest" or self.headers.get("authorization") != "Bearer test-token":
            self.send_error(403)
            return

        payload = json.loads(body.decode())
        object_type = payload["object_type"]
        lookup_key = payload.get("suggested", {}).get("lookup_key") or f"post-wake-{object_type}"
        if mode == "inside" or mode == "no-index":
            target = noos_home / "vault" / f"{object_type}s" / "active" / f"post-wake-{object_type}.md"
        else:
            target = noos_home.parent / "outside-vault" / f"post-wake-{object_type}.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload["content"]["text"])
        if mode != "no-index":
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

run_case() {
  local mode="$1"
  local expected="$2"
  local tmpdir
  local server_pid=""
  tmpdir="$(mktemp -d)"

  cleanup_case() {
    if [[ -n "$server_pid" ]]; then
      kill "$server_pid" >/dev/null 2>&1 || true
      wait "$server_pid" >/dev/null 2>&1 || true
    fi
    rm -rf "$tmpdir"
  }
  trap cleanup_case RETURN

  local noos_home="$tmpdir/noos-home"
  local port_file="$tmpdir/port"
  local server_log="$tmpdir/hub-mock.log"
  mkdir -p "$noos_home/vault" "$noos_home/reports"
  start_hub_mock "$port_file" "$server_log" "$noos_home" "$mode"
  server_pid=$!

  for _ in 1 2 3 4 5; do
    [[ -s "$port_file" ]] && break
    sleep 0.2
  done

  if [[ ! -s "$port_file" ]]; then
    fail "$mode mock did not start"
    cat "$server_log"
    exit 1
  fi

  local port
  port="$(cat "$port_file")"

  set +e
  NOOS_HOME="$noos_home" \
    NOOS_HUB_HEALTH_URL="http://127.0.0.1:$port/health" \
    NOOS_POST_WAKE_PID="$server_pid" \
    NOOS_POST_WAKE_SAMPLES=1 \
    NOOS_POST_WAKE_SAMPLE_DELAY=0 \
    NOOS_POST_WAKE_CPU_LIMIT=999 \
    "$ROOT_DIR/scripts/noos-post-wake-check.sh" --write-probe > "$tmpdir/check.out" 2>&1
  local exit_status=$?
  set -e

  if [[ "$expected" == "pass" ]]; then
    if [[ "$exit_status" != "0" ]]; then
      fail "$mode post-wake check unexpectedly failed"
      cat "$tmpdir/check.out"
      exit 1
    fi
    if ! rg -q '^ok      Hub local handoff write probe accepted and verified:' "$tmpdir/check.out" ||
       ! rg -q '^ok      Hub local crystal write probe accepted and verified:' "$tmpdir/check.out"; then
      fail "$mode post-wake check did not verify both Vault files"
      cat "$tmpdir/check.out"
      exit 1
    fi
  else
    if [[ "$exit_status" == "0" ]]; then
      fail "$mode post-wake check unexpectedly passed"
      cat "$tmpdir/check.out"
      exit 1
    fi
    case "$mode" in
      outside)
        if ! rg -q 'ingest file is outside NOOS Vault' "$tmpdir/check.out"; then
          fail "$mode post-wake check did not reject outside-vault path"
          cat "$tmpdir/check.out"
          exit 1
        fi
        ;;
      no-index)
        if ! rg -q 'index file is missing|lookup key is missing from index' "$tmpdir/check.out"; then
          fail "$mode post-wake check did not reject missing index"
          cat "$tmpdir/check.out"
          exit 1
        fi
        ;;
    esac
  fi

  pass "$mode post-wake write probe"
}

run_case inside pass
run_case outside fail
run_case no-index fail
