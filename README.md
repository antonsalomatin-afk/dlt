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

## Database package and migrations

`packages/database` contains the PostgreSQL schema and generated Prisma client.
Prisma CLI, client and PostgreSQL adapter use matching pinned version 7.10.0,
following the [Prisma 7 driver adapter setup](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers).
The package exports `createDatabaseClient(connectionString)`; callers must
disconnect their client on shutdown. Telegram identities use PostgreSQL bigint
and JavaScript `bigint`; convert them to strings when a future JSON API needs them.

After installing dependencies and copying `.env.example` to `.env`:

```sh
pnpm db:generate
pnpm prisma validate
pnpm db:start
pnpm db:migrate
pnpm test:integration
```

Generation writes ignored code to `packages/database/generated/`. Typecheck,
unit tests and integration tests regenerate it automatically, so a fresh
checkout does not depend on committed generated code. Generation and unit
checks need no running database. Prisma configuration lives in
`packages/database/prisma.config.ts`; root commands load `.env` explicitly.

`db:migrate` applies committed migrations; repeating it is a no-op when current.
After an intentional local `db:reset`, run `db:start` and `db:migrate` again.
To create a future migration during development, run
`pnpm prisma migrate dev --name descriptive_name`, then review the generated SQL.
These commands do not provision or deploy production infrastructure.

Integration tests require the running, migrated PostgreSQL database and fail
when it is unavailable. They use random test identities and delete only the
specific row created by that run, preserving other application data. Unit tests
remain separate under `pnpm test`; database changes require both commands.

### Question data invariants

Categories and concepts have unique slugs and explicit Thai/English/Russian
names. Questions retain Thai, exam-style English, normalized English and Russian
separately, with optional localized explanations, trap explanations and images.
Unavailable translations and source/review dates can remain null; normalized
English and source type are required. Source metadata records provenance, not
permission to republish. New questions default to inactive and `DRAFT`.

PostgreSQL enforces category/concept references, prevents deleting referenced
categories/concepts, and enforces one choice per stable A–D key per question.
This permits at most four choices. Deleting a question cascades to its choices.
The next import boundary must enforce exactly four choices, exactly one correct
choice, nonempty text, and required publication/review metadata before publishing.
Direct database writes can represent incomplete drafts; the schema alone does
not certify publishable content.

Practice queries must filter `active: true`, `verificationStatus: 'VERIFIED'`,
vehicle type and category; a composite index supports those predicates. Shared
concept IDs group question variants. Choice `isCorrect` is database-only answer
metadata: future delivery DTOs must explicitly select safe fields and omit it
until submission. No delivery endpoint or client DTO exists yet.

### Import development fixtures

After `pnpm db:start` and `pnpm db:migrate`, run `pnpm content:import`.
The command imports 25 original synthetic questions as inactive drafts and can
be repeated with stable IDs/counts. It only accepts the loopback `.env` database
configuration. See [content conventions](content/README.md) for validation,
collision protection and provenance. These fixtures are not official DLT content.

## Telegram bot

`apps/bot` uses grammY. Its factory registers `/start` without network access or
polling. Private chats receive an HTTPS Mini App launch button; groups receive
instructions to open a private chat. Automated tests inject an in-memory
transport and never send Telegram messages.

To run a bot manually when a token and hosted Mini App URL are available, set
server-only `BOT_TOKEN` and `MINI_APP_URL` in ignored `.env`, then run
`pnpm bot:start`. Configuration is checked before polling; missing/invalid values
exit nonzero. Never expose the token in frontend variables or commit it.
The configured URL must use HTTPS without embedded credentials. This task does
not host the Mini App or provision a Telegram bot.

Stop the foreground bot with Ctrl+C (`SIGINT`); `SIGTERM` is also supported.
Shutdown cancels initialization or stops long polling and waits for in-flight
handlers. Fixed error messages avoid logging tokens or raw Telegram payloads.
Live polling contacts Telegram and may reply to users, so use a dedicated
development bot when manually testing. No real token is needed for repository
checks. The lifecycle follows the [grammY bot API](https://grammy.dev/ref/core/bot).

## API authentication (local development)

Run `pnpm db:start`, `pnpm db:migrate`, then `pnpm api:start` with server-only
`BOT_TOKEN` and `DATABASE_URL` in `.env`. The API binds to `127.0.0.1:3001`;
`API_PORT` optionally changes the port. It does not contact Telegram.

`POST /auth/telegram` accepts exactly `{ "initData": "<raw signed data>" }`.
Successful login returns `{ token, expiresAt, user }`, where user contains only
`id`, nullable `username`, nullable `firstName`, and nullable `selectedVehicleType`.
Invalid authentication/body shape returns `401 { "error": "Unauthorized" }`;
malformed HTTP JSON returns a sanitized 400. Internal failures return a sanitized 500.

Use `Authorization: Bearer <token>` for `GET /me`, which returns the same user DTO.
Missing, malformed, unknown, revoked and expired sessions return the same 401.
Sessions expire exactly 24 hours after issuance; equality with expiry is expired.
Only SHA-256 token digests are persisted. Deleting a session revokes it; deleting its
user cascades sessions. Login refreshes Telegram profile and lastSeenAt while preserving
vehicle preference. Repeated signed data within the 300-second validation window is allowed.
Responses disable caching, and this API disables request logging to keep credentials out of logs.
Keep future Mini App tokens in memory; use HTTPS for any nonlocal transport.

`pnpm test:integration` includes synthetic signed authentication requests through Fastify
injection and real PostgreSQL transactions. No live Telegram token is needed for tests.
