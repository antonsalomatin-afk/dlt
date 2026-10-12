# TASK-066 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-066` — Deliver daily Telegram reminders
- Commit(s): `e4815a77692d928d45f736511e74d6414f2c1c74` and fix `9c20ffffd70d5f7f2ff65e0036901034585c8493`
- Relevant ADR(s): `ADR-006-daily-reminder-scheduler.md`
- Checks supplied: `.agent/checks/TASK-066-checks-02.txt` (`pnpm check`, `pnpm prisma validate`, and `pnpm test:integration` all passed)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Server-only scheduler sends at the fixed 11:00 ICT boundary and derives the ICT date | PASS | `isReminderTick` and `thailandReminderLocalDate` use a fixed UTC+07:00 offset, and focused clock tests cover the boundary and date rollover. |
| Enabled recipients receive strict deterministic language-specific further-training messages | PASS | Recipient selection is server-side and selects only enabled users; the message map covers the three persisted enum values. |
| Completion does not suppress an enabled reminder and the configured HTTPS Mini App button is included | PASS | The scheduler does not read daily completion state and always builds the configured grammY web-app button. |
| Ledger prevents duplicate delivery while failed sends remain retryable | FAIL | The send and `markReminderDeliverySent` operations share one catch block. If Telegram accepts the message but the subsequent sent-state write throws, the code attempts to mark the row `FAILED`; a later tick retries the message and can send a duplicate. |
| Startup/shutdown are explicit and imports have no side effects | PASS | Scheduler startup is wired through `runBot`, shutdown awaits the active tick, and importing the bot modules does not start polling or scheduling. |
| Failures are safe and isolated | PASS | User-facing delivery errors are caught per recipient and logs are fixed strings without identifiers, message content, tokens or database URLs. |
| Automated coverage covers the required behavior and preserves existing contracts | FAIL | The new bot tests assert only THAI message text. They do not assert English and Russian payloads, the enabled-only query predicate, or completion-non-suppression behavior. The fake `user.findMany` ignores its query, so the eligibility contract is not exercised. |
| Migration and documentation match the policy | PASS | The additive migration, unique user/date key, exact status enum, migration-chain assertion and README policy are present and the supplied integration checks pass. |

## Findings

### Blockers

1. **A sent message can be converted into a retryable failure**
   - Severity: blocker
   - File: `apps/bot/src/reminders.ts`
   - Problem: The `try` block contains both `options.api.sendMessage(...)` and `markReminderDeliverySent(...)`. A successful Telegram send followed by a database error enters the `catch`, calls `markReminderDeliveryFailed`, and leaves the ledger retryable. The next scheduler tick can send the same reminder again, violating the at-most-one delivery requirement.
   - Why it matters: The database update is not transactional with the external Telegram side effect. The implementation must preserve the ledger's no-duplicate safety when the post-send state update fails.
   - Required correction: Separate the Telegram send failure path from the sent-state write path. Only a rejected Telegram send may transition a claimed row to `FAILED`; a failure or false result from the post-send sent-state update must never mark the row retryable. Add a regression test that makes `markReminderDeliverySent` fail after `sendMessage` succeeds and asserts no second send occurs.

### Important

1. **Required recipient and language coverage is incomplete**
   - Severity: important
   - File: `tests/bot-reminders.test.ts`
   - Problem: The test suite exercises a THAI message and uses English/Russian recipients only for failure isolation, without asserting their exact localized messages. Its fake `findMany` ignores the `where` and `select` arguments, so disabled users and the server-owned eligibility predicate are not tested. No test demonstrates that a completed daily question does not suppress delivery.
   - Why it matters: These are explicit TASK-066 automated-coverage requirements and are the boundaries most likely to regress when the scheduler is changed.
   - Required correction: Add focused assertions for all three exact localized payloads, make the fake database honor or inspect the enabled-only selection, and add a completed-daily-question fixture/assertion showing delivery still occurs without completion claims in the message.

### Minor

None.

## Security review

- PASS. Bot configuration is validated before scheduler/database startup, the bot token remains server-side, and error logs use fixed safe strings.

## Test review

- coverage inadequate
- missing scenarios: post-send ledger-write failure and duplicate prevention; exact English and Russian message payloads; disabled-user exclusion; completed-question non-suppression.
- Independently reran `pnpm exec vitest run tests/bot-reminders.test.ts tests/reminder-delivery.integration.test.ts`: 1 file, 3 tests passed.

## Architecture review

- compliant with ADR-006. The change remains in the server-only bot and PostgreSQL boundaries, adds no queue or external dependency, and stays within `TASK-066` files_allowed.

## Final reviewer statement

The fixed ICT boundary, server-only selection, language mapping, migration and lifecycle wiring are sound, but the post-send database failure path can cause duplicate Telegram delivery. The required coverage also does not demonstrate all explicit eligibility and language cases. The Builder must address the blocker and complete the focused tests before acceptance.

`VERDICT: FAIL`
