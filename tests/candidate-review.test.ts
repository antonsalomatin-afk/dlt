import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidateReviewPathArguments,
  parseCandidateReviewManifest,
} from '../tools/content/candidate-review.ts';
import { parseCandidateBatch } from '../tools/content/candidates.ts';

function exampleBatch() {
  const input: unknown = JSON.parse(readFileSync(
    new URL('../content/imports/example-candidate-batch.json', import.meta.url),
    'utf8',
  ));
  return parseCandidateBatch(input);
}

function exampleManifestInput(): unknown {
  return JSON.parse(readFileSync(
    new URL('../content/imports/example-candidate-review.json', import.meta.url),
    'utf8',
  ));
}

const commandClock = new Date('2026-10-01T00:00:00.000Z');

describe('candidate review manifest validation', () => {
  it('accepts the strict synthetic manifest and both final statuses', () => {
    const batch = exampleBatch();
    const verified = parseCandidateReviewManifest(exampleManifestInput(), batch, commandClock);
    const rejected = parseCandidateReviewManifest({
      ...verified,
      decisions: [{ externalId: verified.decisions[0]?.externalId, status: 'REJECTED' }],
    }, batch, commandClock);

    expect(verified).toMatchObject({
      version: 1,
      batchId: batch.batchId,
      reviewer: 'Synthetic Example Reviewer',
      reviewedAt: '2026-09-30T00:01:00.000Z',
    });
    expect(rejected.decisions[0]?.status).toBe('REJECTED');
  });

  it('rejects unknown fields, invalid versions, reviewers, timestamps and statuses', () => {
    const batch = exampleBatch();
    const valid = parseCandidateReviewManifest(exampleManifestInput(), batch, commandClock);
    const invalid: unknown[] = [
      { ...valid, unexpected: true },
      { ...valid, version: 2 },
      { ...valid, reviewer: '' },
      { ...valid, reviewer: ' reviewer ' },
      { ...valid, reviewer: 'reviewer\u0000name' },
      { ...valid, reviewer: 'x'.repeat(201) },
      { ...valid, reviewedAt: '2026-09-30T00:01:00Z' },
      { ...valid, decisions: [{ ...valid.decisions[0], unexpected: true }] },
      { ...valid, decisions: [{ ...valid.decisions[0], status: 'DRAFT' }] },
      { ...valid, decisions: [{ ...valid.decisions[0], externalId: 'Upper_Invalid' }] },
    ];

    for (const input of invalid) expect(() => parseCandidateReviewManifest(input, batch, commandClock)).toThrow();
  });

  it('enforces batch, time, membership, uniqueness and decision bounds', () => {
    const batch = exampleBatch();
    const valid = parseCandidateReviewManifest(exampleManifestInput(), batch, commandClock);
    const first = valid.decisions[0];
    if (!first) throw new Error('Missing review decision.');
    const invalid: unknown[] = [
      { ...valid, batchId: 'another-batch' },
      { ...valid, reviewedAt: '2026-09-29T23:59:59.999Z' },
      { ...valid, reviewedAt: '2026-10-01T00:00:00.001Z' },
      { ...valid, decisions: [] },
      { ...valid, decisions: [first, first] },
      { ...valid, decisions: [{ externalId: 'not-in-candidate-batch', status: 'VERIFIED' }] },
      {
        ...valid,
        decisions: Array.from({ length: 501 }, (_, index) => ({
          externalId: `review-${index}`,
          status: 'VERIFIED',
        })),
      },
    ];

    for (const input of invalid) expect(() => parseCandidateReviewManifest(input, batch, commandClock)).toThrow();
  });

  it('accepts exactly two nonblank paths with an optional pnpm separator', () => {
    expect(candidateReviewPathArguments(['batch.json', 'review.json'])).toEqual(['batch.json', 'review.json']);
    expect(candidateReviewPathArguments(['--', 'batch.json', 'review.json'])).toEqual(['batch.json', 'review.json']);
    for (const args of [[], ['--'], ['batch.json'], ['batch.json', ' '], [' ', 'review.json'], ['a', 'b', 'c']]) {
      expect(candidateReviewPathArguments(args)).toBeUndefined();
    }
  });
});
