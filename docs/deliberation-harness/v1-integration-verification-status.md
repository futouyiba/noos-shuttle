# V1 Integration Branch — Verification Status

> Branch: `codex/child-lifecycle-next` @ `d483e94`. Post-adjudication work
> (see `v1-adjudication-record.md`, authority baseline noos_docs @ a49303ca)
> is landing on top of the merged integration line (b4e1c70). All work lives in
> the Claude worktree `.claude/worktrees/github-workflow-integration-dad5e2`;
> main workspace and the Codex integration worktree are untouched. Nothing has
> been pushed.

## 1. Milestone 1 — merged lines (through b4e1c70)

| Line | Status |
| --- | --- |
| Work Item inbox / Freeze Review / provider verification (via d09b052) | carried in, reviewed upstream |
| Integration intake C (`8156607`, `4e1a802`) | APPROVE |
| Goal Re-anchor B (`9102272`, `a926622`, `d2077ac`) | APPROVE ×3 |
| Child lifecycle D1 (`1a71180`, `c84373c`) | APPROVE after fix |
| Result delivery D2 (`8e8ce7c`, `8459497`) | APPROVE ×2 |
| Durable reducer D3 (`10357bd`, `c4e465d`) | APPROVE ×2 |
| Child return D4 (`2a01cef`, `9e49f95`) | APPROVE ×2 |
| Child spawn D5 (`278cda4`, `ec7fc8f`, `f1f62c0`) | APPROVE after fix |
| Freeze-race flake fix (`323fec7`, `bc63c91`) | APPROVE ×2 |
| Goal re-anchor merge (`b4e1c70`) | APPROVE (semantic merge) |

## 2. Milestone 2 — adjudication implementation (b4e1c70..HEAD)

| Slice | Commits | Status |
| --- | --- | --- |
| R1 delivery → projection model | `0fd2de1`, `5044cca` | APPROVE ×2 (closed) |
| R2a settle_submission_dispatch | `8624cd7` | APPROVE (closed) |
| R4 Provider Execution Journal | `ad8ce8d`, `6b76c8b` | APPROVE ×2 (closed) |
| R2b delta kernel (ApplyResult/audit/replay) | `738ced5`, `d483e94` | APPROVE after fix |
| R2c rename OperationalStateReducer | `e37dbab`, `bca117f` | APPROVE (mechanical rename verified) |
| W1 settle-from-evidence glue | `31f8e2d`, `35faeb5` | APPROVE after fix |
| W2 DELIVER_CHILD_RESULT transport composer | `865ac7f`, `ee03b1d` | APPROVE (MINOR-1 tracked as pre-wiring gap) |

## 3. Verification evidence (current)

- `npm run typecheck` — 0 errors.
- `npm test` — **28 files / 299 tests pass**, including playwright browser smokes
  rebuilt from this tree (Human GO real-ledger dispatch; durable Goal Re-anchor
  end-to-end).
- Commit-message test counts are taken from the last clean-tree run.

## 4. Open items

- **Tracked design gap (pre-wiring blocker, W2 review MINOR-1)**: a
  PREPARED-but-unclaimed DELIVER_CHILD_RESULT (or any submission operation)
  cannot re-fence after a parent rollover before the dispatch claim — the
  ledger freezes the fence at prepare, `recover`/`rearm` do not cover PREPARED,
  and re-preparing under the derived delivery id raises
  `operation_id_reuse_conflict`. Fail-closed (no duplicate-insert risk), but the
  E2E §5/§7 rollover example cannot be honored until the submission ledger
  gains an authority-proven PREPARED re-fence path. Root cause sits in the
  reviewed `submission-operation.ts`, not the composer.
- Wiring slices (blocked on nothing external, ordered): service-worker
  producers for child spawn/return; settle evidence producers (journal append →
  settleFromEvidence); delivery transport driving (prepare → claim → dispatch
  → reconcile → mint → complete). Wiring order for delivery: reconcile → mint
  → await turn → record COMPLETED (to shrink the permanent-wedge window).
- Semantic run-state handlers (commit_decision, open_question, …) share the
  delta kernel per adjudication item 5 — not started, explicitly V1-later.

## 5. Environment notes

- Push requires explicit authorization; none given.
- One transient external-volume glitch lost two uncommitted files (recovered by
  rewrite; git history unaffected) — slices now commit immediately after green.
- Two commit messages carried inaccurate test counts measured on trees with
  in-flight work (275→269, 277→278); both recorded in follow-up commits, and
  the count-verification practice is now in place.
