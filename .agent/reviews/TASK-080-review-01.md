# TASK-080 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-080.yaml`, including the bounded control-message, migration-expectation and closed-round vehicle clarifications.
- Commits: implementation `6a0fd0028c7036fa8a4d857af305fbefccddf094` against accepted `3fe7e50`; Supervisor authoritative checks `8678e90`. Independently inspected actual source/test/schema/migration diff and relevant surrounding presentation, answer, private-quiz and polling lifecycle code.
- Relevant ADRs: ADR-007 and accepted ADR-008, including its explicit authorized vehicle-selection clarification. Read repository instructions, project, architecture, workflow, definition of done and state.
- Checks supplied: `.agent/checks/TASK-080-checks-01.txt` records fresh lint, types, 369 unit tests/62 files, Prisma validation, local database readiness, 234 integration tests/44 files, production build and diff checks, all exit 0. Builder's separate checks and retained earlier failures are summarized in `.agent/checks/TASK-080-builder-summary-01.txt`.
- Independent checks: `git diff --check`; direct existing-client Vitest run of `group-chat-quiz.test.ts`, `chat-quiz.test.ts` and `bot-shutdown.test.ts`: **31 tests in 3 files PASS**, 2026-10-22 15:15:50 local. No generation, production calls or application edits.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Group command, setup, vehicle and scoped shared question | PASS | Actual grammY suffix routing is exercised. Validated negative chat IDs and topic IDs are separate from positive real-user identities. Bot administration and membership are required; one current scope pointer serializes allocation. Explicit authorized vehicle changes occur only after CLOSED. |
| Separate, exactly-once participant accounting | PASS | Each round/user pair is unique and owns a distinct presentation. The immutable round snapshot feeds the existing atomic practice answer/counter helper. Scope/round/User/presentation lock order, serializable retry and relational constraints prevent duplicate credit and cross-owner/question linkage. |
| Membership and callback trust boundaries | PASS | Real-user vote validation excludes anonymous/retracted/malformed votes. Stored poll binding selects the group; current bot/member checks occur outside transactions. Callback bot/message/topic/current-round binding and starter/admin checks are explicit. Forwarded-member indistinguishability is honestly documented. |
| Delivery, recovery, finish and Next | PASS | SENDING lease/binding, UNCERTAIN explicit replacement, durable CLOSED-before-transport and recoverable feedback retain the accepted protocol. Controls bind a validated returned message ID. No ordinary vote sends a groupwide full answer or private message; finish supplies full explanation and aggregate accuracy. Concurrent Next/vehicle commands cannot replace the resulting open round. |
| Safe polling and retained private behavior | PASS | Group lookup/membership/scoring precommit failures propagate the existing fatal sentinel. The existing early pending/failed acknowledgement barrier covers these paths and both shutdown signals. Known terminal Telegram membership denials do not poison polling; network/429/5xx/unknown failures remain retryable. Private dispatch is reached only after a successful negative group lookup. |
| Additive schema, checks and publication boundary | PASS | One additive migration creates three models with scope/current-round, round/question and owned-presentation foreign keys, required checks and uniqueness. Existing migration-chain assertion gains only the authorized entry. Source/check scope is bounded; deployment remains a separate operational gate. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

PASS. Group identifiers never become learner identities; validated Telegram users upsert the same User without changing vehicle/language/reminder preferences. Queries use Prisma parameterization, API and Mini App authentication/correctness boundaries are unchanged, and no new credential/provider/dependency is introduced. Telegram sends stay outside database transactions. Membership API denials are narrowly recognized from actual GrammyError instances; malformed responses and arbitrary errors are not silently treated as nonmembers. Content protection is forwarding resistance, not proof of vote origin. The group feature does not claim Telegram-native explanations are secret from every unanswered participant.

## Test review

Coverage adequate. Inspected the 16 isolated group integration cases and 13 group unit cases, including two voters/one poll, duplicate/changed-option replay, preference/private-session preservation, scope/control isolation, membership failure handling, uncertain delivery, exact lease expiry, full rollback after the counter write, deactivated question and migration invalidation, owned foreign-key rejection, close/vote race, feedback transport recovery and privileged vehicle switching. Both SIGTERM and SIGINT are tested through actual injected grammY polling with real PostgreSQL scoring and replay remaining one credit. Existing private shutdown regressions remain intact and passed the independent targeted run. No assertions/timeouts were weakened; bounded worker concurrency executes the same suite. Full suites were not unnecessarily repeated by Reviewer.

## Architecture review

Compliant with ADR-008 and the task. The additive group delivery namespace retains private ChatQuizSession semantics and shares server-only scoring instead of forking accounting. Composite foreign keys and one transaction bind each accepted group vote to its owned presentation/attempt/counter. Precommit failure retries are safe under the existing polling barrier; postcommit replay is idempotent. No queue, scheduler, webhook, HTTP authentication path, web/API/content change or production mutation was added.

## Final reviewer statement

`VERDICT: PASS`. TASK-080 implementation satisfies its bounded acceptance criteria with no unresolved findings. Supervisor may accept the code and select an exact release for the separate backup/migration/production rollout. Actual owner group use and live deployment are not established by this code review.
