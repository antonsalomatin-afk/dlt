# TASK-073 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `.agent/tasks/TASK-073.yaml`.
- Commit: `d40b80a9008e3cf8a8830b6e5430f08f06ae8a6a` (all 16 changed files), relevant API authentication/answer handlers, presentation readers, reminder ledger/scheduler, web contracts and navigation, and surrounding tests.
- Relevant ADRs: ADR-004, ADR-005, ADR-006 including its TASK-073 refinement.
- Checks supplied: Supervisor `.agent/checks/TASK-073-checks-01.txt`: lint, typecheck, 328 unit tests, web build, 222 E2E tests and 203 integration tests passed. Changes after the Builder commit are confined to `.agent` metadata.
- Independent checks: focused Vitest run of `question-post`, `web-deep-link`, `daily-practice`, `presentation` and `bot-reminders`: 5 files / 22 tests passed; Builder diff whitespace check passed. Pure Node reproduction of the local-image bypass below used no network or Telegram calls.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Strict server-only rollout, disabled default and unchanged disabled delivery | PASS | Exact flag values, validated public identity, no question lookup when disabled. |
| Shared stable per-user/date assignment | PASS | Existing presentation uniqueness, serializable transaction and bounded retries reused by API/bot; concurrent coverage supplied. |
| Full stored EN/RU stems and one Answer URL without hidden metadata | PASS | Explicit bilingual construction and saved presentation identifier only. |
| Missing content/vehicle/Russian, overlong text and preparation fallback | PASS | Existing localized invitation preserved; no replacement assignment or translation. English-only readiness gap documented. |
| Safe optional photo or complete text-only fallback | FAIL | Trailing-dot local hostnames bypass rejection; blocker 1. |
| Authenticated exact owned historical retrieval, strict DTOs and rewrite | PASS | Ownership/availability enforced, immutable snapshot/date returned across midnight and vehicle changes/clearing; no substitution. |
| Completed-link handling and explicit answer confirmation | PASS | Completed view offers History/practice; unanswered links support changing choices and Check answer; existing authoritative duplicate protection retained. |
| Delivery ledger, retries, shutdown, isolation and summaries | PASS | Existing behavior retained; ambiguous sends and claimed-row crash limits documented. |
| Required test coverage and isolated transports/data | FAIL | Broad required coverage passes; missing trailing-dot local-reference regression permits blocker 1. |
| Scope, rollout documentation and no production operations | PASS | Changes stay within task file boundary; no schema/content/dependency changes or deployment. Capability acceptance is separate from content publication. |

## Findings

### Blockers

1. **Reject trailing-dot forms of local image hostnames before selecting photo delivery**
   - Severity: blocker (P2 acceptance/correctness defect).
   - File: `apps/bot/src/question-post.ts:17`–`19`.
   - Problem: `new URL()` preserves a terminal DNS dot, but the local-host checks compare the unnormalized hostname. Independently reproduced: `publishableImageReference('https://localhost./image.png')`, `https://foo.localhost./image.png` and `https://foo.local./image.png` all return the URL instead of `null`. For a fitting bilingual caption, `buildQuestionPost` therefore returns a non-null image and the scheduler selects `sendPhoto`.
   - Why it matters: These are local references explicitly required to use the complete text-only fallback. Instead, an unusable local image can cause photo delivery to fail and the reminder ledger to become FAILED, leaving the learner without the required text fallback. This is a validation/correctness issue; the bot does not fetch the URL itself.
   - Required correction: Normalize the parsed hostname's terminal DNS dot before the existing local-host checks (or reject that form), preserving rejection of localhost/subdomains and `.local`. Add regression cases for those dotted forms and assert a complete text-only post; retain a normal public HTTPS image case.

### Important

None.

### Minor

None.

## Security review

- Authentication, ownership, hidden-correctness boundaries, safe error/log messages and in-memory sessions pass inspection. Local image-reference rejection is incomplete as recorded in blocker 1. No broader DNS or bot-side-fetch claim is made.

## Test review

- Coverage is adequate for the remaining criteria; supplied authoritative suites and the independently repeated focused tests pass.
- Missing scenario: trailing-dot forms of rejected local image hostnames and their complete text-only fallback.

## Architecture review

- Compliant with the existing service boundaries, PostgreSQL persistence, session strategy and ADR-006 refinement. Internal optional image snapshots and older-runtime rollback limitations are documented; no schema migration or new service introduced.

## Final reviewer statement

`VERDICT: FAIL` for exact Builder commit `d40b80a9008e3cf8a8830b6e5430f08f06ae8a6a`. Resolve blocker 1 and revalidate before Supervisor acceptance. No implementation, state or accepted history was changed by this review.
