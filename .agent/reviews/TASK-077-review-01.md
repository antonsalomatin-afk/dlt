# TASK-077 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `.agent/tasks/TASK-077.yaml`, including its inherited TASK-076 browser validation boundary.
- Commit(s): Builder `362624c272e43561f5fa727313ab6e0f6fc99693`; the 15 implementation/test/README/migration files against accepted baseline `bfe3d9f`. Subsequent commits through `d311d9e` contain agent metadata only; the reviewed source is unchanged.
- Relevant ADR(s): ADR-004, ADR-005, ADR-006 and ADR-007; project, architecture, workflow, definition of done, state and repository rules.
- Checks supplied: Supervisor `.agent/checks/TASK-077-checks-01.txt`: lint, typecheck, 350 unit tests in 60 files, Prisma validation, local database readiness, 218 integration tests in 43 files, build and diff check all PASS. The explicit task scope inherits the accepted 229 TASK-076 browser tests because web source and browser contracts are unchanged.
- Independently inspected native handlers, database state transitions, shared answer/selection extraction, surrounding API and lifecycle code, migration constraints, tests and documentation. No implementation changes made.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Private /quiz and /practice, vehicle selection, native answer/feedback/Next and discoverability | PASS | Existing verified question snapshots and four choices are used; /start retains its launch controls. |
| Existing Telegram identity and preferences; reject invalid/foreign/private identity inputs | PASS | Runtime schemas and owned session relationships enforce the relevant boundaries before learning writes. |
| Durable current session, leases, replay/concurrency/restart and safe vote recovery | FAIL | Signal-driven shutdown can acknowledge an in-flight vote before its durable claim fails; see blocker 1. Other inspected sending/answering/replacement and committed-feedback paths follow ADR-007. |
| Shared atomic practice answer and concept accounting; HTTP contract and pre-answer secrecy | PASS | API and bot share the transactional helper; existing error/duplicate responses and correctness-free presentation DTO remain intact. |
| Current non-anonymous quiz fields and explicit update subscription | PASS | Four persisted choices, plural correct_option_ids and disabled revoting/multiple/shuffle/additional options; explicit message/callback_query/poll_answer subscription. |
| Coherent language, native limits, full text and safe media | PASS | Complete preferred locale or English fallback; long context/options/explanations remain available with bounded Unicode-safe plain-text chunks; existing image validation is reused. |
| Additive owned persistence and bounded scope | PASS | One session model with user/presentation/poll uniqueness, owned composite foreign key and delivery-state checks; no dependency/env/content/web/API-route expansion. |
| Meaningful injected transport and isolated Postgres coverage | FAIL | Existing targeted suites pass, but shutdown overlapping a failed pre-claim transaction is missing and reveals blocker 1. |
| README usage/recovery/language/migration guidance; no Builder deployment | PASS | Documentation describes the intended protocol and rollout requirement. This review performs no live Telegram or production access. |

## Findings

### Blockers

1. **Graceful shutdown acknowledges a vote before its durable claim completes**
   - Severity: blocker
   - File: `apps/bot/src/lifecycle.ts:18-23`, together with `packages/database/src/chat-quiz.ts:107-123` and `apps/bot/src/chat-quiz.ts:130-135`.
   - Problem: The SIGINT/SIGTERM handler immediately calls `bot.stop()` while poll-answer middleware can still be awaiting its first database transaction. Installed grammY sets `lastTriedUpdateId` before invoking middleware, and `stop()` immediately sends a final `getUpdates` with that ID plus one. If the pending transaction then rejects, `UnclaimedQuizAnswerError` terminates polling only after the update has already been acknowledged. The new fatal error handler protects the ordinary next-fetch path but cannot undo this shutdown acknowledgement.
   - Why it matters: A normal service restart overlapping a database outage can permanently consume a valid native vote without an AnswerAttempt or an ANSWERING claim. The session remains BOUND, so /quiz directs the learner to an already-voted poll instead of recovering an outcome or offering lease-based replacement. This violates the explicit pre-claim failure and restart recovery requirements in TASK-077 and ADR-007.
   - Independent reproduction: Used the actual `runBot`, actual configured error handler and installed grammY with an entirely injected synthetic transport. Deliver update 41, suspend its poll-answer middleware before a durable claim, emit SIGTERM, then release middleware with `UnclaimedQuizAnswerError`. Observed requests were `deleteWebhook`, `getUpdates(offset=1)`, and `getUpdates(offset=42)`; runBot subsequently rejected with the sentinel. Thus update 41 was acknowledged despite no durable claim/outcome. No real Telegram call or source modification was involved.
   - Required correction: Coordinate signal shutdown with in-flight update processing so a shutdown acknowledgement cannot precede a durable disposition, and a failed pre-claim vote remains unacknowledged for restart. Preserve bounded shutdown, fixed safe errors, post-claim recovery and scheduler cleanup. Add an injected real-grammY lifecycle regression covering SIGTERM/SIGINT during a pending first claim followed by rejection, asserting that no offset acknowledges that vote and restart can receive/process it; retain coverage for successful claims and ordinary shutdown.

### Important

None beyond blocker 1.

### Minor

None.

## Security review

- Private identity, ownership, runtime validation, immutable choice mapping and fixed error logging are sound in the inspected paths. No secrets or auth bypass were introduced.
- Learning data integrity during shutdown requires blocker 1 to be fixed.

## Test review

- Coverage is inadequate for the shutdown/pre-claim overlap described above; existing coverage otherwise exercises the main positive, negative, concurrency and recovery paths.
- Independent `pnpm test tests/chat-quiz.test.ts --maxWorkers=2`: PASS, 12 tests in 1 file.
- Sequential independent `pnpm test:integration tests/chat-quiz.integration.test.ts tests/practice.integration.test.ts`: PASS, 15 tests in 2 files, using the inspected local-only guard and newly isolated databases.
- Independent synthetic lifecycle reproduction: FAIL for the required no-acknowledgement invariant, as recorded in blocker 1.
- `git diff --check`: PASS. Full Supervisor checks are accepted as supplied authoritative evidence, not Builder self-assessment.

## Architecture review

- Compliant with the approved PostgreSQL/grammY identity, service and shared scoring boundaries. No material unrecorded architecture change found.
- ADR-007's durable vote acknowledgement requirement is not fully implemented during signal shutdown.

## Final reviewer statement

`VERDICT: FAIL`. One independently reproduced blocker prevents acceptance. Return the task to Builder for the shutdown correction and regression coverage; rerun required checks and independent review before acceptance or publication. Only this review file was changed by the Reviewer.
