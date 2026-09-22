# Supervisor handoff — Epic 6 complete, Epic 7 next

TASK-001 through TASK-042 are accepted on branch `claude/nifty-fermi-9yrmoz` (TASK-032 and
earlier are also in `main`). Epics 5 and 6 are complete.

Epic 6 delivered:

- 12 synthetic learning concepts in `content/fixtures/development.json`, linked by the
  importer to `Concept` rows and `Question.conceptId`.
- `GET /me/progress/concepts`, weakest-first per-concept accuracy that reconciles with
  `GET /me/progress`.
- The Mini App Concepts view, reachable from vehicle setup and practice.
- An optional `conceptId` selector on `POST /practice/next`, mutually exclusive with
  `categoryId` and sharing the same uniform private 404.
- A weakest-rule practice scope in the Mini App that drills that concept.

Also fixed in this stretch: concurrent exam starts returned 500 instead of 409 because the
pg driver adapter reports SQLSTATE 40001 as a `DriverAdapterError` rather than Prisma code
P2034. `packages/database/src/transaction.ts` now holds the shared
`isSerializationFailure` predicate; reuse it for any future serializable transaction.

Next: Epic 7 Content Operations. The accepted Product Owner decisions of 2026-09-22 fix
the ground rules: production content is original in-house authored work citing public Thai
traffic law, with no scraping, no third-party bank and no official DLT ingestion without a
new decision. Suggested first task is authored-question provenance and legal citation
requirements, then review status and the reviewer workflow, then bulk import of authored
content. Mastery labelling, spaced repetition and readiness scoring stay deferred in
`.agent/FOLLOW_UPS.md`.

Environment notes: the repo's `tools/database/local.ts` runner is Windows-only; on Linux
start a PostgreSQL 16 cluster manually on 127.0.0.1:55432 with the `.env.example`
credentials. `pnpm check` then fails only the three Windows-only reset-safety tests in
`tests/database-lifecycle.test.ts` (see FOLLOW_UPS.md). Playwright's pinned headless-shell
download is blocked in the cloud environment; link
`/opt/pw-browsers/chromium_headless_shell-<rev>/chrome-headless-shell-linux64/chrome-headless-shell`
to the preinstalled Chromium binary to run `pnpm test:e2e`. No live Telegram bot token is
supplied, by decision. No Product Owner blocker, active automation, or reset-credit
authorization.
