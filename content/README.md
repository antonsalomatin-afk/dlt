# Development content

`fixtures/development.json` contains exactly 25 original synthetic questions in
five categories and exactly 10 original synthetic learning concepts. These are
software development examples, not an official DLT bank or taxonomy, licensed
third-party material, legal guidance, or verified translations. The exam-English
example is explicitly synthetic. Do not use this dataset as evidence of actual
Thai examination rules or readiness.

Each concept has a stable human-readable key and nonblank, whitespace-normalized
Thai, English and Russian names. Every question references exactly one declared
concept, every concept groups at least two question variants, and the complete
set continues to cover all five categories and both vehicle types. Concept keys
and groupings describe only this development dataset.

Each question has a stable human-readable ID. The importer derives stable UUIDs
from question IDs, concept keys and the fixed `thaidlt-development-v1` namespace.
Concept slugs are `fixture-<key>`; category and choice IDs are also deterministic.
Keep question IDs and concept keys unchanged when editing a fixture.

The importer validates the entire document before writing: exactly 25 unique
questions, all five categories, both vehicles, nonempty text, strict allowed
fields, exactly 10 unique localized concepts, declared question assignments,
at least two variants per concept, A–D once each, one correct choice, and a
complete multilingual example. Every imported question remains `FIXTURE`,
inactive and `DRAFT`; no review or legal-verification claim is created.

Run `pnpm content:import` after the documented database setup. This accepts no
file or destination arguments and requires the loopback-only `.env` convention.
It reports the imported 10 concepts, 5 categories, 25 questions and 100 choices.
The whole import is one serializable transaction. Reimport updates matching
inactive draft fixtures while preserving IDs and counts. Omitted optional wording
fields become null on the matching fixture. It does not remove old records
when IDs change. Category or concept identity, slug or localized-name conflicts,
conflicting non-null question concept assignments, nonfixture/protected question
collisions and foreign choice-ID collisions abort the entire import. An existing
deterministic fixture question with no concept is upgraded to its expected
concept. Existing categories and concepts with exact matching identities and
names are reused without modification. Unrelated records are never reset or
deleted. Concurrent conflicts fail; retry after the other operation completes.

## Candidate import batches

`imports/example-candidate-batch.json` is a small, fully synthetic version 1
candidate batch. It exists only to demonstrate the format. It makes no claim
about DLT wording, legal rules, translation accuracy, permission to republish,
or review status.

Validate one explicitly supplied local JSON file offline:

```sh
pnpm content:validate -- content/imports/example-candidate-batch.json
```

The command accepts exactly one nonblank path, reads no more than 5 MiB as
UTF-8, makes no database or network request, and performs no write. Success
prints only the batch ID, version, question count and choice count. Failure
prints `Candidate batch validation failed.` followed by at most 20 safe,
path-based diagnostics and exits nonzero. Paths that cannot be read, malformed
JSON, oversized files and invalid batches fail without printing source content.
This validator is separate from `content:import`, which continues to accept only
the fixed development fixture.

A version 1 document is a strict object with these fields:

- `batchId`: 1–64 characters, using lowercase letters, digits and single
  hyphen-separated segments;
- `version`: the number `1`;
- `createdAt`: a canonical UTC timestamp such as
  `2026-09-30T00:00:00.000Z`;
- `questions`: 1–500 strict question objects.

Every question has a unique `externalId` following the same key rule,
`vehicleType` (`CAR` or `MOTORCYCLE`), and lowercase `categorySlug` and
`conceptSlug` references of at most 64 characters. Slugs are candidate
references only: offline validation checks their shape, while a later importer
must resolve them against existing taxonomy and reject missing or conflicting
records before writing.

Question wording fields are `textThai`, `textExamEnglish`, `textEnglish` and
`textRussian`. `textEnglish` is required; the others are strings or `null`.
Explanation fields are `explanationThai`, `explanationEnglish`,
`explanationRussian`, `trapExplanationThai`, `trapExplanationEnglish` and
`trapExplanationRussian`, each a string or `null`. Every present string is
trimmed, nonblank and at most 4,000 characters. Normalized wording may not
duplicate another question in the same language field.

