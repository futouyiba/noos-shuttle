# V1 Integration Branch — Verification Status

> Branch: `codex/child-lifecycle-next` @ `b4e1c70` (merge of the reviewed goal
> re-anchor line). All work lives in the Claude worktree
> `.claude/worktrees/github-workflow-integration-dad5e2`; main workspace and the
> Codex integration worktree are untouched. Nothing has been pushed.

## 1. What this branch contains (all independently reviewed)

| Line | Reviewed commits | Status |
| --- | --- | --- |
| Work Item inbox | through `65c047b` (integration-prep base) | carried in via `d09b052` |
| Submission ledger / provider verification | `d09b052` base | carried in |
| Integration intake (C) | `8156607`, `4e1a802` | APPROVE (3 NOTE) |
| Goal Re-anchor (B) | `9102272`, `a926622`, `d2077ac` | APPROVE ×3 |
| Child worker lifecycle (D1) | `1a71180`, `c84373c` | APPROVE after fix (8/8 mutations caught) |
| Result delivery (D2) | `8e8ce7c`, `8459497` | APPROVE ×2 |
| Durable reducer (D3) | `10357bd`, `c4e465d` | APPROVE ×2 |
| Child return (D4) | `2a01cef`, `9e49f95` | APPROVE ×2 |
| Freeze-race flake fix | `323fec7`, `bc63c91` | APPROVE ×2 |
| Child spawn (D5) | `278cda4`, `ec7fc8f`, `f1f62c0` | APPROVE after fix (probes + mutations) |
| Goal re-anchor merge | `b4e1c70` | APPROVE (semantic merge, zero unreviewed content) |

## 2. Verification evidence

- `npm run typecheck` — 0 errors.
- `npm test` — **25 files / 259 tests pass**, including the playwright browser
  smokes rebuilt from this tree: the Human GO real-ledger dispatch and the
  durable Goal Re-anchor end-to-end dispatch.
- `npm run build` / `npm run package:extension` — pass.

## 3. Open design proposals (pending adjudication, prompts delivered)

1. `docs/deliberation-harness/v1-design-proposal-result-delivery-lane.md` —
   which ledger owns `DELIVER_CHILD_RESULT` (submission lane vs delivery
   ledger). Current implementation chose (B) with an explicit mapping hook.
2. `docs/deliberation-harness/v1-design-proposal-reducer-model.md` — whether
   `HarnessReducer` is the State Store (delta contract) or a Provider
   Execution Journal. Current reading: execution journal; needs the settle
   API and an eventual separate delta-contract State Store.

## 4. Remaining NOT_IMPLEMENTED items (readiness §5 residual)

- Provider-execution wiring of child spawn (a real browser fork/new-conversation
  adapter) and bootstrap dispatch — pure-module core is done (D5), browser
  action is not.
- Reducer operation settle path (`DISPATCHING → OBSERVED_ACCEPTED / UNCERTAIN /
  FAILED_SAFE`, `OBSERVED_ACCEPTED → COMPLETED`) — blocked on proposal 2 (Q3).
- compaction / review-return / sedimentation-return event producers — blocked
  on both proposals.
- Canonical active-binding resolution feeding `deliveredTo` at delivery time —
  binding ledger exists; the runtime glue is not wired.
- State Store implementing the delta contract (Authorized Delta / ApplyResult /
  audit records) — separate module, blocked on proposal 2 (Q4).

## 5. Environment notes

- Push requires explicit authorization; none given.
- `tests/review-freeze.test.ts` race flake was root-caused (real async
  WebCrypto digest ordering) and fixed order-independently (`323fec7`); no
  flake observed since across repeated full-suite runs.
- The old `codex/integration-prep` worktree and branch are superseded by this
  line; the main workspace's untracked `src/core/submission-operation.ts` was
  never touched.
