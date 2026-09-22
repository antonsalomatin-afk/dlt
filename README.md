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

### Mock exam persistence boundary

`ExamSession` stores the learner and vehicle together with the policy snapshot
for one mock exam: exactly 50 questions, a per-session passing score, start and
expiry times, and an optional completed score/result tuple. PostgreSQL requires
the pass mark to be from 1 through 50, expiry to follow the start, and completion
fields to be either all null or all present. Completed scores must be from 0
through 50, `passed` must agree with the stored pass mark, and completion cannot
precede the start. Completion may occur after expiry so timeout finalization can
record its result. This persistence layer does not choose a timer duration or
passing score.

`ExamQuestion` fixes a one-based position, source question ID and immutable JSON
snapshot within a session. A session cannot repeat a position or source question;
the same source question can be used by another session. Answers are stored only
as the all-null or all-present tuple of selected choice UUID, correctness and
answer time. The selected choice deliberately has no foreign key to mutable
`QuestionChoice` rows. Deleting a learner or exam cascades through owned exam
data, while a source question referenced by an exam cannot be deleted.

Ordinary checks and foreign keys cannot require exactly 50 `ExamQuestion` rows
per session or prove that an answer belongs to and matches the immutable snapshot.
The exam APIs below enforce cardinality and validate answers against the immutable
snapshot before scoring or returning an authoritative result.

### Import development fixtures

After `pnpm db:start` and `pnpm db:migrate`, run `pnpm content:import`.
The command imports 25 original synthetic questions as inactive drafts, grouped
under named learning concepts, and can be repeated with stable IDs/counts. It only accepts the loopback `.env` database
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

### Mock exam start API

`POST /exam/start` uses the existing opaque bearer session and accepts only an empty
query and the exact JSON object `{}`. Authentication runs before query and body parsing.
Missing, malformed, unknown, revoked, or expired credentials return the uniform
`401 { "error": "Unauthorized" }`. For an authenticated learner, missing or malformed
JSON, null, arrays, duplicate or unknown object members, unsupported content types, and
any query member return `400 { "error": "Bad Request" }`. A learner without a saved
vehicle receives `409 { "error": "Vehicle selection required" }`. Every response uses
`Cache-Control: no-store`.

The approved mock-exam policy is exactly 50 questions, 60 minutes, and a passing score
of 45. One request timestamp becomes `startedAt`; `expiresAt` is exactly 3,600,000
milliseconds later. An owned, incomplete exam whose expiry is strictly later than that
timestamp blocks another start with `409 { "error": "Exam already in progress" }`.
Completed and expired exams do not block a new one.

Eligible questions match the saved vehicle and are both active and `VERIFIED`. The API
reads IDs in stable order with a hard limit of 10,000, then uses a cryptographically
random partial Fisher-Yates sample to select 50 unique questions without replacement.
Fewer than 50 eligible rows returns
`409 { "error": "Not enough questions available" }`; more than 10,000 is treated as
invalid bounded server state and returns the sanitized
`500 { "error": "Internal Server Error" }`. Selection, content validation, session
creation, and all 50 question writes share a serializable transaction with bounded retry
for serialization conflicts. A conflict counts as retryable when it carries Prisma's
write-conflict code or PostgreSQL SQLSTATE `40001` or `40P01` anywhere in its cause
chain, because the pg driver adapter reports a lost serializable transaction as a driver
error rather than a Prisma error code. The losing attempt re-reads the committed session,
so concurrent starts for one learner produce exactly one session and one
`409 { "error": "Exam already in progress" }`; starts by different learners are
independent.

Each selected question is rechecked for eligibility and validated with the same versioned
immutable presentation-snapshot contract used by practice. Invalid, missing, duplicate,
or changed selected content rolls back the whole start. Wording, choices, correct choice,
and explanations are stored in the server-only snapshot, and all answer fields begin null.
Later source edits cannot change an exam already started.

