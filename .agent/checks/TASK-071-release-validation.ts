// Offline release-chain validation. No .env, database, network or publication side effects.
// Run at the repository root: node .agent/checks/TASK-071-release-validation.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readCandidateBatchFile, readBoundedJsonFile } from '../../tools/content/candidates.ts';
import { readCandidateReviewManifestFile } from '../../tools/content/candidate-review.ts';
import { readCandidateActivationManifestFile } from '../../tools/content/candidate-activation.ts';

const candidateCommit = '65d1c1ade2c48fc4e82388db85da93faf7eee9d8';
const issuedAt = '2026-10-19T18:10:00.000Z';
const reviewer = 'Independent reviewer_071_content; TASK-071-content-decisions-01.json + TASK-071-content-review-02.md; issued by Supervisor';
const activatedBy = 'Supervisor; Product Owner publication approval 2026-10-19; OWNER_DECISIONS.md';
const decisionsPath = '.agent/reviews/TASK-071-content-decisions-01.json';
const finalReviewPath = '.agent/reviews/TASK-071-content-review-02.md';

// Compare exact Git-canonical text bytes; Windows checkout CRLF alone is allowed.
// No content, field, whitespace or final-newline changes are normalized otherwise.
function assertCommittedBytes(path: string, commit: string): void {
  const expected = execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8', maxBuffer: 2_000_000 });
  assert.equal(readFileSync(path, 'utf8').replace(/\r\n/gu, '\n'), expected, `Immutable evidence drift: ${path}`);
}

const decisionSchema = z.object({
  candidateBatchId: z.string(), externalId: z.string(), decision: z.literal('SUPPORTED'),
  vehicleType: z.enum(['CAR', 'MOTORCYCLE']), correctChoiceKey: z.enum(['A', 'B', 'C', 'D']),
  printedPage: z.number().int().positive(), pdfPage: z.number().int().positive(),
  primarySourceUrl: z.url(), allFourChoicesRead: z.literal(true), explanationRead: z.literal(true),
  vehicleApplicabilityChecked: z.literal(true), topicGroupingChecked: z.literal(true),
});
const evidenceSchema = z.object({
  reviewer: z.literal('Independent content/data reviewer - reviewer_071_content'),
  reviewedCommit: z.literal('671f201f8e3af241f08198ec6ac51280a2fe1a1c'),
  productionApproval: z.literal(false), databaseVerificationPerformed: z.literal(false),
  decisions: z.array(decisionSchema).length(100),
  primaryPageChecks: z.array(z.object({ pdfPage: z.number().int().positive(),
    completePageVisuallyRead: z.literal(true), headingIllustrationsQualificationsRead: z.literal(true),
    result: z.literal('SUPPORTS_REFERENCED_CANDIDATE_CLAIMS'),
  })).length(26),
});
const provenanceSchema = z.object({ questions: z.array(z.object({
  externalId: z.string(), candidateBatchId: z.string(), vehicleType: z.enum(['CAR', 'MOTORCYCLE']),
  primarySource: z.object({ printedPage: z.number().int().positive(), pdfPage: z.number().int().positive(), url: z.url() }),
  uncertainClaims: z.array(z.unknown()).length(0),
})).length(100) });

