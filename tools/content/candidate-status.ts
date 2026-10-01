import type { PrismaClient } from '../../packages/database/src/index.ts';
import {
  candidateContentMatches,
  candidateQuestionId,
  mapCandidateQuestion,
} from './candidate-import.ts';
import type { CandidateBatch } from './candidates.ts';

type VerificationStatus = 'DRAFT' | 'VERIFIED' | 'REJECTED';

export interface CandidateLifecycle {
  verificationStatus: VerificationStatus;
  active: boolean;
  reviewer: string | null;
  reviewedAt: Date | null;
}

export type CandidateLifecycleState =
  | 'draftInactive'
  | 'verifiedInactive'
  | 'verifiedActive'
  | 'rejectedInactive'
  | 'invalidLifecycle';

export interface CandidateMissingStatus {
  externalId: string;
  state: 'MISSING';
}

export interface CandidateDriftedStatus {
  externalId: string;
  state: 'DRIFTED';
}

export interface CandidateExactStatus {
  externalId: string;
  state: 'EXACT';
  verificationStatus: VerificationStatus;
  active: boolean;
  reviewerAssigned: boolean;
  reviewedAtPresent: boolean;
}

export type CandidateQuestionStatus = CandidateMissingStatus | CandidateDriftedStatus | CandidateExactStatus;

export interface CandidateStatusSummary {
  total: number;
  missing: number;
  drifted: number;
  exact: number;
  draftInactive: number;
  verifiedInactive: number;
  verifiedActive: number;
  rejectedInactive: number;
  invalidLifecycle: number;
}

export interface CandidateStatusReport {
  version: 1;
  batchId: string;
  summary: CandidateStatusSummary;
  questions: CandidateQuestionStatus[];
}

export function classifyCandidateLifecycle(lifecycle: CandidateLifecycle): CandidateLifecycleState {
  return classifyLifecyclePresence(
    lifecycle.verificationStatus,
    lifecycle.active,
    lifecycle.reviewer !== null,
    lifecycle.reviewedAt !== null,
  );
}

export function projectExactCandidateStatus(
  externalId: string,
  lifecycle: CandidateLifecycle,
): CandidateExactStatus {
  return {
    externalId,
    state: 'EXACT',
    verificationStatus: lifecycle.verificationStatus,
    active: lifecycle.active,
    reviewerAssigned: lifecycle.reviewer !== null,
    reviewedAtPresent: lifecycle.reviewedAt !== null,
  };
}

export function createCandidateStatusReport(
  batchId: string,
  questions: CandidateQuestionStatus[],
): CandidateStatusReport {
  const summary: CandidateStatusSummary = {
    total: questions.length,
    missing: 0,
    drifted: 0,
    exact: 0,
    draftInactive: 0,
    verifiedInactive: 0,
    verifiedActive: 0,
    rejectedInactive: 0,
    invalidLifecycle: 0,
  };

  for (const question of questions) {
    if (question.state === 'MISSING') {
      summary.missing += 1;
      continue;
    }
    if (question.state === 'DRIFTED') {
      summary.drifted += 1;
      continue;
    }
    summary.exact += 1;
    summary[classifyLifecyclePresence(
      question.verificationStatus,
      question.active,
      question.reviewerAssigned,
      question.reviewedAtPresent,
    )] += 1;
  }

  return { version: 1, batchId, summary, questions: [...questions] };
}

export async function inspectCandidateBatch(
  database: PrismaClient,
  batch: CandidateBatch,
): Promise<CandidateStatusReport> {
  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET TRANSACTION READ ONLY`;

    const deterministicIds = batch.questions.map((question) => (
      candidateQuestionId(batch.version, batch.batchId, question.externalId)
    ));
    const storedQuestions = await transaction.question.findMany({
      where: { id: { in: deterministicIds } },
      include: { choices: true },
    });
    const categories = await transaction.category.findMany({
      where: { slug: { in: [...new Set(batch.questions.map(({ categorySlug }) => categorySlug))] } },
      select: { id: true, slug: true },
    });
    const concepts = await transaction.concept.findMany({
      where: { slug: { in: [...new Set(batch.questions.map(({ conceptSlug }) => conceptSlug))] } },
      select: { id: true, slug: true },
    });
    const storedById = new Map(storedQuestions.map((question) => [question.id, question]));
    const categoryIds = new Map(categories.map(({ id, slug }) => [slug, id]));
    const conceptIds = new Map(concepts.map(({ id, slug }) => [slug, id]));

    const statuses: CandidateQuestionStatus[] = batch.questions.map((candidate) => {
      const id = candidateQuestionId(batch.version, batch.batchId, candidate.externalId);
      const existing = storedById.get(id);
      if (existing === undefined) return { externalId: candidate.externalId, state: 'MISSING' };

      const categoryId = categoryIds.get(candidate.categorySlug);
      const conceptId = conceptIds.get(candidate.conceptSlug);
      if (categoryId === undefined || conceptId === undefined) {
        return { externalId: candidate.externalId, state: 'DRIFTED' };
      }
      const expected = mapCandidateQuestion(batch, candidate, categoryId, conceptId);
      if (!candidateContentMatches(existing, expected)) {
        return { externalId: candidate.externalId, state: 'DRIFTED' };
      }
      return projectExactCandidateStatus(candidate.externalId, existing);
    });

    return createCandidateStatusReport(batch.batchId, statuses);
  }, { isolationLevel: 'RepeatableRead', timeout: 30000, maxWait: 5000 });
}

function classifyLifecyclePresence(
  verificationStatus: VerificationStatus,
  active: boolean,
  reviewerAssigned: boolean,
  reviewedAtPresent: boolean,
): CandidateLifecycleState {
  const hasCompleteReview = reviewerAssigned && reviewedAtPresent;
  const hasNoReview = !reviewerAssigned && !reviewedAtPresent;

  if (verificationStatus === 'DRAFT' && !active && hasNoReview) return 'draftInactive';
  if (verificationStatus === 'VERIFIED' && hasCompleteReview) {
    return active ? 'verifiedActive' : 'verifiedInactive';
  }
  if (verificationStatus === 'REJECTED' && !active && hasCompleteReview) return 'rejectedInactive';
  return 'invalidLifecycle';
}
