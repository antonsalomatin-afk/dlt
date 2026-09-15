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
and Vitest tests. Workspace packages live in `apps/*` and
`packages/*`, including the API, bot and Mini App.
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
until submission. The presentation endpoint below uses an explicit safe DTO.

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
`PATCH /me/vehicle` uses the same session and accepts exactly
`{ "vehicleType": "CAR" }` or `{ "vehicleType": "MOTORCYCLE" }`. It persists the
authenticated user's preference and returns the user DTO with caching disabled.
`GET /me` reflects the selection. Invalid values, missing fields and extra fields
return `400 { "error": "Bad Request" }` without changing the user.
Missing, malformed, unknown, revoked and expired sessions return the same 401.
Sessions expire exactly 24 hours after issuance; equality with expiry is expired.
Only SHA-256 token digests are persisted. Deleting a session revokes it; deleting its
user cascades sessions. Login refreshes Telegram profile and lastSeenAt while preserving
vehicle preference. Repeated signed data within the 300-second validation window is allowed.
Responses disable caching, and this API disables request logging to keep credentials out of logs.
Keep future Mini App tokens in memory; use HTTPS for any nonlocal transport.

`pnpm test:integration` includes synthetic signed authentication requests through Fastify
injection and real PostgreSQL transactions. No live Telegram token is needed for tests.

### Question presentation API

`POST /practice/next` uses the existing bearer session and accepts no body or `{}`.
It returns `200 {presentationId, question}` with question ID, Thai/exam-English/English/Russian wording and four choices (ID, A–D key, Thai/English/Russian text). Missing translations remain null. No correctness, explanations, source metadata or image reference is returned. Responses use `Cache-Control: no-store`.

Missing/expired authentication returns `401 {error: "Unauthorized"}`; invalid bodies return `400 {error: "Bad Request"}`; missing vehicle selection returns `409 {error: "Vehicle selection required"}`; an empty eligible bank returns `404 {error: "No questions available"}`. Invalid eligible content returns sanitized `500 {error: "Internal Server Error"}` without storing a presentation.

Selection is the first active VERIFIED question for the selected vehicle ordered by ID; repetitions are possible. A repeatable-read transaction snapshots question wording, choices, correct choice ID and explanations into a user-owned `QuestionPresentation`. Source edits do not alter prior snapshots. Snapshot version 1 is runtime validated; future consumers must use `parsePresentationSnapshot` when reading persisted JSON. Answer submission is described below.

The practice integration suite creates a temporary randomly named database, applies the full migration chain and drops only that database after testing. The local integration database role therefore needs permission to create databases. Imported development fixtures are never activated by this endpoint or its tests.

### Submit a practice answer

`POST /practice/answer` uses the existing bearer session and accepts only
`{ "presentationId": "<UUID>", "choiceId": "<UUID>" }`. A successful200 response
contains `presentationId`, `selectedChoiceId`, `correctChoiceId`, `isCorrect`,
`explanationThai`, `explanationEnglish`, `explanationRussian`,
`trapExplanationThai`, `trapExplanationEnglish`, and `trapExplanationRussian`.
The six explanation fields are nullable. Grading and explanations use the validated
versioned presentation snapshot, even after source questions or choices change.

Missing/invalid/expired authentication returns401 `{ "error": "Unauthorized" }`.
Malformed bodies or choices absent from the snapshot return400
`{ "error": "Bad Request" }`; unknown and foreign presentations both return404
`{ "error": "Presentation not found" }`. A repeated valid owned submission returns409
`{ "error": "Answer already submitted" }`. Corrupt snapshots and unexpected failures
return sanitized500 `{ "error": "Internal Server Error" }`. All responses use
`Cache-Control: no-store`. Validation precedes insertion: an unknown choice remains400
even on an already answered presentation. Each presentation has at most one persisted
answer, enforced by a database unique constraint, including concurrent requests.
Ownership/snapshot checks, answer insertion and result validation share one transaction;
failed submissions cannot change an existing answer. Selected choice UUIDs refer to
snapshot choices, so they deliberately have no foreign key to mutable source choices.
The practice integration test applies the full migration chain to a fresh isolated database.

### Answer history

`GET /me/history` uses the existing bearer session and returns the authenticated
learner's submitted answers as `{ "items": [...], "nextCursor": string | null }`.
Authentication is checked before query validation. Missing, malformed, unknown,
revoked and expired credentials return the same `401 { "error": "Unauthorized" }`.
All responses use `Cache-Control: no-store`.

The only query parameters are optional `limit` and `cursor`. `limit` defaults to
20 and accepts canonical unsigned decimal integers from 1 through 50. Empty,
signed, fractional, padded, duplicate or out-of-range values, unknown parameters,
and invalid cursors return `400 { "error": "Bad Request" }`. Cursors are opaque,
unpadded base64url UTF-8 JSON with version, submission timestamp and attempt ID.
They are limited to 512 characters, strictly validated and canonicalized, and do
not grant access to another user's records.

