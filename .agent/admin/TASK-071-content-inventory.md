# TASK-071 existing content inventory

Checked on 2026-10-16 after the owner requested reuse of an existing verified bank.

## Findings

- `content/fixtures/development.json`: 25 synthetic development questions,
  comprising 15 CAR and 10 MOTORCYCLE questions. The accepted importer preserves
  them as inactive DRAFT FIXTURE records; they have no production review.
- `content/imports/example-candidate-batch.json`: one synthetic CAR example.
  Its accompanying example review uses the literal status VERIFIED and reviewer
  Synthetic Example Reviewer. These manifests demonstrate the format and are
  explicitly documented as examples, not completed production reviews.
- `tests/fullstack/run.ts`: generates 50 synthetic CAR questions marked VERIFIED
  inside an isolated disposable test database. These are software-test data,
  not a reviewed question bank or motorcycle content.
- Available content history and the fetched Claude branch contain no additional
  production question-bank files. The preserved starter ZIP contains only
  `content/.gitkeep` under content.

## Outcome

No existing verified production bank was found in the inspected repository
artifacts. No content was imported, relabelled or activated. Production database
contents were not inspected; no production database access is configured here.

Exams require 50 eligible active VERIFIED questions per vehicle type; the
existing fixture counts cannot meet that threshold.

## Planning source recovered

The owner correctly recalled an external GitHub question bank. The planning
chat titled "Лучшее приложение для прав" (conversation
`6a9e35fe-23a0-83eb-9048-d666af043bd2`, turn
`32c077c5-476c-4b20-bcd5-4a1d5df07a93`) identified:

- https://github.com/artslob/thailand-driving-exam-questions
- SafeDriveDLT as a reference for checking rules and writing original questions.

The original plan classified the GitHub bank as reference material rather than
a production source, citing uncertain reuse licensing and the author's warning
about incorrect answers. The GitHub README was rechecked on 2026-10-16 and
still states that questions were parsed from Move2Thailand and that some
answers may be incorrect. Finding this source does not establish completed
content review or mean an import batch already exists.

A second candidate located during this follow-up is
https://github.com/lostintime101/driving_theory_test. Its README describes 150
questions adapted from a DLT manual, and the repository displays an MIT
license. This second repository was found during the present search, not
confirmed as the original planning source. Its content provenance, answers,
image support and suitability still need assessment before a production batch
can be prepared.