A successful response is exactly
`{ examId, vehicleType, questionCount, passingScore, startedAt, expiresAt, questions }`.
The 50 questions are returned in consecutive position order, and each contains only
`examQuestionId`, `position`, and the safe presented question wording and choices. The
response excludes learner IDs, correct-answer data, correctness, explanations, selected
answers, source/image metadata, and mutable current content. Starting an exam does not
write practice presentations, attempts, history, or progress.

The isolated PostgreSQL integration suite creates and drops a randomly named database,
applies the complete migration chain, and seeds only synthetic local test content. These
fixtures are not official DLT questions and make no claim about official exam wording.

### Mock exam answer API

`POST /exam/answer` uses the same bearer-authenticated, no-store exam boundary. It
accepts an empty query and exactly
`{ "examQuestionId": "<uuid>", "choiceId": "<uuid>" }`; both UUIDs must use the
canonical lowercase form. Authentication and the single request timestamp are captured
before strict query and JSON validation. Invalid credentials return the uniform 401,
invalid input returns `400 { "error": "Bad Request" }`, and an absent or other-user
exam question returns `404 { "error": "Exam question not found" }`.

The owned exam must retain its 50-question, 45-pass, 60-minute policy snapshot and all
50 exam-question rows. Completed, expired, and already answered questions return stable
409 errors in that order. The selected choice must belong to the immutable versioned
snapshot. Scoring compares it only with that snapshot's correct choice, so later edits to
the source question or choices cannot change an exam answer.

One conditional transaction update stores the complete
`{ selectedChoiceId, isCorrect, answeredAt }` tuple. Sequential or concurrent duplicates
therefore persist one result and return `409 { "error": "Answer already submitted" }`
for every loser. Corrupt snapshots, invalid session cardinality, and unexpected write
cardinality fail closed with a sanitized 500 and no partial answer.

Success returns exactly
`{ examId, examQuestionId, selectedChoiceId, answeredAt, answeredCount, remainingCount }`.
It never exposes correctness, the correct choice, score, pass state, explanations, other
questions, or user data. Answer 50 returns counts 50 and 0 but leaves exam completion and
result disclosure for the completion endpoint. Exam answers do not create or modify
practice presentations, answer-attempt history, favorites, or practice progress.

### Mock exam completion API

`POST /exam/complete` uses the same bearer-authenticated, no-store exam boundary.
It accepts an empty query and exactly `{ "examId": "<uuid>" }`, with a canonical
lowercase UUID. Authentication and one request timestamp are captured before strict
query and JSON validation. Invalid credentials return the uniform 401, invalid input
returns `400 { "error": "Bad Request" }`, and an absent or other-user exam returns
`404 { "error": "Exam not found" }` without disclosing ownership.

Completion validates the persisted 50-question, 45-pass, 60-minute policy, all 50
unique consecutive exam-question rows, every immutable snapshot, and every all-null
or all-present answer tuple. Selected choices and stored correctness must agree with
the snapshot; current mutable question content is never read for scoring. Before the
deadline, any unanswered question returns `409 { "error": "Exam incomplete" }` with
no write. At the exact deadline or later, unanswered questions count as incorrect.
The score is the number of validated correct answer tuples, and passing requires at
least 45 correct answers.

One conditional transaction update stores the complete
`{ completedAt, score, passed }` tuple. Repeated and concurrent requests return the
same persisted result without changing its timestamp or values. Corrupt snapshots,
answers, policy, cardinality, or completion state fail closed with the sanitized 500
and no partial update.

Answer submission and completion both lock the owned `ExamSession` row before their
authoritative reads and hold that database lock through their conditional writes. A
pre-expiry answer already admitted at this boundary therefore commits before completion
scores the session; if completion acquires the boundary first, the answer re-reads the
completed state and cannot mutate an exam after finalization.

Success returns exactly
`{ examId, questionCount, answeredCount, unansweredCount, score, passingScore, passed, completedAt }`.
It contains no question, choice, per-question correctness, explanation, source, or
user data. Completion does not create or modify practice presentations, practice
answer history, favorites, or practice progress. Exam history and Mini App exam
screens remain separate work.

### Mock exam result review API

