# TASK-066 Review 02

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-066` — Deliver daily Telegram reminders
- Commit(s): `e4815a77692d928d45f736511e74d6414f2c1c74`, fix `9c20fff`, fix `b0c16df`
- Relevant ADR(s): `ADR-006-daily-reminder-scheduler.md`
- Checks supplied: `.agent/checks/TASK-066-checks-03.txt` (`pnpm check`, `pnpm prisma validate`, and `pnpm test:integration` all passed)
- Focused checks independently run: `pnpm exec vitest run tests/bot-reminders.test.ts tests/bot.test.ts` (2 files, 15 tests passed)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Server-only scheduler sends at the fixed 11:00 ICT boundary and derives the ICT date | PASS | `isReminderTick` and `thailandReminderLocalDate` use a fixed UTC+07:00 offset, with boundary and date-rollover coverage. |
| Enabled recipients receive strict deterministic language-specific further-training messages | PASS | Recipient selection is server-side and filters `dailyQuestionReminderEnabled: true`; English, Russian and Thai payloads are deterministic and covered. |
| Completion does not suppress an enabled reminder and the configured HTTPS Mini App button is included | PASS | Selection does not inspect completion state; the completed fixture still receives the invitation and the grammY web-app button is asserted. |
| Ledger prevents duplicate delivery while failed sends remain retryable | PASS | Unique user/date claims, conditional retry claims, and concurrent integration coverage are present. A successful send followed by failed SENT confirmation remains `CLAIMED` and is not retried; the regression test covers this prior blocker. |
| Startup/shutdown are explicit, testable and safe when the bot is stopping | FAIL | `scheduleTick` starts a new `tick()` even when `activeTick` is still running, then overwrites `activeTick`. `stop()` awaits only the latest promise. An older tick can finish `sendMessage` and call `markReminderDeliverySent` after `stop()` returns and `main.ts` disconnects Prisma. |
| Failures are safe and isolated | PASS | Per-recipient errors continue processing, and all scheduler/configuration logs are fixed strings without tokens, database URLs, learner identity or message content. |
| Automated coverage covers the required behavior and preserves existing contracts | FAIL | The supplied coverage exercises normal shutdown, but no test holds one send open while a second interval tick starts and verifies that shutdown waits for both. The race above is therefore unguarded. |
| Migration and documentation match the policy | PASS | The additive ledger migration, uniqueness/status constraints, migration-chain assertion and README policy match 11:00 ICT and completion-non-suppression. |

## Findings

### Blockers

1. **Shutdown can leave an older reminder tick running**
   - Severity: blocker
   - File: `apps/bot/src/reminders.ts`
   - Problem: `scheduleTick` assigns `activeTick = tick().catch(...)` on every interval without checking whether a previous tick is still pending. A later interval therefore replaces the only promise retained by `stop()`. `stop()` can await the newer tick, return, and let `main.ts` disconnect the database while the older tick is still awaiting Telegram or about to execute `markReminderDeliverySent`.
   - Why it matters: The task explicitly requires safe scheduler shutdown. With a sufficiently large recipient set or a slow Telegram response, process shutdown can race an in-flight database write, leaving a sent delivery stuck as `CLAIMED` and producing post-shutdown errors. It also makes the injected interval seam unsafe under the exact overlap it is intended to test.
   - Required correction: Prevent overlapping ticks, or retain and await every in-flight tick before `stop()` resolves. Add a regression test with an injected interval and a deferred `sendMessage` that starts a second interval tick, invokes `stop()`, and asserts shutdown remains pending until the original send and ledger confirmation complete.

### Important

None.

### Minor

None.

## Security review

- PASS. Bot credentials remain server-side, configuration is validated before database startup, and delivery errors use fixed safe logs.

## Test review

- coverage inadequate for the shutdown overlap case
- missing scenarios: an interval tick overlapping an in-flight delivery; shutdown waiting for every in-flight tick before database disconnect.

## Architecture review

- compliant with ADR-006. The implementation remains inside the server-only bot and PostgreSQL boundaries and does not add Redis, BullMQ, an API proxy or browser delivery logic.

## Final reviewer statement

The prior send/confirmation retry defect is corrected, and the language, eligibility, ICT boundary, ledger, migration, failure-isolation and policy requirements are otherwise satisfied. The scheduler still permits overlapping ticks while tracking only one active promise, so shutdown is not safe under a slow or large delivery batch. The Builder must serialize ticks or await all in-flight ticks and add the corresponding regression coverage before acceptance.

`VERDICT: FAIL`
