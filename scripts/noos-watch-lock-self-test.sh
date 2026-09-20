#!/usr/bin/env bash
# Local-only deterministic lock regression tests. No live watcher state is touched.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node --input-type=module - "$ROOT" <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const script = path.join(root, 'scripts/noos-watch-lock.mjs');
const { operate, withMutationGuard, defaultLockPath } = await import(pathToFileURL(script));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noos-watch-test-'));
const lock = path.join(tmp, 'watch.lock');
function cli(args, cwd = tmp) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, data: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
function parallelAcquire(file) {
  return Promise.all(Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script, 'acquire', '--lock-file', file], { stdio: 'ignore' });
    p.on('error', reject); p.on('exit', resolve);
  })));
}
function check(label, fn) { fn(); console.log(`ok - ${label}`); }
try {
  const first = operate('acquire', lock);
  const token = first.holderToken;
  check('fresh owner, foreign mutation refusal, refresh and release', () => {
    assert.equal(first.ok, true);
    assert.equal(operate('acquire', lock).ok, false);
    assert.equal(operate('refresh', lock, { token: 'foreign' }).ok, false);
    assert.equal(operate('release', lock, { token: 'foreign' }).ok, false);
    assert.equal(operate('refresh', lock, { token }).ok, true);
  });
  check('deterministic read/mutate interleaving blocks every competing mutation', () => {
    withMutationGuard(lock, () => {
      const before = fs.readFileSync(lock, 'utf8'); // owner checked, paused before mutation
      for (const cmd of ['acquire', 'refresh', 'release']) {
        const result = cli([cmd, '--lock-file', lock, '--token', token]);
        assert.equal(result.code, 1);
        assert.equal(result.data.outcome, 'mutation_busy');
        assert.equal(fs.readFileSync(lock, 'utf8'), before);
      }
    });
    assert.equal(operate('release', lock, { token }).ok, true);
    const next = operate('acquire', lock);
    for (const cmd of ['refresh', 'release']) assert.equal(operate(cmd, lock, { token }).ok, false);
    assert.equal(operate('status', lock).holder.holderToken, next.holderToken);
  });
  for (const [name, bytes] of [['empty', ''], ['partial', '{"holderToken":'], ['malformed', '{}'],
    ['stale', JSON.stringify({ holderToken: 'paused-run', startedAt: '2020-01-01T00:00:00Z' })]]) {
    const file = path.join(tmp, `${name}.lock`);
    fs.writeFileSync(file, bytes);
    const exits = await parallelAcquire(file);
    check(`${name}: concurrent acquisition never takes over or alters bytes`, () => {
      assert.ok(exits.every(code => code === 1));
      assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      assert.equal(operate('status', file).outcome, name === 'stale' ? 'held' : 'invalid');
    });
  }
  const exits = await parallelAcquire(path.join(tmp, 'fresh.lock'));
  check('12 fresh concurrent acquisitions have exactly one owner', () => assert.equal(exits.filter(c => c === 0).length, 1));
  check('crashed mutation guard blocks even a missing lock', () => {
    const file = path.join(tmp, 'crash.lock');
    fs.mkdirSync(`${file}.mutation`);
    assert.equal(operate('acquire', file).outcome, 'mutation_busy');
    assert.equal(operate('status', file).mutationBlocked, true);
  });
  check('main, linked worktree and subdirectory share canonical lock; explicit path survives cwd change', () => {
    const repo = path.join(tmp, 'repo'), linked = path.join(tmp, 'linked');
    const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });
    git(['init', repo]);
    git(['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
    git(['-C', repo, 'worktree', 'add', '-b', 'linked', linked]);
    fs.mkdirSync(path.join(linked, 'sub'));
    const expected = defaultLockPath(repo);
    assert.equal(defaultLockPath(linked), expected);
    assert.equal(defaultLockPath(path.join(linked, 'sub')), expected);
    const acquired = cli(['acquire'], linked);
    assert.equal(acquired.code, 0);
    assert.equal(acquired.data.lock, expected);
    assert.equal(cli(['acquire'], repo).code, 1);
    assert.equal(cli(['release', '--lock-file', expected, '--token', acquired.data.holderToken], tmp).code, 0);
    assert.equal(cli(['status', '--lock-file', 'relative.lock']).code, 2);
    assert.equal(cli(['acquire'], tmp).code, 2); // cannot silently choose cwd
  });
  console.log('noos-watch-lock self-test: all checks passed');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
JS