`GET /exam/:examId/result` uses the same bearer-authenticated, no-store exam
boundary and performs no writes. Authentication happens before strict validation.
The path parameter must be one canonical lowercase UUID and the query must be empty;
otherwise the endpoint returns `400 { "error": "Bad Request" }`. An absent or
other-user exam returns `404 { "error": "Exam not found" }` without disclosing
ownership. An owned exam whose completion tuple is not yet persisted returns
`409 { "error": "Exam not completed" }` whether or not its deadline has passed, and
discloses nothing about its questions; completion must be requested first.

The review validates the persisted policy, cardinality, snapshots and answer tuples
with the same rules as completion (shared in `packages/database/src/exam.ts`),
recomputes the summary from the immutable rows, and fails closed with the sanitized
500 when any row or the persisted score/pass result is inconsistent. Current mutable
question and choice content is never read, so later source edits cannot change a
review.

Success returns exactly
`{ examId, vehicleType, questionCount, answeredCount, unansweredCount, score, passingScore, passed, startedAt, expiresAt, completedAt, questions }`.
`questions` holds exactly 50 rows ordered by position, each exactly
`{ examQuestionId, position, question, selectedChoiceId, correctChoiceId, isCorrect, answeredAt, explanationThai, explanationEnglish, explanationRussian, trapExplanationThai, trapExplanationEnglish, trapExplanationRussian }`.
`question` is the presented snapshot wording and four choices. Unanswered rows carry
null `selectedChoiceId`, `isCorrect` and `answeredAt`. No source metadata, image
reference, user data or other exam is returned. Mini App exam screens remain
separate work.

### Mock exam history API

`GET /exam/history` uses the same bearer-authenticated, no-store exam boundary and
performs no writes. It accepts the strict query `{ limit?, cursor? }` with the same
decimal `1`–`50` limit (default 20) and opaque base64url keyset cursor rules as
`/me/history`; malformed input returns `400 { "error": "Bad Request" }` after valid
authentication.

Exams are the authenticated learner's own `ExamSession` rows ordered by `startedAt`
then `id`, newest first. `nextCursor` is present only when more rows exist and
encodes `{ v: 1, startedAt, examId }`. Each row must carry the accepted 50-question,
45-pass, 60-minute policy and an all-null or complete completion tuple; otherwise
the whole request fails with the sanitized 500.

Success returns exactly `{ items, nextCursor }` where each item is exactly
`{ examId, vehicleType, status, questionCount, passingScore, answeredCount, startedAt, expiresAt, completedAt, score, passed }`.
`status` is `COMPLETED` when the completion tuple is persisted, `IN_PROGRESS` when
the exam is open and its deadline is later than the request time, and `EXPIRED`
otherwise. `answeredCount` is the number of exam questions with a persisted answer.
Open exams carry null `completedAt`, `score` and `passed`. No question, snapshot,
choice, explanation, source or user data is returned.

### Practice category API

`GET /practice/categories` uses the existing bearer session and accepts no query
parameters. Authentication runs before strict query validation, followed by the saved
vehicle check. Missing, malformed, unknown, revoked, or expired authentication returns
`401 { "error": "Unauthorized" }`; any query key, including duplicate keys, returns
`400 { "error": "Bad Request" }` for an authenticated user; and a user without a saved
vehicle receives `409 { "error": "Vehicle selection required" }`.

A successful response has the strict shape
`{ "categories": [{ "id", "slug", "nameThai", "nameEnglish", "nameRussian", "questionCount" }] }`.
It includes only categories with at least one active `VERIFIED` question for the user's
saved vehicle. `questionCount` uses that same vehicle, active, and verification filter.
Categories are ordered by `sortOrder` ascending and then unique `slug` ascending; empty
eligibility returns `200 { "categories": [] }`.

The endpoint fetches at most 101 eligible rows. Exactly 100 are returned, while more
than 100 produces the sanitized `500 { "error": "Internal Server Error" }` instead of
silent truncation. Persisted category identity strings must be nonblank and already
trimmed, and counts must be positive integers; malformed output fails as the same
sanitized 500. Every response uses `Cache-Control: no-store`.

### Question presentation API

