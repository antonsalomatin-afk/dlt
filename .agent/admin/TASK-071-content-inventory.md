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

The owner must identify any separate question bank or content source intended
for reuse. Actual content review and source provenance remain necessary before
production verification. Exams require 50 eligible active VERIFIED questions
per vehicle type; the existing fixture counts cannot meet that threshold.
