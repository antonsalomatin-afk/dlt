# TASK-064 Review 02

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `TASK-064` — Manage preferred language in the Mini App
- Commit(s): `78504b20a48f6262f8af6d3c1640a6ff0ef9b94a` and fix `4a34104efa22d8012b29fbf5d23fa3d1a5851bb2`
- Relevant ADR(s): `ADR-005-mini-app-boundary.md`
- Checks supplied: `.agent/checks/TASK-064-checks-02.txt` (`pnpm check`, `pnpm build`, and `pnpm test:e2e` all exited 0; 213 browser tests passed)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Settings entry from setup and practice with preserved navigation and learning state | PASS | Setup and practice expose the dedicated entry, return to their originating view, and the browser tests verify category reload without learning mutations. |
| One guarded authenticated GET with strict response validation | PASS | The view sends one same-origin GET with the in-memory bearer token, no-store cache and timeout; the strict schema rejects missing, unsupported, wrong-case, non-string and extra fields. The effect-generation cleanup deferral allows React development effect replay without starting a duplicate request. |
| Exact guarded PATCH for English, Russian, and Thai with server-confirmed state | PASS | PATCH bodies are limited to the enum, pending state prevents duplicates, unchanged values do not send a request, and confirmation is updated only from an exact matching server response. Russian and Thai saves are covered in the browser suite. |
| Truthful future-message scope wording | PASS | The UI states that the preference applies to future messages and leaves practice, history, progress and mock-exam selectors independent. |
| Safe recovery, expiry, duplicate, and stale-action behavior | PASS | Transport, HTTP, malformed, mismatch and 401 cases have deterministic recovery. The synchronous busy/request guards block duplicate actions, `leave` invalidates immediately, and the deferred effect cleanup invalidates genuine unmounts while skipping only the replayed development cleanup. Late responses cannot replace the current confirmed state. |
| Browser and source coverage | PASS | The authoritative suite passes all 213 E2E tests, including the language settings scenarios. Focused source tests cover the exact schema/rewrite boundary and the effect-replay cleanup behavior; the fix is limited to the language settings lifecycle. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. The endpoint is explicitly rewritten, bearer authentication remains in memory and is sent only in guarded requests, responses are strictly parsed, and no preference or credential is written to browser storage, cookies, URLs or logs.

## Test review

- coverage adequate
- missing scenarios: none identified
- Independently reran `pnpm exec vitest run tests/web-language-settings.test.ts`: 4 tests passed.

## Architecture review

- compliant with ADR-005; the change keeps the explicit same-origin rewrite and does not alter API, database, authentication, bot, delivery or deployment boundaries.

## Final reviewer statement

The fix preserves a single guarded initial request under React development effect replay, while real navigation and unmount paths still invalidate callbacks. The acceptance criteria are satisfied and the supplied authoritative checks are green.

`VERDICT: PASS`
