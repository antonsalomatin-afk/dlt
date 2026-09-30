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
