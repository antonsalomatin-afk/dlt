# Supervisor handoff — TASK-036 ready

TASK-001 through TASK-035 are accepted on branch `claude/nifty-fermi-9yrmoz` (TASK-032 and earlier are also in `main`). Epic 5 API surface is complete: `POST /exam/start`, `POST /exam/answer`, `POST /exam/complete`, `GET /exam/:examId/result`, `GET /exam/history`.

TASK-035 (Mini App exam start, timed answering and completion) is accepted. TASK-036 (Mini App exam history list and per-question review over GET /exam/history and GET /exam/:examId/result) is refined in .agent/tasks/TASK-036.yaml and READY for Builder assignment.

Environment notes: the repo's `tools/database/local.ts` runner is Windows-only; on Linux start a PostgreSQL 16 cluster manually on 127.0.0.1:55432 with the `.env.example` credentials. `pnpm check` then fails only the three Windows-only reset-safety tests in `tests/database-lifecycle.test.ts` (see FOLLOW_UPS.md). Playwright's pinned headless-shell download is blocked here; link /opt/pw-browsers/chromium_headless_shell-<rev>/chrome-headless-shell-linux64/chrome-headless-shell to the preinstalled Chromium binary to run `pnpm test:e2e`. No Product Owner blocker, active automation, or reset-credit authorization.
