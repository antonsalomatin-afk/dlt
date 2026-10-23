# Launch bank bilingual teaching candidate pack

This is the offline TASK-084 candidate pack for the owner's approved per-line hidden English/Russian Telegram preview. It is not a new question bank, a publication manifest, a legal opinion or an automatic VERIFIED decision. The original English questions, answer keys, accepted Russian stems and existing source citations remain unchanged.

## Coverage and format

`content/imports/launch-20261023-bilingual-teaching.json` has `version: 1`, `packId: launch-20261023-bilingual-teaching`, a canonical UTC `createdAt`, three `sources` bindings and an `entries` array. Each source binding has exactly `path` and `sha256`.

The pack covers exactly all 100 launch questions: 50 CAR and 50 MOTORCYCLE, identified by the existing `(batchId, externalId)` pair. It supplies all 400 A–D Russian choices, all 100 Russian explanations, and 100 English/Russian pairs each for distractor reasoning and practical safety reasoning. Every entry retains the exact previously accepted Russian question stem and the exact existing guide citation.

Each entry contains:

- `batchId`, `externalId`, `textRussian`;
- `choices`, an array in A–D order of `{key, textRussian}`;
- `explanationRussian`, translating the original `explanationEnglish`;
- `whyOthersWrongEnglish` and `whyOthersWrongRussian`, describing the actual wrong options by their existing keys;
- `safetyReasonEnglish` and `safetyReasonRussian`, explaining practical reasoning rather than claiming a new legal requirement;
- `guidanceCitation`, `basisKind: DLT_GUIDANCE` and `statute: null`.

All text is trimmed plain text with a maximum of 4,000 characters per field. Rendering markup is not stored in content. A future renderer must escape content and apply spoilers separately; it must preserve option keys and cannot infer answer keys from these translations. Distractor explanations are post-answer material and must not appear in pre-answer question/choice payloads.

## Binding to existing accepted sources

The three inputs are:

- `content/imports/launch-20261016-car-candidates.json`;
- `content/imports/launch-20261016-motorcycle-candidates.json`;
- `content/imports/launch-20261021-russian-stems.json`.

SHA256 is computed over parsed JSON with recursively sorted object keys, preserved array order, JSON scalar semantics and UTF-8 encoding, without whitespace. It is a canonical content hash, not a file-byte hash, and uses the convention of `canonicalJsonSha256` in `tools/content/russian-stems.ts`. The pack records the three exact hashes. Any changed candidate, accepted stem, option order or other input value requires a new binding and independent review; formatting and line endings do not change a binding.

The English source questions and guide-page associations were accepted through TASK-071; Russian stems were accepted through the previous Russian-stems workflow. This task reuses those exact associations. Their retention is not a claim that new statutory research or a new page-by-page legal audit was performed here.

## Authoring and factual boundary

Two offline AI-assisted authoring passes covered the car and motorcycle halves separately, reading every existing English option, explanation and accepted Russian stem. Russian choices translate the supplied options, including wrong options, without adding correctness labels. Explanation translations retain the original meaning. New bilingual distractor notes distinguish the specific misconceptions in each question. Safety notes give concise qualitative practical reasoning, without invented collision statistics, penalties or law numbers. A deterministic full-pack check verifies complete identities, exact stems/citations, canonical bindings, four distinct A–D choices, bounded text and references to all actual distractor keys. Semantic fidelity requires the independent Reviewer to inspect all 100 entries; mechanical checks alone cannot establish translation quality.

The retained citation is to the Department of Land Transport educational publication *Driving in Thailand: Thailand Driving Guide*, with printed and PDF page numbers already present in each candidate. Its existing URL is https://safedrivedlt.com/wp-content/uploads/2025/06/Driving-EN-010468_compressed.pdf. This is **DLT guidance**, not an exact statutory citation. The guide can describe legal requirements, road practice and practical advice; those descriptions must not be relabelled as independently established statutory clauses.

Exact statutory coverage is **0 of 100**. Every `statute` is null. No act title/section, legislative excerpt, effective-date analysis, penalty or claim of independently verified current law has been added. Some subjects, such as documenting rental damage, are practical guidance rather than a traffic-law obligation. Providing the retained guide page is sufficient for this bounded pack; adding exact law references later requires primary-source verification and a separately reviewed content change.

The planned teaching view must visibly distinguish the answer explanation, why other options are wrong, DLT guidance with its source/page, and practical reasoning. It must not display a fabricated “law” section when `statute` is null or suggest all guidance is statutory. Practical reasoning is educational rationale, not a guarantee of an outcome.

## Review and publication boundary

This task changes only the new JSON pack and this source report. It does not change the original candidates, accepted stems/review manifests, answer keys, question verification status, active flags, live database, historical presentations, API, bot or Mini App. No translator runs at request time, no paid service is introduced, and no real message or poll is sent.

Before Supervisor acceptance, an independent Reviewer must return PASS and a hash-bound per-question content review manifest for all 100 identities. That review must bind the complete canonical pack, inspect the translation and teaching content, and record any rejected entries rather than treating structural validation as content verification. Reviewer acceptance of this offline pack does not itself publish or deploy it.

Implementation and publication are subsequent bounded tasks. The planned implementation may enrich only exact source-matching new snapshots with the accepted, reviewed pack; it must preserve existing bank/history and pre-answer secrecy. Production deployment remains subject to separate exact-release checks and independent operational review.
