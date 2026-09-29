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