Items are ordered by submission time descending, then answer-attempt ID descending.
Pagination uses that tuple as a strict keyset boundary and returns a cursor for the
last item only when another item exists. An empty history is
`{ "items": [], "nextCursor": null }`.

Each item contains `presentationId`, ISO `submittedAt`, `selectedChoiceId`,
`correctChoiceId`, `isCorrect`, the complete presented question DTO, and the six
nullable explanation/trap fields. Wording, choices, the correct answer and
explanations come from the persisted versioned presentation snapshot; later source
edits cannot change history. Selection, correctness and submission time come from
the persisted answer attempt. Unanswered presentations and other users' attempts
are excluded in the database query. A malformed/unsupported snapshot, a selected
choice absent from its snapshot, or inconsistent stored correctness fails the whole
request with sanitized `500 { "error": "Internal Server Error" }`.

The history integration suite uses a fresh temporary PostgreSQL database and covers
authentication, strict queries, deterministic pagination, ownership, unanswered
presentations, snapshot stability and corrupt stored data.


## Mini App (local development)

`apps/web` is the Next.js / React / Tailwind Mini App. Run `pnpm web:dev`
from the root and open http://127.0.0.1:3000. Run the API in a separate
terminal using the API setup above. A regular browser shows Telegram launch
guidance; authentication requires signed raw data supplied by Telegram.
There is no development login bypass.

The server-only `API_ORIGIN` defaults to `http://127.0.0.1:3001`. To override,
set it in your shell (PowerShell: `$env:API_ORIGIN = 'http://127.0.0.1:3001'`)
or in ignored `apps/web/.env.local`. The root `.env` is used by API/database
commands, not automatically loaded by Next. Only HTTP(S) origins without
credentials, paths, query strings or fragments are accepted; nonlocal origins
require HTTPS. Explicit same-origin rewrites cover `/auth/telegram`, `/me`
and `/me/vehicle` only. Set the destination before building; rewrites are
included in the production build. Never prefix secrets with `NEXT_PUBLIC_`.

The official Telegram bridge loads before authentication. Login and vehicle
responses are runtime validated. Bearer sessions remain in memory and disappear
on reload or protected 401. Saved vehicle preferences come from the API.

`pnpm build` makes a production web build; `pnpm web:start` serves it locally.
For browser checks, run `pnpm exec playwright install chromium` once, then
`pnpm build` and `pnpm test:e2e`. Tests start the production server on port3000
(which must be free), intercept Telegram/API traffic only in the test harness,
and need no API, database or live Telegram credentials. `pnpm check` also checks
web TypeScript and tests API-origin validation. Integration checks remain
`pnpm test:integration` against local migrated PostgreSQL.

Practice is available after saving a vehicle. The Mini App requests same-origin
`POST /practice/next` and `/practice/answer` through the explicit API rewrites.
English is the default; Russian/Thai wording and explanations fall back to English.
Answers remain selected after a connection failure so Retry sends the same IDs.
An already-submitted response offers a new question without reconstructing a score.
Sessions stay in memory; expired sessions require reopening from Telegram.

### Real local full-stack browser gate

Run `pnpm db:start`, ensure the local role in ignored `.env` has CREATE DATABASE
permission, and install Chromium once with `pnpm exec playwright install chromium`.
Then run `pnpm test:fullstack` from the repository root. This opt-in gate generates
Prisma, creates a random `fullstack_test_` database, applies every committed
migration, seeds synthetic verified content only there, builds Next with
`API_ORIGIN=http://127.0.0.1:3101`, and starts real API/web processes on loopback
ports3101/3100. Both ports must be free; existing listeners are never stopped.

The mobile Chromium browser mocks only the official Telegram bridge script,
which supplies freshly signed synthetic initData. Authentication, vehicle saving,
question delivery and scoring use real HTTP through Next rewrites and PostgreSQL.
Assertions cover correct/incorrect results, explanations, ownership, one answer per
presentation and continuation. Screenshots are saved under
`test-results/fullstack/`. This verifies synthetic local integration, not a live
Telegram launch or production configuration; no real bot token is needed.

Cleanup runs after success or failure, closes the browser, stops and awaits only
owned Node children, disconnects clients and drops only the exact database created
by that run. Setup/test/cleanup failures return nonzero, with safe phase diagnostics
instead of raw credential-bearing errors. Forced termination of the runner or OS
can prevent cleanup; a reported cleanup failure includes its exact database name
for inspection. Never reset the normal database to clean up this test.

The full-stack build replaces the local web build. Before normal local use,
rebuild with your intended `API_ORIGIN` (default port3001). Run quality gates
sequentially: `pnpm check`, `pnpm build`, `pnpm test:e2e`,
`pnpm test:integration`, `pnpm test:fullstack`. The existing mocked browser suite
and ordinary unit/integration suites remain separate.