`choices` contains exactly four strict objects. Each contains `key`,
`textThai`, `textEnglish` and `textRussian`; keys A–D occur exactly once,
English is required, and Thai/Russian are strings or `null`. Normalized choice
wording may not repeat within the same language field. `correctChoiceKey` names
one supplied choice. Choice correctness flags and database IDs are prohibited.

`source` is exactly `{ type, reference, sourceDate, legalCitation }`.
`reference` is a trimmed, nonblank string of at most 2,048 characters.
`ORIGINAL` requires a traceable `internal:` reference and permits a null date
and citation. `OFFICIAL` and `THIRD_PARTY` require a canonical `YYYY-MM-DD`
date and a nonblank citation. `FIXTURE` is prohibited. These checks establish
metadata presence and shape only; they do not establish permission, official
accuracy, legal sufficiency or verification.

Unknown fields are rejected at every level, including persistence and admin
fields such as IDs, `active`, `verificationStatus`, reviewer data and database
timestamps. URLs remain inert reference text and are never fetched or executed.
Validation does not activate, approve or import anything.

### Import validated candidates

After creating the referenced categories and concepts and starting the local
database, import one validated batch with:

```sh
pnpm content:import-candidates -- path/to/candidate-batch.json
```

The command accepts exactly one nonblank local path and performs the same 5 MiB,
fatal-UTF-8, JSON and strict version 1 validation before reading database
configuration or creating a client. `DATABASE_URL` must pass the existing
loopback-only policy. Importing never fetches a source URL and never changes or
creates taxonomy.

Every distinct `categorySlug` and `conceptSlug` must already exist. The entire
batch runs in one serializable transaction. A missing taxonomy reference,
identity collision or persistence failure rolls back every candidate in that
batch and preserves unrelated and development-fixture data.

Question IDs are deterministic within a candidate-only namespace containing
the format version, `batchId` and `externalId`; choice IDs derive from that
question identity and A–D key. A first import stores the candidate's exact
wording, explanations, source metadata, four choices and answer key. It always
sets `active` false, `verificationStatus` to `DRAFT`, and image, reviewer and
review timestamps to null. Import does not verify, reject, approve or activate
content.

Batch identity is immutable. Reimporting the exact same validated content is
a safe no-op and reports matched records. If any persisted candidate field,
taxonomy relation, choice, answer, inactive/DRAFT state or review field differs,
the complete import fails without updating or deleting anything. Changed
content requires a new batch identity or external ID and a separate review.

Success reports only the batch ID, new and matched question/choice counts, and
the inactive-DRAFT boundary. Every failure prints the single generic message
`Candidate import failed. No candidate content was imported.` and exits
nonzero; credentials, SQL, source wording and local file contents are omitted.
This is still a candidate intake step. Independent content and legal review is
required before any later activation or verification transition.

### Record candidate review decisions

`imports/example-candidate-review.json` is a fully synthetic review-manifest
example for the synthetic candidate batch. It is documentation only and is not
applied to repository or production data. A review manifest records an
operator assertion; it does not establish legal permission, official accuracy,
translation accuracy or approval to activate content.

After importing the exact candidate batch, apply a review manifest with:

```sh
pnpm content:review-candidates -- path/to/candidate-batch.json path/to/review-manifest.json
```

The command accepts exactly two nonblank local JSON paths. It reads both files
through the same 5 MiB, fatal-UTF-8 boundary and strictly validates the complete
candidate batch, manifest and their relationship before reading
`DATABASE_URL`, creating a client or writing. The database must satisfy the
existing loopback-only policy.

A version 1 manifest is exactly `{ version, batchId, reviewer, reviewedAt,
decisions }`:

- `version` is the number `1` and `batchId` must exactly match the candidate
  batch ID;
- `reviewer` is a trimmed, nonblank identity of at most 200 characters with no
  control characters;
- `reviewedAt` is a canonical UTC timestamp at or after batch creation and no
  later than the command clock;
- `decisions` contains 1–500 strict `{ externalId, status }` objects with unique
  IDs, where every ID exists in the supplied candidate batch and `status` is
  `VERIFIED` or `REJECTED`.

