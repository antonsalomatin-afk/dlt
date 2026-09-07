# ThaiDLT

A Telegram-first driving-theory learning product. Product scope and engineering
workflow are recorded in `.agent/`; read `AGENTS.md` before contributing.

## Developer setup

Install Node.js 24 LTS and pnpm 11.19.0 (the version pinned in `package.json`).
If pnpm is not installed, run `npm install --global pnpm@11.19.0`.

From the repository root:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm check
```

Use `pnpm install --frozen-lockfile` for reproducible installs in automated checks.
The default quality checks need no running database or external services.

The root currently runs ESLint, a strict TypeScript check of the repository tests,
and a Vitest sanity test. Workspace packages will live in `apps/*` and
`packages/*` as their tasks require them; no application is implemented yet.
New TypeScript packages should extend `tsconfig.base.json` and connect their
checks to the root scripts when introduced.

## Quality gates and formatting

`pnpm check` runs lint, typecheck, then tests in that order. It stops on the
first failure and returns a nonzero exit status. Each gate can also run alone.
Tests run once (no watch mode). Use the pinned pnpm version and frozen lockfile
in CI to run the same checks as local development.

Use two-space indentation, single quotes and semicolons in TypeScript and
JavaScript, trailing commas in multiline lists, and a final newline. JSON uses
double quotes and no trailing commas. Keep Markdown readable in source and
avoid unrelated formatting changes. This is a documented review policy;
ESLint checks code correctness and does not enforce all formatting choices.

To verify failure propagation safely, create only one temporary probe below
under `tests/` at a time, run `pnpm check`, and confirm a nonzero exit code.
Remove each probe before creating the next, then confirm `pnpm check` passes.
Never commit the probes.

| Probe filename | File contents | Expected failing gate |
| --- | --- | --- |
| `gate-probe.ts` | `export const probe: any = 1;` | lint (`no-explicit-any`) |
| `gate-probe.ts` | `export const probe: string = 1;` | typecheck (lint passes) |
| `gate-probe.test.ts` | `import { expect, it } from 'vitest'; it('probe', () => { expect(1).toBe(2); });` | test (lint and typecheck pass) |

Inspect `$LASTEXITCODE` in PowerShell or `$?` in a POSIX shell immediately after
the command. The output should show that gates after the failure did not run.

## Local PostgreSQL (Windows x64)

The native development runner currently supports Windows x64 with Node 24.
`pnpm install` supplies pinned PostgreSQL 18.4 binaries through
`embedded-postgres`; its Windows binary package has a narrowly approved install
script. Docker, administrator privileges, OS users and Windows services are
not required. This is development tooling only.

Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`), then:

```sh
pnpm db:start
pnpm db:ready
pnpm db:stop
pnpm db:reset
```

Start initializes the cluster if necessary, starts a background server, creates
the configured database if missing, and checks it with an authenticated query.
Ready performs an authenticated `SELECT 1` with five-second connection/query
timeouts. Stop uses PostgreSQL's graceful fast shutdown (disconnecting clients).
Reset stops the cluster and **deletes all local development database data**;
run start again to initialize an empty cluster. Repeated stop/reset are safe.
Run lifecycle commands sequentially, never concurrently.

`DATABASE_URL` is the sole required variable. Its host must be `127.0.0.1`, port
must be 1024–65535 (default example: 55432), and user/database identifiers must
start with a lowercase letter and contain only lowercase letters, digits or
underscores (maximum 63 characters). Passwords must be nonempty and URL-encoded
when needed; newline/NUL characters and URL query/fragment options are rejected.
The server binds only to IPv4 loopback and uses SCRAM password authentication.
Example credentials are public local-only examples. Never use production
credentials. Node loads `.env`, with existing process environment taking precedence.
Changing initialized cluster credentials requires a reset; changing the port
requires stop then start. A stopped database makes ready return nonzero.

Data stays under the fixed gitignored `.local-postgres/cluster` directory;
server diagnostics are in `.local-postgres/server.log`. An ownership marker and
directory link checks prevent reset from deleting unmanaged or redirected data.
Initialization briefly writes the local password to a gitignored file and
removes it in a finally block. Keep this workspace private to your OS account.
The runner returns nonzero on configuration, process or connection failure and
suppresses raw subprocess/database errors to avoid printing credentials.
