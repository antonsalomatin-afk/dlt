# TASK-064 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-064` — Manage preferred language in the Mini App
- Commit(s): `78504b20a48f6262f8af6d3c1640a6ff0ef9b94a` against parent `b4f9042`
- Relevant ADR(s): `ADR-005-mini-app-boundary.md`
- Checks supplied: `.agent/checks/TASK-064-checks-01.txt` (`pnpm check`, `pnpm build`, and `pnpm test:e2e` all exited 0)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Settings entry from setup and practice with preserved navigation and learning state | PASS | Both entry points and return destinations are implemented and covered. |
| One guarded authenticated GET with strict response validation | FAIL | The production build path passes, but the documented Next development server leaves the view permanently loading under React's development effect replay. |
| Exact guarded PATCH for English, Russian, and Thai with server-confirmed state | PASS | Enum, request body, response equality, pending guard, and subsequent saves are covered. |
| Truthful future-message scope wording | PASS | The view distinguishes the persisted message preference from existing screen selectors. |
| Safe recovery, expiry, duplicate, and stale-action behavior | FAIL | The initial lifecycle cannot recover in the documented development runtime because its busy guard remains latched. |
| Browser and source coverage | FAIL | The production E2E suite is broad, but it does not exercise the documented development runtime or catch the effect-replay deadlock. |

## Findings

### Blockers

1. **Development effect replay permanently strands language settings in loading**
   - Severity: blocker
   - File: `apps/web/app/language-settings.tsx:117`
   - Problem: The mount effect sets `active.current = true` and starts `loadPreference()`. In the Next development runtime, React replays the effect by running its cleanup and setup again. Cleanup increments `requestId` but leaves `busy.current` true. The replayed setup calls `loadPreference()`, which immediately returns because it is busy. When the original request finishes, its `finally` sees a stale request ID and therefore never clears `busy.current` or `pending`. The screen remains at “Loading your preferred language…” with no choices or retry action.
   - Why it matters: `README.md` documents `pnpm web:dev` as the local Mini App workflow. A learner or developer using that supported runtime cannot view or change the preference, so the core task flow and recoverability criteria are not satisfied. I reproduced this against Next 16.3.5 with the repository's normal `pnpm web:dev`: one successful mocked `GET /me/language` was observed, but after two seconds the page still had zero language radios and showed the loading state.
   - Required correction: Make the mount/request lifecycle safe under React development effect replay while retaining the one-request entry contract, synchronous duplicate protection, real-unmount invalidation, and late-response safety. Add a focused regression test that exercises the replay lifecycle or otherwise proves the busy/pending state cannot remain latched.

### Important

None.

### Minor

None.

## Security review

- PASS. The endpoint is explicitly rewritten, the bearer token remains in memory and in the authorization header, responses are strictly parsed, and no credential or preference persistence was introduced in browser storage, URLs, cookies, or logs.

## Test review

- coverage inadequate
- missing scenarios: React development effect replay for initial settings loading, including proof that a successful response produces choices and clears the busy/loading state without duplicate entry requests.

## Architecture review

- compliant with ADR-005; the blocker is a client lifecycle defect rather than an architecture change.

## Final reviewer statement

`VERDICT: FAIL` because the documented development runtime cannot complete the initial language-preference load. The authoritative production checks remain green but do not cover this runtime behavior.
