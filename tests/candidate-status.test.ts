import { describe, expect, it } from 'vitest';
import {
  classifyCandidateLifecycle,
  createCandidateStatusReport,
  projectExactCandidateStatus,
  type CandidateLifecycle,
  type CandidateLifecycleState,
  type CandidateQuestionStatus,
} from '../tools/content/candidate-status.ts';

describe('candidate status projection', () => {
  it('classifies only the four supported lifecycle combinations as valid', () => {
    const statuses = ['DRAFT', 'VERIFIED', 'REJECTED'] as const;
    const booleans = [false, true] as const;
    const expectedValid = new Map<string, CandidateLifecycleState>([
      ['DRAFT:false:false:false', 'draftInactive'],
      ['VERIFIED:false:true:true', 'verifiedInactive'],
      ['VERIFIED:true:true:true', 'verifiedActive'],
      ['REJECTED:false:true:true', 'rejectedInactive'],
    ]);

    for (const verificationStatus of statuses) {
      for (const active of booleans) {
        for (const reviewerAssigned of booleans) {
          for (const reviewedAtPresent of booleans) {
            const lifecycle: CandidateLifecycle = {
              verificationStatus,
              active,
              reviewer: reviewerAssigned ? 'Private Reviewer Identity' : null,
              reviewedAt: reviewedAtPresent ? new Date('2026-10-01T00:00:00.000Z') : null,
            };
            const key = `${verificationStatus}:${String(active)}:${String(reviewerAssigned)}:${String(reviewedAtPresent)}`;
            expect(classifyCandidateLifecycle(lifecycle)).toBe(expectedValid.get(key) ?? 'invalidLifecycle');
          }
        }
      }
    }
  });

  it('projects exact lifecycle presence without exposing identity or timestamp values', () => {
    const result = projectExactCandidateStatus('candidate-one', {
      verificationStatus: 'VERIFIED',
      active: true,
      reviewer: 'Private Reviewer Identity',
      reviewedAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(result).toEqual({
      externalId: 'candidate-one',
      state: 'EXACT',
      verificationStatus: 'VERIFIED',
      active: true,
      reviewerAssigned: true,
      reviewedAtPresent: true,
    });
    expect(Object.keys(result)).toEqual([
      'externalId', 'state', 'verificationStatus', 'active', 'reviewerAssigned', 'reviewedAtPresent',
    ]);
    expect(JSON.stringify(result)).not.toContain('Private Reviewer Identity');
    expect(JSON.stringify(result)).not.toContain('2026-10-01');
  });

  it('preserves candidate order and counts missing, drifted and exact lifecycle states', () => {
    const questions: CandidateQuestionStatus[] = [
      { externalId: 'missing-one', state: 'MISSING' },
      { externalId: 'draft-one', state: 'EXACT', verificationStatus: 'DRAFT', active: false, reviewerAssigned: false, reviewedAtPresent: false },
      { externalId: 'drifted-one', state: 'DRIFTED' },
      { externalId: 'verified-inactive', state: 'EXACT', verificationStatus: 'VERIFIED', active: false, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'verified-active', state: 'EXACT', verificationStatus: 'VERIFIED', active: true, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'rejected-one', state: 'EXACT', verificationStatus: 'REJECTED', active: false, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'invalid-one', state: 'EXACT', verificationStatus: 'REJECTED', active: true, reviewerAssigned: true, reviewedAtPresent: true },
    ];

    const report = createCandidateStatusReport('status-batch', questions);

    expect(report).toEqual({
      version: 1,
      batchId: 'status-batch',
      summary: {
        total: 7,
        missing: 1,
        drifted: 1,
        exact: 5,
        draftInactive: 1,
        verifiedInactive: 1,
        verifiedActive: 1,
        rejectedInactive: 1,
        invalidLifecycle: 1,
      },
      questions,
    });
    expect(report.questions.map(({ externalId }) => externalId)).toEqual(questions.map(({ externalId }) => externalId));
  });
});