In one serializable transaction, each decision resolves the supplied candidate's
existing taxonomy and deterministic database identity, then verifies every
candidate-owned question field, source value, choice and answer key. The row
must remain inactive. A first decision changes only `verificationStatus`,
`reviewer` and `reviewedAt` from an unreviewed `DRAFT`; it never changes content,
taxonomy, provenance, image data, IDs or choices and never activates the row.

Reapplying the exact same status, reviewer and timestamp to exact unchanged
content is a safe no-op. Missing candidates, content or taxonomy drift, changed
choices, active rows, malformed DRAFT review fields, and any different final
status, reviewer or timestamp abort the whole manifest without partial changes.
There is no undo, DRAFT restoration, status replacement or activation command.

Success reports only the batch ID, applied/matched VERIFIED and REJECTED counts,
and the inactive boundary. Every failure prints
`Candidate review failed. No review decisions were applied.` and exits nonzero
without paths, reviewer identity, source wording, decisions, SQL or credentials.

### Activate reviewed candidates

`imports/example-candidate-activation.json` is a fully synthetic activation
manifest for the synthetic candidate and review examples. It is a source-control
format example only and is never executed against repository or production
data. An activation manifest records an operator assertion; it does not itself
establish legal permission, official accuracy or Product Owner approval for a
production launch.

Apply an activation manifest only after importing and reviewing its exact batch:

```sh
pnpm content:activate-candidates -- path/to/candidate-batch.json path/to/review-manifest.json path/to/activation-manifest.json
```

The command accepts exactly three nonblank local paths. All three JSON files are
read through the 5 MiB fatal-UTF-8 boundary, parsed once, and strictly validated
as a complete chain before database configuration or connection. The existing
loopback-only `DATABASE_URL` policy remains mandatory.

A version 1 activation manifest is exactly `{ version, batchId, activatedBy,
activatedAt, externalIds }`:

- `version` is `1`, and `batchId` matches both the candidate and review files;
- `activatedBy` is a trimmed, control-free operator identity from 1–200
  characters;
- `activatedAt` is canonical UTC, no earlier than the supplied review time and
  no later than the command clock;
- `externalIds` contains 1–500 unique candidate keys, each present in the batch
  with a `VERIFIED` decision in the supplied review manifest. Missing decisions
  and `REJECTED` decisions are invalid before database access.

In one serializable transaction, the activation gate resolves existing taxonomy
and rechecks each deterministic question ID, all candidate content, four choices,
correctness, provenance, taxonomy and exact review status, reviewer and time.
Only an inactive exact `VERIFIED` row is eligible, and the first activation
updates only `active` to true. Exact replay is a no-op and does not change
`updatedAt`. DRAFT, REJECTED, missing, differently reviewed or drifted rows abort
the entire set without partial activation. Deactivation and review replacement
are not supported.

Success prints only the batch ID and applied/matched counts. Every failure prints
`Candidate activation failed. No candidates were activated.` and exits nonzero
without paths, operator or reviewer identities, source wording, decisions, SQL
or credentials. Production database access and production deployment remain
separate Product Owner decisions.

### Inspect candidate status

Inspect one immutable candidate batch against a loopback database with:

```sh
pnpm content:status-candidates -- path/to/candidate-batch.json
```

The command accepts exactly one nonblank local path and completes the same
bounded, fatal-UTF-8, strict batch validation before reading database
configuration or creating a client. It then reads a repeatable, read-only
snapshot. It never creates, updates, deletes, repairs, reviews, activates,
deactivates or locks content for modification.

Success emits one compact version 1 JSON object. Its `batchId` matches the input,
and `questions` follows candidate input order. Each entry is only:

- `{ externalId, state: "MISSING" }` when the deterministic row is absent;
- `{ externalId, state: "DRIFTED" }` when a row exists but its candidate-owned
  content, choice IDs and wording, answer, provenance or taxonomy is not exact;
- `{ externalId, state: "EXACT", verificationStatus, active,
  reviewerAssigned, reviewedAtPresent }` for exact persisted content.