`POST /practice/next` uses the existing bearer session and accepts no body, `{}`, or
the strict selector `{ "categoryId": "<category UUID>" }`. Omitting `categoryId`
preserves unfiltered practice. `categoryId` must be a UUID; null, arrays, malformed
values, duplicate JSON object members, and unknown body keys return
`400 {error: "Bad Request"}`.
It returns `200 {presentationId, question}` with question ID, Thai/exam-English/English/Russian wording and four choices (ID, A–D key, Thai/English/Russian text). Missing translations remain null. No correctness, explanations, source metadata or image reference is returned. Responses use `Cache-Control: no-store`.

Missing/expired authentication returns `401 {error: "Unauthorized"}`; invalid bodies return `400 {error: "Bad Request"}`; missing vehicle selection returns `409 {error: "Vehicle selection required"}`; an empty eligible bank returns `404 {error: "No questions available"}`. Invalid eligible content returns sanitized `500 {error: "Internal Server Error"}` without storing a presentation.

Selection is an independent uniform random draw from active `VERIFIED` questions for
the saved vehicle; when `categoryId` is present, that category is added to the same
eligibility predicate. Repeats are allowed, and attempt history does not affect selection.
Unknown categories, categories for another vehicle, and categories with no eligible
questions all return the same `404 {error: "No questions available"}` without creating
a presentation, so the endpoint does not reveal category existence or hidden content
state. The eligible count, random offset lookup and snapshot creation share one
repeatable-read transaction. It snapshots question wording, choices, correct choice ID
and explanations into a user-owned
`QuestionPresentation`. Source edits do not alter prior snapshots. Snapshot version 1
is runtime validated; future consumers must use `parsePresentationSnapshot` when
reading persisted JSON. Answer submission is described below.

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

### Favorite a presented question

`POST /practice/favorite` uses the existing bearer session and accepts exactly
`{ "presentationId": "<UUID>", "favorite": true | false }`. Authentication is
checked before JSON parsing. Missing, malformed, unknown or expired credentials
return `401 { "error": "Unauthorized" }`; malformed JSON, duplicate top-level
members, nulls, arrays and unknown keys return `400 { "error": "Bad Request" }`
after valid authentication. Unknown and another learner's presentations both return
`404 { "error": "Presentation not found" }`. All responses use
`Cache-Control: no-store`.

The API resolves ownership with the presentation ID and authenticated user ID in
one database predicate, then validates the stored versioned presentation snapshot
before changing favorites. Corrupt or unsupported snapshots return the sanitized
`500 { "error": "Internal Server Error" }` and leave favorites unchanged.

Setting `favorite` to true atomically creates or updates the learner's single
favorite for that question. A later owned presentation of the same question moves
the favorite's immutable snapshot anchor to that presentation without adding a
second row. Setting it to false idempotently removes the favorite for the presented
question. The ownership lookup, snapshot validation and mutation share one
transaction, and a database uniqueness constraint on learner and question protects
concurrent requests. The database indexes each learner's favorites by update recency,
cascades favorites when that learner is deleted, and prevents deletion of a referenced
question or snapshot anchor while the favorite exists. A composite foreign key requires the
anchor presentation to have the same learner and question as the favorite row, including for
direct database writes. The response is exactly the requested
`{ "presentationId", "favorite" }`; it exposes no favorite ID, owner/question ID,
snapshot, correctness, timestamps or prior-existence state.

### Favorites feed

`GET /me/favorites` uses the existing bearer session and returns only the
authenticated learner's current favorites as
`{ "items": [...], "nextCursor": string | null }`. Authentication runs before
query validation. The optional `limit` must be the canonical decimal form of an
integer from 1 through 50 and defaults to 20. The optional cursor is a bounded,
opaque, versioned base64url value. Unknown or duplicate query parameters,
noncanonical limits, padded or malformed cursors, and unsupported cursor versions
return `400 { "error": "Bad Request" }`. All responses use `Cache-Control: no-store`.

Favorites are ordered by `updatedAt` descending and then favorite ID descending.
Pagination uses that tuple as a keyset and reads one lookahead row, so tied
timestamps remain deterministic. The database query always includes the
authenticated user ID; a cursor is navigation data and never grants access to
another learner's rows.

