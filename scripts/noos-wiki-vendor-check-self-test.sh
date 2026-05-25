#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

write_required_wiki_tree() {
  local root="$1"
  local wiki="$root/apps/llm-wiki"

  mkdir -p \
    "$wiki/src-tauri/src" \
    "$wiki/src-tauri" \
    "$wiki/src"

  for path in \
    package.json \
    package-lock.json \
    index.html \
    vite.config.ts \
    src/App.tsx \
    src-tauri/Cargo.toml \
    src-tauri/Cargo.lock \
    src-tauri/tauri.conf.json \
    src-tauri/src/lib.rs
  do
    mkdir -p "$(dirname "$wiki/$path")"
    printf "vendor self-test fixture: %s\n" "$path" > "$wiki/$path"
  done

  cat > "$root/.gitignore" <<'EOF'
apps/llm-wiki/node_modules/
apps/llm-wiki/dist/
apps/llm-wiki/src-tauri/target/
apps/llm-wiki/*.tsbuildinfo
EOF
}

run_vendor_check() {
  local root="$1"
  NOOS_WIKI_VENDOR_SELF_TEST=1 \
    NOOS_WIKI_VENDOR_ROOT="$root" \
    "$ROOT_DIR/scripts/noos-wiki-vendor-check.sh"
}

tmpdir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

repo="$tmpdir/repo"
mkdir -p "$repo"
git -C "$repo" init -q
write_required_wiki_tree "$repo"
git -C "$repo" add .gitignore apps/llm-wiki

if ! run_vendor_check "$repo" > "$tmpdir/pass.out" 2>&1; then
  fail "vendor check rejected a complete staged Wiki tree"
  cat "$tmpdir/pass.out"
  exit 1
fi
pass "vendor check accepts complete staged Wiki tree"

printf "outside index\n" > "$repo/apps/llm-wiki/untracked.md"
set +e
run_vendor_check "$repo" > "$tmpdir/untracked.out" 2>&1
untracked_status=$?
set -e
rm -f "$repo/apps/llm-wiki/untracked.md"

if [[ "$untracked_status" == "0" ]]; then
  fail "vendor check accepted non-ignored untracked Wiki file"
  cat "$tmpdir/untracked.out"
  exit 1
fi

if ! rg -q 'Non-ignored LLM Wiki files are missing from git' "$tmpdir/untracked.out"; then
  fail "vendor check did not explain untracked Wiki file rejection"
  cat "$tmpdir/untracked.out"
  exit 1
fi
pass "vendor check rejects non-ignored untracked Wiki files"

printf "outside index change\n" >> "$repo/apps/llm-wiki/package.json"
set +e
run_vendor_check "$repo" > "$tmpdir/unstaged.out" 2>&1
unstaged_status=$?
set -e

if [[ "$unstaged_status" == "0" ]]; then
  fail "vendor check accepted unstaged Wiki file change"
  cat "$tmpdir/unstaged.out"
  exit 1
fi

if ! rg -q 'Unstaged LLM Wiki file changes are outside the git index' "$tmpdir/unstaged.out"; then
  fail "vendor check did not explain unstaged Wiki file rejection"
  cat "$tmpdir/unstaged.out"
  exit 1
fi
pass "vendor check rejects unstaged Wiki file changes"

set +e
NOOS_WIKI_VENDOR_ROOT="$repo" "$ROOT_DIR/scripts/noos-wiki-vendor-check.sh" > "$tmpdir/root-override.out" 2>&1
override_status=$?
set -e

if [[ "$override_status" != "2" ]]; then
  fail "vendor check accepted root override outside self-test"
  cat "$tmpdir/root-override.out"
  exit 1
fi

if ! rg -q 'reserved for vendor self-tests' "$tmpdir/root-override.out"; then
  fail "vendor check did not explain root override rejection"
  cat "$tmpdir/root-override.out"
  exit 1
fi
pass "vendor check rejects root override outside self-test"
