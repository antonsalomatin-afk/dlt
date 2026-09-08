# Development content

`fixtures/development.json` contains exactly 25 original synthetic questions in
five categories. These are software development examples, not an official DLT
bank, licensed third-party material, legal guidance, or verified translations.
The exam-English example is explicitly synthetic. Do not use this dataset as
evidence of actual Thai examination rules or readiness.

Each question has a stable human-readable ID. The importer derives stable UUIDs
from those IDs and the fixed `thaidlt-development-v1` namespace. Category IDs and
choice IDs are also deterministic. Keep IDs unchanged when editing a fixture.

The importer validates the entire document before writing: exactly 25 unique
questions, all five categories, both vehicles, nonempty text, strict allowed
fields, A–D once each, one correct choice, and a complete multilingual example.
Every imported question remains `FIXTURE`, inactive and `DRAFT`; no review or
legal-verification claim is created.

Run `pnpm content:import` after the documented database setup. This accepts no
file or destination arguments and requires the loopback-only `.env` convention.
The whole import is one serializable transaction. Reimport updates matching
inactive draft fixtures while preserving IDs and counts. Omitted optional wording
fields become null on the matching fixture. It does not remove old records
when IDs change. Category identity/name conflicts, nonfixture/protected question
collisions and foreign choice-ID collisions abort the entire import. Existing
categories with matching IDs/names are reused without modification. Unrelated
records are never reset or deleted. Concurrent conflicts fail; retry after the
other operation completes.
