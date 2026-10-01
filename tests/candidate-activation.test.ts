import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidateActivationPathArguments,
  parseCandidateActivationManifest,
} from '../tools/content/candidate-activation.ts';
import { parseCandidateReviewManifest } from '../tools/content/candidate-review.ts';
import { parseCandidateBatch } from '../tools/content/candidates.ts';

const commandClock = new Date('2026-10-01T00:00:00.000Z');

function exampleBatch() {
  const input: unknown = JSON.parse(readFileSync(
    new URL('../content/imports/example-candidate-batch.json', import.meta.url),
    'utf8',
  ));
  return parseCandidateBatch(input);
}

function exampleReview(batch: ReturnType<typeof exampleBatch>) {
  const input: unknown = JSON.parse(readFileSync(
    new URL('../content/imports/example-candidate-review.json', import.meta.url),
    'utf8',
  ));
  return parseCandidateReviewManifest(input, batch, commandClock);
}

function exampleActivationInput(): unknown {
  return JSON.parse(readFileSync(
    new URL('../content/imports/example-candidate-activation.json', import.meta.url),
    'utf8',
  ));
}

describe('candidate activation manifest validation', () => {
  it('accepts the strict synthetic activation chain', () => {
    const batch = exampleBatch();
    const review = exampleReview(batch);
    expect(parseCandidateActivationManifest(exampleActivationInput(), batch, review, commandClock)).toEqual({
      version: 1,
      batchId: batch.batchId,
      activatedBy: 'Synthetic Example Operator',
      activatedAt: '2026-09-30T00:02:00.000Z',
      externalIds: ['sample-space-check-01'],
    });
  });

  it('rejects unknown fields, invalid versions, operators, timestamps and bounds', () => {
    const batch = exampleBatch();
    const review = exampleReview(batch);
    const valid = parseCandidateActivationManifest(exampleActivationInput(), batch, review, commandClock);
    const invalid: unknown[] = [
      { ...valid, unexpected: true },
      { ...valid, version: 2 },
      { ...valid, activatedBy: '' },
      { ...valid, activatedBy: ' operator ' },
      { ...valid, activatedBy: 'operator\u0000name' },
      { ...valid, activatedBy: 'x'.repeat(201) },
      { ...valid, activatedAt: '2026-09-30T00:02:00Z' },
      { ...valid, activatedAt: '2026-09-30T00:00:59.999Z' },
      { ...valid, activatedAt: '2026-10-01T00:00:00.001Z' },
      { ...valid, externalIds: [] },
      { ...valid, externalIds: Array.from({ length: 501 }, (_, index) => `activation-${index}`) },
      { ...valid, externalIds: [valid.externalIds[0], valid.externalIds[0]] },
    ];

    for (const input of invalid) expect(() => parseCandidateActivationManifest(input, batch, review, commandClock)).toThrow();
  });

  it('requires matching batches and candidate IDs with supplied VERIFIED decisions', () => {
    const batch = exampleBatch();
    const review = exampleReview(batch);
    const valid = parseCandidateActivationManifest(exampleActivationInput(), batch, review, commandClock);
    const rejectedReview = parseCandidateReviewManifest({
      ...review,
      decisions: [{ externalId: valid.externalIds[0], status: 'REJECTED' }],
    }, batch, commandClock);
    const base = batch.questions[0];
    if (!base) throw new Error('Missing example candidate.');
    const expandedBatch = parseCandidateBatch({
      ...batch,
      questions: [base, {
        ...base,
        externalId: 'not-reviewed-candidate',
        textEnglish: 'A second synthetic candidate without a review decision.',
      }],
    });
    const expandedReview = parseCandidateReviewManifest(review, expandedBatch, commandClock);

    for (const [input, candidateBatch, candidateReview] of [
      [{ ...valid, batchId: 'another-batch' }, batch, review],
      [{ ...valid, externalIds: ['unknown-candidate'] }, batch, review],
      [valid, batch, rejectedReview],
      [{ ...valid, externalIds: ['not-reviewed-candidate'] }, expandedBatch, expandedReview],
    ] as const) {
      expect(() => parseCandidateActivationManifest(input, candidateBatch, candidateReview, commandClock)).toThrow();
    }
  });

  it('accepts exactly three nonblank paths with an optional pnpm separator', () => {
    expect(candidateActivationPathArguments(['batch.json', 'review.json', 'activation.json']))
      .toEqual(['batch.json', 'review.json', 'activation.json']);
    expect(candidateActivationPathArguments(['--', 'batch.json', 'review.json', 'activation.json']))
      .toEqual(['batch.json', 'review.json', 'activation.json']);
    for (const args of [[], ['--'], ['batch'], ['batch', 'review'], ['batch', 'review', ' '], ['a', 'b', 'c', 'd']]) {
      expect(candidateActivationPathArguments(args)).toBeUndefined();
    }
  });
});