Each item contains exactly `presentationId`, `favoritedAt`, and the safe presented
question boundary: question ID, localized wording, and four localized choices.
The question is parsed only from the immutable presentation snapshot anchored by
the favorite. Current mutable question content, correctness, explanations, answer
state, favorite/user IDs, and source or image metadata are not returned. Before a
page is returned, the API validates every fetched snapshot, canonical timestamp,
snapshot question ID, and the anchor's learner/question relationship. Corrupt or
unsupported persisted data fails the whole request with the sanitized
`500 { "error": "Internal Server Error" }` response.

Favoriting a newer owned presentation updates the favorite's recency and snapshot
anchor; unfavoriting removes it from later feed reads. Reading the feed does not
change favorite rows.

The Mini App exposes Favorites from both setup and practice. A visible practice
question can be saved once per presentation state; failed saves remain retryable
without changing the selected answer or result. The favorites screen requests ten
immutable snapshots at a time, preserves server order, supports English, Russian and
Thai with English fallback, and removes an item only after the API confirms the exact
presentation. Credentials remain in memory, all browser requests use `no-store`, and
leaving practice or Favorites ignores late request results.

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

### Mistakes feed

`GET /me/mistakes` is the authenticated, attempt-based view of incorrect answers.
It uses the same strict `limit` and opaque `cursor` contract, ordering, response
item fields, error shapes and `Cache-Control: no-store` behavior as answer history.
Authentication runs before query validation. Each returned record is one persisted
`AnswerAttempt` whose `isCorrect` value is false; repeated incorrect presentations
of the same question remain separate items, and a later correct attempt does not
remove an earlier mistake.

The database query applies both presentation ownership and `isCorrect: false`
before rows are returned. Correct attempts, unanswered presentations and attempts
owned by another user are therefore never parsed or filtered in application memory.
Cursors only identify the strict `(submittedAt, attemptId)` navigation boundary and
confer no ownership. Question content, choices, correct answer and explanations come
only from the immutable presentation snapshot, while selection, result and submission
time come from the attempt. Malformed or unsupported snapshots, absent selected
choices, and any contradiction between selection, stored outcome and snapshot fail
the whole request with sanitized `500 { "error": "Internal Server Error" }`.

### Progress summary

`GET /me/progress` uses the existing bearer session and accepts no query
parameters. Authentication runs before strict query validation. Missing, malformed,
unknown, revoked, and expired credentials return the uniform
`401 { "error": "Unauthorized" }`; any query member returns
`400 { "error": "Bad Request" }`. Every response uses `Cache-Control: no-store`.

The response is exactly `{ "answered", "correct", "incorrect", "accuracyPercent" }`.
It summarizes all lifetime submitted practice attempts owned by the authenticated
learner across vehicle types and categories, including repeated attempts of the same
question. Unsubmitted presentations and every other learner's attempts are excluded.
Current vehicle selection and later question activity or verification changes do not
alter the totals.

Correct and incorrect counts come from the persisted server-owned answer outcome in
one ownership-filtered grouped database query. `answered` equals `correct + incorrect`.
For no answers the response is
`{ "answered": 0, "correct": 0, "incorrect": 0, "accuracyPercent": null }`;
otherwise accuracy is `Math.round((correct / answered) * 100)`. The complete result
is runtime validated, and invalid aggregate data or database failures return the
sanitized `500 { "error": "Internal Server Error" }` without a partial summary.

### Concept progress

`GET /me/progress/concepts` uses the same bearer session, empty-query and no-store
rules as `GET /me/progress`. One ownership-filtered grouped query joins the learner's
submitted practice attempts through their presentations to each question's optional
learning concept.

