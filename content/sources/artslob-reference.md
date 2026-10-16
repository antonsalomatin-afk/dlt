# artslob reference intake

The Product Owner approved using
[artslob/thailand-driving-exam-questions](https://github.com/artslob/thailand-driving-exam-questions)
as a starting reference on 2026-10-16. The pinned revision is
`67440927542ae7af7cebe4181c93a2dec07b1259`.

Upstream describes its source as move2thailand.com and explicitly warns that
some answers may be incorrect. No LICENSE file is present at this revision.
Reference intake does not establish rights to republish, official status, answer
accuracy, translation accuracy or vehicle applicability. Those require review.

## Reproduce locally

Obtain a local checkout of the pinned revision separately. The intake itself
does not clone, fetch, execute upstream code, render HTML, load `.env`, connect
to a database or download images. On Windows create the checkout with
`core.autocrlf=false` so the working HTML bytes match the pinned Git blobs.
Do not run upstream build/install scripts.

From the ThaiDLT repository root:

```sh
pnpm content:prepare-artslob-reference -- /absolute/path/to/local/checkout .local-content/artslob-reference-20261016
```

Supply exactly two arguments: the local checkout and a new destination following
`.local-content/<lowercase-hyphenated-name>`. The destination must not exist.
Inventory is written to `<destination>/inventory.json` with restricted file
permissions where supported. Keep it local and ignored; never stage upstream
question wording, images or executable files into this repository.

The command checks HEAD and Git blob hashes without hooks or external filters.
It requires all 420 numbered `output/<id>/index.html` pages, bounds individual
pages at 64 KiB, and rejects symbolic links, unsafe paths, changed working files,
oversized files and overwrite attempts. Unsupported HTML or JS string formats
are classified as malformed records rather than interpreted. Failures produce
only `Reference intake failed. No inventory was written.` and exit nonzero;
an existing destination is preserved. Use a fresh destination for each run.

## Review inventory

The deterministic JSON contains the revision, an
`UNREVIEWED_REFERENCE_ONLY` boundary, counts and one record per numbered page.
Each record includes its pinned GitHub page reference, upstream original-source
page-number marker, raw SHA-256, normalized content SHA-256 when structurally
valid, question and four ordered choices when parseable, explicit **upstream**
answer markers, relative image references, malformed issues and duplicate ID.
Original-source page-number markers are not independent citations or proof of
the underlying source's current content.

Vehicle applicability remains `UNREVIEWED`. No candidate import JSON, review
manifest, VERIFIED claim or activation is generated. Malformed entries may
contain partial extracted fields; their content cannot be used as a complete
question. Image-dependent entries require a separate visual and rights review;
no image bytes are copied or read.

Summary counts overlap deliberately: `total` accounts for all numbered pages;
`malformed`, `imageDependent` and `duplicates` are independent flags.
`structurallyValidText` excludes malformed/image-dependent entries;
`textReviewCandidates` additionally excludes exact normalized duplicates.
Duplicate hashing includes question, sorted choices, marked answer wording and
image references, so a changed upstream answer association is retained for
review rather than collapsed. Counts are workload estimates, not verified-bank
counts. Exact duplicate detection does not identify every semantic variant or
answer conflict.

The 2026-10-16 intake of this revision accounted for all 420 pages: 123 were
image-dependent, 21 malformed, zero exact duplicates, and 284 distinct text
review candidates. These counts overlap. Nineteen malformed records contain
U+200B zero-width controls; two have duplicate choice wording (IDs 159 and 202).
They remain excluded until explicitly resolved during content preparation.

## Before launch import

1. Establish permitted reuse and traceable independent citations.
2. Review wording, upstream answer markers and explanations against reliable
   references; correct stale or erroneous rules and preserve evidence.
3. Establish CAR/MOTORCYCLE applicability per question; do not duplicate the
   bank into both vehicle types by assumption.
4. Review required images and their rights separately, or exclude those items.
5. Resolve duplicates and contradictions, assign existing taxonomy, prepare
   a candidate batch and apply the separate import/review/activation gates.
6. Supply production-safe import instructions through the Supervisor/Admin
   workflow. Existing database CLI tools enforce loopback-only configuration;
   this intake does not weaken that boundary or access production.

The mock exam still requires at least 50 active VERIFIED questions per vehicle
type. Reference extraction alone does not satisfy that requirement.