export function validateApprovedRelease(commandClock = new Date()) {
  assert.ok(new Date(issuedAt).getTime() <= commandClock.getTime(), 'Release issuance cannot be in the future.');
  for (const path of [
    'content/imports/launch-20261016-car-candidates.json',
    'content/imports/launch-20261016-motorcycle-candidates.json',
    'content/sources/launch-20261016-provenance.json',
    'content/sources/launch-20261016-taxonomy.json',
    'content/sources/launch-20261016-taxonomy.sql',
  ]) assertCommittedBytes(path, candidateCommit);
  assertCommittedBytes(decisionsPath, '70c3f483271b3859b2181eafdb62cc41e022e868');
  assertCommittedBytes(finalReviewPath, '1748034d3f88936cb19c6873393e73f9ec0d82f5');
  const finalReview = readFileSync(finalReviewPath, 'utf8');
  assert.ok(finalReview.includes('VERDICT: PASS') && finalReview.includes(candidateCommit));
  const approval = execFileSync('git', ['show', '4e745f0:.agent/OWNER_DECISIONS.md'], { encoding: 'utf8' });
  assert.ok(approval.includes('2026-10-19 — Publish reviewed original English starter bank')
    && approval.includes(candidateCommit) && approval.includes('Approve publishing this starter bank'));
  const evidence = evidenceSchema.parse(readBoundedJsonFile(decisionsPath));
  const provenance = provenanceSchema.parse(readBoundedJsonFile('content/sources/launch-20261016-provenance.json'));
  const decisionById = new Map(evidence.decisions.map((d) => [d.externalId, d]));
  const provenanceById = new Map(provenance.questions.map((q) => [q.externalId, q]));
  assert.equal(decisionById.size, 100);
  assert.equal(provenanceById.size, 100);
  const allIds = new Set<string>();
  const releases = (['car', 'motorcycle'] as const).map((vehicle) => {
    const prefix = `content/imports/launch-20261016-${vehicle}`;
    const batch = readCandidateBatchFile(`${prefix}-candidates.json`);
    const review = readCandidateReviewManifestFile(`${prefix}-review.json`, batch, commandClock);
    const activation = readCandidateActivationManifestFile(`${prefix}-activation.json`, batch, review, commandClock);
    assert.equal(batch.questions.length, 50);
    assert.equal(batch.batchId, `launch-20261016-${vehicle}`);
    assert.equal(review.reviewer, reviewer);
    assert.equal(review.reviewedAt, issuedAt);
    assert.equal(activation.activatedBy, activatedBy);
    assert.equal(activation.activatedAt, issuedAt);
    assert.deepEqual(review.decisions, batch.questions.map((q) => ({ externalId: q.externalId, status: 'VERIFIED' })));
    assert.deepEqual(activation.externalIds, batch.questions.map((q) => q.externalId));
    for (const question of batch.questions) {
      assert.ok(!allIds.has(question.externalId));
      allIds.add(question.externalId);
      assert.equal(question.vehicleType, vehicle === 'car' ? 'CAR' : 'MOTORCYCLE');
      const decision = decisionById.get(question.externalId);
      const source = provenanceById.get(question.externalId);
      assert.ok(decision && source);
      assert.equal(decision.candidateBatchId, batch.batchId);
      assert.equal(source.candidateBatchId, batch.batchId);
      assert.equal(decision.vehicleType, question.vehicleType);
      assert.equal(source.vehicleType, question.vehicleType);
      assert.equal(decision.correctChoiceKey, question.correctChoiceKey);
      assert.equal(question.choices.filter((c) => c.key === decision.correctChoiceKey).length, 1);
      assert.equal(decision.printedPage, source.primarySource.printedPage);
      assert.equal(decision.pdfPage, source.primarySource.pdfPage);
      assert.equal(decision.primarySourceUrl, source.primarySource.url);
      assert.equal(decision.pdfPage, decision.printedPage + 6);
      assert.ok(evidence.primaryPageChecks.some((page) => page.pdfPage === decision.pdfPage));
      assert.ok(question.source.legalCitation?.includes(`printed p. ${decision.printedPage} (PDF p. ${decision.pdfPage})`));
      assert.ok(question.source.legalCitation?.includes(decision.primarySourceUrl));
    }
    return { batch, review, activation };
  });
  assert.equal(allIds.size, 100);
  assert.deepEqual(new Set(decisionById.keys()), allIds);
  assert.deepEqual(new Set(provenanceById.keys()), allIds);
  return releases;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateApprovedRelease();
  console.log('PASS offline approved release: immutable candidates/taxonomy/provenance; 100 SUPPORTED decisions bridged to final PASS; four exact manifests. No database or publication occurred.');
}
