import { z } from 'zod';
import type { PrismaClient } from '../../packages/database/src/index.ts';
import {
  candidateContentMatches,
  mapCandidateQuestion,
} from './candidate-import.ts';
import {
  reviewerIdentitySchema,
  type CandidateReviewManifest,
} from './candidate-review.ts';
import {
  candidateKeySchema,
  canonicalUtcInstantSchema,
  readBoundedJsonFile,
  type CandidateBatch,
} from './candidates.ts';

export const candidateActivationManifestSchema = z.strictObject({
  version: z.literal(1),
  batchId: candidateKeySchema,
  activatedBy: reviewerIdentitySchema,
  activatedAt: canonicalUtcInstantSchema,
  externalIds: z.array(candidateKeySchema)
    .min(1, 'must contain at least one external ID.')
    .max(500, 'must contain at most 500 external IDs.'),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const [index, externalId] of manifest.externalIds.entries()) {
    if (seen.has(externalId)) {
      context.addIssue({
        code: 'custom',
        path: ['externalIds', index],
        message: 'duplicates another activation external ID.',
      });
    }
    seen.add(externalId);
  }
});

export type CandidateActivationManifest = z.infer<typeof candidateActivationManifestSchema>;

export interface CandidateActivationSummary {
  batchId: string;
  applied: number;
  matched: number;
}

export function parseCandidateActivationManifest(
  input: unknown,
  batch: CandidateBatch,
  review: CandidateReviewManifest,
  commandClock: Date,
): CandidateActivationManifest {
  return candidateActivationManifestSchema.superRefine((manifest, context) => {
    if (manifest.batchId !== batch.batchId || manifest.batchId !== review.batchId) {
      context.addIssue({ code: 'custom', path: ['batchId'], message: 'must match the candidate and review batches.' });
    }
    const activatedAt = new Date(manifest.activatedAt).getTime();
    if (activatedAt < new Date(review.reviewedAt).getTime()) {
      context.addIssue({ code: 'custom', path: ['activatedAt'], message: 'must not precede the supplied review.' });
    }
    if (activatedAt > commandClock.getTime()) {
      context.addIssue({ code: 'custom', path: ['activatedAt'], message: 'must not be later than the command clock.' });
    }
    const candidateIds = new Set(batch.questions.map(({ externalId }) => externalId));
    const reviewDecisions = new Map(review.decisions.map((decision) => [decision.externalId, decision.status]));
    for (const [index, externalId] of manifest.externalIds.entries()) {
      if (!candidateIds.has(externalId)) {
        context.addIssue({
          code: 'custom',
          path: ['externalIds', index],
          message: 'must identify a question in the candidate batch.',
        });
      }
      if (reviewDecisions.get(externalId) !== 'VERIFIED') {
        context.addIssue({
          code: 'custom',
          path: ['externalIds', index],
          message: 'must have a VERIFIED decision in the supplied review.',
        });
      }
    }
  }).parse(input);
}

export function readCandidateActivationManifestFile(
  path: string,
  batch: CandidateBatch,
  review: CandidateReviewManifest,
  commandClock: Date,
): CandidateActivationManifest {
  return parseCandidateActivationManifest(readBoundedJsonFile(path), batch, review, commandClock);
}

export function candidateActivationPathArguments(rawArguments: string[]): [string, string, string] | undefined {
  const argumentsAfterCommand = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
  const candidatePath = argumentsAfterCommand[0];
  const reviewPath = argumentsAfterCommand[1];
  const activationPath = argumentsAfterCommand[2];
  return argumentsAfterCommand.length === 3
    && candidatePath !== undefined
    && reviewPath !== undefined
    && activationPath !== undefined
    && candidatePath.trim().length > 0
    && reviewPath.trim().length > 0
    && activationPath.trim().length > 0
    ? [candidatePath, reviewPath, activationPath]
    : undefined;
}

export async function activateCandidates(
  database: PrismaClient,
  batch: CandidateBatch,
  review: CandidateReviewManifest,
  activation: CandidateActivationManifest,
): Promise<CandidateActivationSummary> {
  return database.$transaction(async (transaction) => {
    const candidates = new Map(batch.questions.map((question) => [question.externalId, question]));
    const reviewDecisions = new Map(review.decisions.map((decision) => [decision.externalId, decision.status]));
    const selected = activation.externalIds.map((externalId) => {
      const candidate = candidates.get(externalId);
      if (candidate === undefined || reviewDecisions.get(externalId) !== 'VERIFIED') {
        throw new Error('Activation candidate is not verified by the supplied chain.');
      }
      return candidate;
    });
    const categorySlugs = [...new Set(selected.map(({ categorySlug }) => categorySlug))];
    const conceptSlugs = [...new Set(selected.map(({ conceptSlug }) => conceptSlug))];
    const categories = await transaction.category.findMany({
      where: { slug: { in: categorySlugs } },
      select: { id: true, slug: true },
    });
    const concepts = await transaction.concept.findMany({
      where: { slug: { in: conceptSlugs } },
      select: { id: true, slug: true },
    });
    if (categories.length !== categorySlugs.length || concepts.length !== conceptSlugs.length) {
      throw new Error('Activation taxonomy reference is missing.');
    }
    const categoryIds = new Map(categories.map(({ id, slug }) => [slug, id]));
    const conceptIds = new Map(concepts.map(({ id, slug }) => [slug, id]));
    const reviewedAt = new Date(review.reviewedAt);
    let applied = 0;
    let matched = 0;

    for (const candidate of selected) {
      const categoryId = categoryIds.get(candidate.categorySlug);
      const conceptId = conceptIds.get(candidate.conceptSlug);
      if (categoryId === undefined || conceptId === undefined) throw new Error('Activation taxonomy reference is missing.');
      const expected = mapCandidateQuestion(batch, candidate, categoryId, conceptId);
      const existing = await transaction.question.findUnique({
        where: { id: expected.question.id },
        include: { choices: true },
      });
      if (existing === null
        || !candidateContentMatches(existing, expected)
        || existing.verificationStatus !== 'VERIFIED'
        || existing.reviewer !== review.reviewer
        || existing.reviewedAt?.getTime() !== reviewedAt.getTime()) {
        throw new Error('Activation candidate does not match the verified review chain.');
      }
      if (existing.active) {
        matched += 1;
        continue;
      }
      await transaction.question.update({ where: { id: existing.id }, data: { active: true } });
      applied += 1;
    }

    return { batchId: batch.batchId, applied, matched };
  }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 5000 });
}
