import { z } from 'zod';
import type { PrismaClient } from '../../packages/database/src/index.ts';
import {
  candidateContentMatches,
  mapCandidateQuestion,
} from './candidate-import.ts';
import {
  candidateKeySchema,
  canonicalUtcInstantSchema,
  readBoundedJsonFile,
  type CandidateBatch,
} from './candidates.ts';

const reviewerSchema = z.string()
  .min(1, 'must not be blank.')
  .max(200, 'must contain at most 200 characters.')
  .refine((value) => value === value.trim(), 'must not have surrounding whitespace.')
  .refine((value) => !/\p{Cc}/u.test(value), 'must not contain control characters.');

const decisionSchema = z.strictObject({
  externalId: candidateKeySchema,
  status: z.enum(['VERIFIED', 'REJECTED']),
});

export const candidateReviewManifestSchema = z.strictObject({
  version: z.literal(1),
  batchId: candidateKeySchema,
  reviewer: reviewerSchema,
  reviewedAt: canonicalUtcInstantSchema,
  decisions: z.array(decisionSchema)
    .min(1, 'must contain at least one decision.')
    .max(500, 'must contain at most 500 decisions.'),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const [index, decision] of manifest.decisions.entries()) {
    if (seen.has(decision.externalId)) {
      context.addIssue({
        code: 'custom',
        path: ['decisions', index, 'externalId'],
        message: 'duplicates another decision externalId.',
      });
    }
    seen.add(decision.externalId);
  }
});

export type CandidateReviewManifest = z.infer<typeof candidateReviewManifestSchema>;

export interface CandidateReviewSummary {
  batchId: string;
  appliedVerified: number;
  appliedRejected: number;
  matchedVerified: number;
  matchedRejected: number;
  state: 'inactive';
}

export function parseCandidateReviewManifest(
  input: unknown,
  batch: CandidateBatch,
  commandClock: Date,
): CandidateReviewManifest {
  return candidateReviewManifestSchema.superRefine((manifest, context) => {
    if (manifest.batchId !== batch.batchId) {
      context.addIssue({ code: 'custom', path: ['batchId'], message: 'must match the candidate batch.' });
    }
    const reviewedAt = new Date(manifest.reviewedAt).getTime();
    if (reviewedAt < new Date(batch.createdAt).getTime()) {
      context.addIssue({ code: 'custom', path: ['reviewedAt'], message: 'must not precede candidate batch creation.' });
    }
    if (reviewedAt > commandClock.getTime()) {
      context.addIssue({ code: 'custom', path: ['reviewedAt'], message: 'must not be later than the command clock.' });
    }
    const candidateIds = new Set(batch.questions.map(({ externalId }) => externalId));
    for (const [index, decision] of manifest.decisions.entries()) {
      if (!candidateIds.has(decision.externalId)) {
        context.addIssue({
          code: 'custom',
          path: ['decisions', index, 'externalId'],
          message: 'must identify a question in the candidate batch.',
        });
      }
    }
  }).parse(input);
}

export function readCandidateReviewManifestFile(
  path: string,
  batch: CandidateBatch,
  commandClock: Date,
): CandidateReviewManifest {
  return parseCandidateReviewManifest(readBoundedJsonFile(path), batch, commandClock);
}

export function candidateReviewPathArguments(rawArguments: string[]): [string, string] | undefined {
  const argumentsAfterCommand = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
  const candidatePath = argumentsAfterCommand[0];
  const manifestPath = argumentsAfterCommand[1];
  return argumentsAfterCommand.length === 2
    && candidatePath !== undefined
    && manifestPath !== undefined
    && candidatePath.trim().length > 0
    && manifestPath.trim().length > 0
    ? [candidatePath, manifestPath]
    : undefined;
}

export async function applyCandidateReview(
  database: PrismaClient,
  batch: CandidateBatch,
  manifest: CandidateReviewManifest,
): Promise<CandidateReviewSummary> {
  return database.$transaction(async (transaction) => {
    const candidates = new Map(batch.questions.map((question) => [question.externalId, question]));
    const decidedQuestions = manifest.decisions.map((decision) => {
      const candidate = candidates.get(decision.externalId);
      if (candidate === undefined) throw new Error('Review decision candidate is missing.');
      return { candidate, decision };
    });
    const categorySlugs = [...new Set(decidedQuestions.map(({ candidate }) => candidate.categorySlug))];
    const conceptSlugs = [...new Set(decidedQuestions.map(({ candidate }) => candidate.conceptSlug))];
    const categories = await transaction.category.findMany({
      where: { slug: { in: categorySlugs } },
      select: { id: true, slug: true },
    });
    const concepts = await transaction.concept.findMany({
      where: { slug: { in: conceptSlugs } },
      select: { id: true, slug: true },
    });
    if (categories.length !== categorySlugs.length || concepts.length !== conceptSlugs.length) {
      throw new Error('Review taxonomy reference is missing.');
    }
    const categoryIds = new Map(categories.map(({ id, slug }) => [slug, id]));
    const conceptIds = new Map(concepts.map(({ id, slug }) => [slug, id]));
    const reviewedAt = new Date(manifest.reviewedAt);
    let appliedVerified = 0;
    let appliedRejected = 0;
    let matchedVerified = 0;
    let matchedRejected = 0;

    for (const { candidate, decision } of decidedQuestions) {
      const categoryId = categoryIds.get(candidate.categorySlug);
      const conceptId = conceptIds.get(candidate.conceptSlug);
      if (categoryId === undefined || conceptId === undefined) throw new Error('Review taxonomy reference is missing.');
      const expected = mapCandidateQuestion(batch, candidate, categoryId, conceptId);
      const existing = await transaction.question.findUnique({
        where: { id: expected.question.id },
        include: { choices: true },
      });
      if (existing === null || existing.active || !candidateContentMatches(existing, expected)) {
        throw new Error('Reviewed candidate does not match imported content.');
      }

      if (existing.verificationStatus === 'DRAFT') {
        if (existing.reviewer !== null || existing.reviewedAt !== null) {
          throw new Error('Draft candidate contains conflicting review state.');
        }
        await transaction.question.update({
          where: { id: existing.id },
          data: {
            verificationStatus: decision.status,
            reviewer: manifest.reviewer,
            reviewedAt,
          },
        });
        if (decision.status === 'VERIFIED') appliedVerified += 1;
        else appliedRejected += 1;
        continue;
      }

      if (existing.verificationStatus !== decision.status
        || existing.reviewer !== manifest.reviewer
        || existing.reviewedAt?.getTime() !== reviewedAt.getTime()) {
        throw new Error('Candidate already has a conflicting final review decision.');
      }
      if (decision.status === 'VERIFIED') matchedVerified += 1;
      else matchedRejected += 1;
    }

    return {
      batchId: batch.batchId,
      appliedVerified,
      appliedRejected,
      matchedVerified,
      matchedRejected,
      state: 'inactive',
    };
  }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 5000 });
}