The response is exactly `{ "concepts", "unassigned", "total" }`. Each concept item is
exactly `{ conceptId, slug, nameThai, nameEnglish, nameRussian, answered, correct, incorrect, accuracyPercent }`
with the same count and rounding rules as the lifetime summary; only concepts with at
least one submitted answer appear, and concept IDs are unique. Items are ordered
weakest first: lowest accuracy, then most answered, then slug. `unassigned` summarizes
attempts on questions without a concept and `total` equals the lifetime summary, so
concept counts plus unassigned always reconcile with `GET /me/progress`. The complete
result is runtime validated and invalid aggregates fail with the sanitized 500. No
mastery threshold, scheduling or readiness score is derived.


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
require HTTPS. Explicit same-origin rewrites cover `/auth/telegram`, `/me`,
`/me/vehicle`, `/me/history`, `/me/mistakes`, `/me/favorites`, `/me/progress`,
`/me/progress/concepts`, `/practice/categories`, `/practice/next`,
`/practice/answer`, `/practice/favorite`,
`/exam/start`, `/exam/answer`, `/exam/complete`, `/exam/history` and
`/exam/:examId/result` only.
Set the destination before building; rewrites are
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

Practice is available after saving a vehicle. On every fresh practice view, the Mini App
first requests same-origin `GET /practice/categories` with the in-memory bearer session and
validates the complete response before enabling question delivery. The accessible scope
control defaults to All categories; eligible categories stay in server order and show their
question counts. Category labels follow the English, Russian or Thai practice language.

All categories sends `POST /practice/next` with `{}`, while a selected category sends exactly
`{ "categoryId": "<category UUID>" }`. One learning concept is requested the same way with
exactly `{ "conceptId": "<concept UUID>" }`, using a `conceptId` from
`GET /me/progress/concepts`. The two selectors are mutually exclusive: sending both, a
`null`, a non-UUID, a duplicate member or any unknown key returns
`400 { "error": "Bad Request" }` after authentication and before the vehicle check. A
concept selector is applied in the same eligibility predicate as the saved vehicle, active
and `VERIFIED`, so an unknown concept, a concept whose questions belong to another vehicle
and a concept with nothing eligible are indistinguishable: each returns the same
`404 { "error": "No questions available" }` and creates no presentation. Continue uses the currently selected scope. Scope is
locked while a presented question is unanswered and unlocks after a scored result, allowing
the next request to use another scope without changing the completed result. A filtered 404
keeps its category selected and offers another scope or retry; an unfiltered 404 keeps the
vehicle-level guidance. Category loading has its own retry state, and an empty category list
still permits All categories.

Question delivery and answer submission use the same-origin `/practice/next` and
`/practice/answer` rewrites. English is the default; Russian/Thai question wording and
explanations fall back to English. Answers remain selected after a connection failure so
Retry sends the same IDs. An already-submitted response offers a new question without
reconstructing a score. Sessions stay in memory; expired sessions require reopening from
Telegram.

Authenticated learners can open answer history from vehicle setup or practice. History
loads ten newest submissions at a time, keeps validated entries visible if loading a later
page fails, and retries that page with its same opaque cursor. Entries expand to show the
presented snapshot, stable selected/correct choices, localized explanations and the local
submission time. English is the default; missing Russian or Thai wording falls back to
English. Returning from setup goes back to vehicle setup, while returning from history
opened during practice starts a clean practice view. A protected 401 clears the memory-only
session.

Authenticated learners can also open Mistakes from vehicle setup or practice. It uses
`GET /me/mistakes?limit=10` and the same validated, accessible expansion, localization,
opaque-cursor paging and retry behavior as history. Every visible entry is one immutable
incorrect submitted attempt with stable Your answer and Correct answer labels; a later
correct attempt does not resolve, deduplicate or remove it. Returning preserves the opening
origin, and returning to practice starts a clean practice view. Malformed responses and any
item that claims a correct result are rejected before rendering.

Authenticated learners can open Progress from vehicle setup, even before choosing a
vehicle, or from practice. The view sends one same-origin `GET /me/progress` request on
each mount with the memory-only bearer session, no request body, `no-store`, and the
standard 15-second timeout. It validates the exact lifetime summary before rendering
answered, correct, incorrect, and whole-percent accuracy values. Zero answers show zero
counts, an em dash for accuracy, and start-practicing guidance.

Progress copy and controls can be switched locally among English, Russian, and Thai;
the language choice and response are not persisted. Transport, HTTP, and invalid-response
failures show retry guidance without partial metrics, while a protected 401 clears the
session. Leaving during a request returns immediately and ignores every late outcome.
Returning to setup preserves that origin, while returning to practice mounts a clean
practice view.

