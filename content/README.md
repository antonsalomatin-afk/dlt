# Development content

`fixtures/development.json` contains exactly 25 original synthetic questions in
five categories. These are software development examples, not an official DLT
bank, licensed third-party material, legal guidance, or verified translations.
The exam-English example is explicitly synthetic. Do not use this dataset as
evidence of actual Thai examination rules or readiness.

Every question also names exactly one learning `concept` from the document's
`concepts` list (stable key plus Thai, English and Russian names). Concepts group
question variants that teach the same rule, so learning can later attach to the
rule rather than to one wording. The grouping is a synthetic development example,
not an official curriculum. Validation rejects an undeclared concept reference, a
declared concept that no question uses, duplicate concept keys, and a document in
which no concept groups at least two questions.

Each question has a stable human-readable ID. The importer derives stable UUIDs
from those IDs and the fixed `thaidlt-development-v1` namespace. Category, concept
and choice IDs are also deterministic. Keep IDs unchanged when editing a fixture.

The importer validates the entire document before writing: exactly 25 unique
questions, all five categories, both vehicles, nonempty text, strict allowed
fields, A–D once each, one correct choice, and a complete multilingual example.
Every imported question remains `FIXTURE`, inactive and `DRAFT`; no review or
legal-verification claim is created. Since PostgreSQL refuses to verify anything whose
source type is not `ORIGINAL`, fixture content cannot be promoted to the verified state
that learner-facing delivery requires, no matter how it is edited. Production content is
original in-house authored work citing public Thai traffic law, per the accepted decision
in `.agent/OWNER_DECISIONS.md`.

Run `pnpm content:import` after the documented database setup. This accepts no
file or destination arguments and requires the loopback-only `.env` convention.
The whole import is one serializable transaction. Reimport updates matching
inactive draft fixtures while preserving IDs and counts. Omitted optional wording
fields become null on the matching fixture. It does not remove old records
when IDs change. Category or concept identity/name conflicts, nonfixture/protected question
collisions and foreign choice-ID collisions abort the entire import. Existing
categories and concepts with matching IDs/names are reused without modification. Unrelated
records are never reset or deleted. Concurrent conflicts fail; retry after the
other operation completes.