Missing referenced taxonomy is `DRIFTED` when the deterministic candidate row
exists and `MISSING` when it does not. Lifecycle fields are withheld from
drifted rows because they cannot be attributed to the supplied candidate chain.
The output never includes question or choice wording, correctness, source
metadata, taxonomy names, reviewer identity, review timestamps, database IDs,
local paths, SQL or credentials.

The summary counts `total`, `missing`, `drifted`, `exact`, `draftInactive`,
`verifiedInactive`, `verifiedActive`, `rejectedInactive` and
`invalidLifecycle`. The four valid exact lifecycle combinations are an inactive
unreviewed DRAFT, an inactive VERIFIED row with both review fields, an active
VERIFIED row with both review fields, and an inactive REJECTED row with both
review fields. Every other exact-content combination is `invalidLifecycle`,
including DRAFT review metadata, incomplete final review metadata, active
REJECTED content and active DRAFT content.

Every failure exits nonzero, writes no stdout and prints only the stable generic
message `Candidate status failed. No status report was produced.` This inventory
is informational. It does not review or approve content, establish legal
permission or official accuracy, authorize production use, or replace the
separate import, review and activation manifests.

### Inspect learner reports

A trusted local operator can inspect the complete bounded set of saved practice
and exam allegations with:

```sh
pnpm content:inspect-reports
```

The command accepts exactly zero arguments. It validates `DATABASE_URL` with the
existing loopback-only PostgreSQL policy before creating a client, creates no
other network client, and always disconnects a created client. Inspection runs
inside one repeatable-read, explicitly read-only transaction. Counts and items
therefore describe one database snapshot, and the command never creates,
updates, deletes, repairs or locks rows for modification.

Success writes one compact strict version 1 JSON object with exactly
`{ version, summary, items }`. `summary` is exactly `{ total, practice, exam }`.
At most 500 combined reports are permitted; a larger inventory fails rather
than truncating or paginating. Items are sorted across both kinds by creation
time descending, report ID descending, then kind ascending. Every item is
exactly `{ reportId, kind, createdAt, details, questionId, anchorId, snapshot }`,
where `kind` is `PRACTICE` or `EXAM`, `anchorId` identifies the immutable
`QuestionPresentation` or `ExamQuestion`, and `snapshot` is the strictly
validated saved version 1 question evidence including four choices, the saved
correct choice and explanations. IDs and timestamps are canonical. Stored
details are revalidated through the same exact contract used when reports are
submitted.

The output is confidential because it includes learner-written allegation text
and complete immutable question evidence. It never includes learner or Telegram
identity, names, credentials, auth/session data, answer attempts, the learner's
selected choice or correctness outcome, favorites, progress, learning state,
exam-session identity/timing/score/result, current mutable question content or
lifecycle/source/reviewer metadata, database URLs, local paths or SQL.

Malformed arguments or configuration, unavailable PostgreSQL, query failures,
more than 500 reports, count mismatches, duplicate identities, malformed details,
IDs, timestamps or snapshots, and inconsistent report/anchor/session/question
tuples all exit nonzero with no stdout. Stderr contains only
`Report inspection failed. No report inventory was produced.` No partial
inventory is emitted.

This inventory is for confidential local human inspection only. It does not
mark a report reviewed, triaged, dismissed, resolved or actionable and does not
change verification, activation, legal status, current content or exam results.
It is not an admin API/UI, moderation action, triage manifest or production-data
access mechanism.

### Record report triage decisions

After a trusted local operator reviews an exact `content:inspect-reports`
inventory, record selected final internal routing judgments with:

```sh
pnpm content:triage-reports -- path/to/report-triage.json
```

The command accepts exactly one nonblank local file path. It reads no more than
5 MiB through the existing race-resistant fatal-UTF-8 JSON boundary and strictly
validates the complete confidential manifest before reading `DATABASE_URL` or
creating a client. The database must satisfy the loopback-only PostgreSQL policy,
and a created client is always disconnected before buffered success JSON is
written.

A version 1 manifest is exactly `{ version, triagedBy, triagedAt, decisions }`.
`triagedBy` is a trimmed, control-free valid-Unicode operator identity of 1–200
characters. `triagedAt` is a canonical millisecond UTC instant no later than the
command clock and no earlier than any selected report. `decisions` contains
1–500 unique kind/report pairs. Every entry is one exact confidential inspection
item plus `decision`:

```text
{ reportId, kind, createdAt, details, questionId, anchorId, snapshot, decision }
```

All keys are strict. IDs and times are canonical, allegation details use the
submission contract, and the complete versioned immutable snapshot is validated,
including its question/choice identities and answer/explanation evidence. Kind
is `PRACTICE` or `EXAM`. Decision is `ACTION_REQUIRED` or
`NO_ACTION_REQUIRED`; unpaired Unicode surrogates, duplicate kind/report pairs,
unknown fields, stale or normalized evidence and malformed snapshots are rejected.

The complete manifest runs in one serializable transaction. Each entry is
resolved by its explicit kind and report ID, all stored ownership tuples and
snapshots are revalidated, and every evidence field must still exactly equal the
operator's manifest before any row is changed. Pending reports receive the same
complete `{ triageDecision, triagedBy, triagedAt }` tuple. Exact replay is an
idempotent match; a partial or different persisted tuple, stale/missing/wrong-kind
evidence, unexpected write count or exhausted serialization retry aborts the
whole manifest. Concurrent identical invocations converge, while competing
decisions cannot overwrite one another.

Success emits only compact JSON exactly
`{ version: 1, summary: { total, actionRequired, noActionRequired, applied, matched } }`.
It contains no report/evidence IDs, allegation or snapshot content, learner,
session, question or anchor identity, operator identity, path, configuration or
SQL. Every failure exits nonzero with no stdout and only
`Report triage failed. No triage decisions were applied.` on stderr.

`ACTION_REQUIRED` means a later content workflow should investigate or change
the material. `NO_ACTION_REQUIRED` means this allegation causes no content
change. Both are internal routing judgments only: neither establishes factual
or legal correctness, contacts the learner, resolves an exam result, edits
content, or changes verification or activation. This command is not a report UI,
notification, production-data workflow or deployment mechanism.

### Audit report triage state

Inspect the current one-time routing state of every saved practice and exam
report with:

```sh
pnpm content:inspect-report-triage
```

The command accepts exactly zero arguments, captures one command clock, then
requires the existing loopback-only PostgreSQL configuration. It creates no
other network client and disconnects the database before releasing buffered
output. The complete audit runs in one repeatable-read, explicitly read-only
transaction and never creates, updates, deletes or locks rows for modification.

Success emits one compact strict version 1 object with exactly
`{ version, summary, items }`. The summary is exactly
`{ total, practice, exam, pending, actionRequired, noActionRequired }`. At most
500 combined reports are allowed; a larger current snapshot fails instead of
being truncated or paginated. Items are ordered across both kinds by report
creation time descending, report ID descending, then kind ascending. Every item
is exactly `{ reportId, kind, createdAt, questionId, anchorId, triage }`.
`triage` is `null` for pending reports or exactly
`{ decision, triagedBy, triagedAt }` for a final decision.

Before projecting that metadata, the command revalidates each hidden allegation,
immutable snapshot, canonical identity and complete practice/exam ownership tuple
through the accepted report-inspection boundary. Pending rows must have all three
triage fields null. Final rows must have a recognized decision, an operator that
satisfies the strict reviewer-identity contract, and a canonical triage time no
earlier than report creation and no later than the captured command clock. A
partial or malformed tuple invalidates the complete audit.

This output is confidential because it includes `triagedBy`. It never contains
allegation details, snapshots, question/choice/correctness/explanation text,
learner/profile/auth/session identity, practice answers, favorites, progress,
learning state, exam session identity/timing/score/result, current mutable
Question content/lifecycle/source/reviewer fields, database configuration, paths
or SQL. Every failure exits nonzero with no stdout and only
`Report triage inspection failed. No audit inventory was produced.` on stderr.

The audit shows current immutable one-time triage state. It does not supply the
evidence used for a decision or create a historical event log. It cannot create,
change or undo decisions, edit content, contact learners, alter exam results or
establish factual/legal correctness. The separate `content:inspect-reports`
contract remains unchanged.