Authenticated learners with a saved vehicle can open Mock exam from vehicle setup, and
from practice at any time. The view opens on an intro stating the accepted policy (50
questions, 60 minutes, 45 correct to pass) and a Start exam action that sends exactly one
same-origin `POST /exam/start` with `{}`, the memory-only bearer session, `no-store` and the
15-second timeout. The strict start contract (50 consecutive positions, unique IDs, a
60-minute window, the learner's vehicle) is validated before anything renders. A 409
`Vehicle selection required` returns to setup; `Exam already in progress` and `Not enough
questions available` show specific guidance with retry.

During the exam one positioned question is shown at a time with Previous/Next navigation
over all 50, a live countdown to `expiresAt`, and Answered/Remaining counts taken from the
persisted answer responses. Submit sends exactly `POST /exam/answer`
`{ examQuestionId, choiceId }`; the strict receipt carries no correctness, and a submitted
question stays locked with Your answer marked. No correct answer or explanation is shown
before completion. A selected choice stays selected after a failure so Retry answer resends
the same IDs. `Answer already submitted` locks the question locally, `Exam expired` enters
the time-up state, and `Exam already completed` loads the persisted result.

When the countdown reaches zero or the server reports expiry, answering is disabled and
Finish exam becomes available; otherwise Finish is enabled only once all 50 answers are
saved. Finish sends `POST /exam/complete` `{ examId }` and renders Score, Pass mark,
Answered, Unanswered and Passed/Not passed from the strict summary; `Exam incomplete`
reports the unanswered count. Question wording follows the English/Russian/Thai selector
with English fallback. A protected 401 clears the session, leaving is immediate and ignores
late responses, nothing is persisted in browser storage, and Back returns to the opening
origin. A finished exam offers Review in exam history.

Authenticated learners can open Exams from vehicle setup (even before choosing a
vehicle), from practice, or from a finished exam. The list sends same-origin
`GET /exam/history?limit=10` with the memory-only bearer session and `no-store`,
validates the strict page (status/tuple consistency, unique exam IDs, a canonical
opaque cursor) and renders every exam newest first with its status, start time,
vehicle, answered count or score, and pass mark. Load more sends the exact server
cursor; a failed page is retried with the same cursor while validated items stay
visible. Completed exams offer Review exam; in-progress and expired exams do not.

Review sends `GET /exam/<examId>/result`, validates the strict review (counts and score
equal the rows, consecutive positions, choice membership, correctness identity) and
renders the summary plus all 50 positions with Correct/Incorrect/Unanswered badges,
Your answer and Correct answer labels, and localized explanations with English
fallback. `Exam not completed` shows guidance with retry. A protected 401 clears the
session, leaving is immediate and ignores late responses, and nothing is persisted.

Authenticated learners can open Concepts from vehicle setup, even before choosing a
vehicle, or from practice. The view sends one same-origin `GET /me/progress/concepts` per
mount with the memory-only bearer session, no request body, `no-store` and the standard
15-second timeout. It validates the strict breakdown before rendering: every concept row
must carry at least one answer with counts that sum and the exact rounded accuracy,
concept IDs must be unique, the total must equal the concepts plus the ungrouped bucket,
and the rows must arrive weakest first. Percentages come from the server and are never
recomputed in the browser.

The view shows the lifetime total with the same four metrics as Progress, then one row per
answered concept with its localized name, accuracy and correct-of-answered count, weakest
first. The ungrouped bucket appears only when questions without a concept have answers.
With no answers at all it shows zero totals and start-practising guidance. Copy and
concept names switch between English, Russian and Thai with English fallback, and neither
the language nor the response is persisted. Transport, HTTP and invalid-response failures
show retry guidance with no partial rows, a protected 401 clears the session, and leaving
during a request returns immediately and ignores every late outcome.

No mastery label, readiness figure or review schedule is shown: those are deferred by the
Product Owner decision recorded in `.agent/OWNER_DECISIONS.md`.

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
