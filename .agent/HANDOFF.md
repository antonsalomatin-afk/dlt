# Supervisor handoff — Epic 6 in progress

TASK-001 through TASK-037 are accepted on branch `claude/nifty-fermi-9yrmoz` (TASK-032 and earlier are also in `main`). Epic 5 (Mock Exam) is complete end to end:

- API: `POST /exam/start`, `POST /exam/answer`, `POST /exam/complete`, `GET /exam/:examId/result`, `GET /exam/history`.
- Mini App: Mock exam (intro, timed answering, finish and result), Exams (history list and per-question review), reachable from setup, practice and a finished exam.

Epic 6 has started: TASK-037 grouped the 25 development fixtures under 12 synthetic learning concepts (`content/fixtures/development.json`, `tools/content/fixtures.ts`). Next is TASK-038, a concept-aware progress API (per-concept answered/correct/accuracy from the learner's practice history, joining AnswerAttempt → QuestionPresentation → Question.conceptId), which PROJECT.md principle 4 supports. Spaced repetition and a readiness score are recorded as a Pending Product Owner decision in `.agent/OWNER_DECISIONS.md`; do not start them without that decision.

Environment notes: the repo's `tools/database/local.ts` runner is Windows-only; on Linux start a PostgreSQL 16 cluster manually on 127.0.0.1:55432 with the `.env.example` credentials. `pnpm check` then fails only the three Windows-only reset-safety tests in `tests/database-lifecycle.test.ts` (see FOLLOW_UPS.md). Playwright's pinned headless-shell download is blocked in the cloud environment; link `/opt/pw-browsers/chromium_headless_shell-<rev>/chrome-headless-shell-linux64/chrome-headless-shell` to the preinstalled Chromium binary to run `pnpm test:e2e`. No Product Owner blocker, active automation, or reset-credit authorization.
