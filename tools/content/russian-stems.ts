import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../../packages/database/src/index.ts';
import { candidateContentMatches, mapCandidateQuestion } from './candidate-import.ts';
import { reviewerIdentitySchema } from './candidate-review.ts';
import { candidateKeySchema, canonicalUtcInstantSchema, parseCandidateBatch, readBoundedJsonFile, type CandidateBatch } from './candidates.ts';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const russianText = z.string().min(1).max(4000)
  .refine((value) => value === value.trim() && /[А-Яа-яЁё]/u.test(value)
    && !/\p{Cc}|[\uD800-\uDFFF]/u.test(value));
const packSchema = z.strictObject({
  version: z.literal(1),
  packId: z.literal('launch-20261021-russian-stems'),
  createdAt: canonicalUtcInstantSchema,
  sources: z.array(z.strictObject({
    batchId: candidateKeySchema, sha256,
    reviewer: reviewerIdentitySchema, reviewedAt: canonicalUtcInstantSchema,
  })).length(2),
  translations: z.array(z.strictObject({
    batchId: candidateKeySchema, externalId: candidateKeySchema, textRussian: russianText,
  })).length(100),
});
const reviewSchema = z.strictObject({
  version: z.literal(1), packSha256: sha256, reviewer: reviewerIdentitySchema,
  reviewedAt: canonicalUtcInstantSchema, verdict: z.literal('PASS'),
});
export type RussianStemPack = z.infer<typeof packSchema>;
export type RussianStemReview = z.infer<typeof reviewSchema>;

/** Sorted object keys, preserved array order and JSON scalar semantics; no file-byte hashing. */
export function canonicalJsonSha256(input: unknown): string {
  function canonical(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
      return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
    }
    throw new Error('Invalid JSON value.');
  }
  return createHash('sha256').update(canonical(input), 'utf8').digest('hex');
}

export function parseRussianStemPack(input: unknown, batches: CandidateBatch[], clock: Date): RussianStemPack {
  const pack = packSchema.parse(input);
  if (!Number.isFinite(clock.getTime()) || new Date(pack.createdAt) > clock) throw new Error('Invalid pack time.');
  const expectedIds = ['launch-20261016-car', 'launch-20261016-motorcycle'];
  if (batches.length !== 2 || new Set(batches.map((batch) => batch.batchId)).size !== 2
    || new Set(pack.sources.map((source) => source.batchId)).size !== 2) throw new Error('Invalid source coverage.');
  const remaining = new Set<string>();
  for (const batch of batches) {
    const source = pack.sources.find((item) => item.batchId === batch.batchId);
    if (!expectedIds.includes(batch.batchId) || batch.questions.length !== 50 || !source
      || source.sha256 !== canonicalJsonSha256(batch)
      || new Date(source.reviewedAt) < new Date(batch.createdAt)
      || new Date(source.reviewedAt) > new Date(pack.createdAt)) throw new Error('Invalid source binding.');
    for (const question of batch.questions) {
      if (question.textRussian !== null
        || question.vehicleType !== (batch.batchId === expectedIds[0] ? 'CAR' : 'MOTORCYCLE')) throw new Error('Invalid source question.');
      remaining.add(`${batch.batchId}:${question.externalId}`);
    }
  }
  for (const item of pack.translations) {
    if (!remaining.delete(`${item.batchId}:${item.externalId}`)) throw new Error('Invalid translation coverage.');
  }
  if (remaining.size !== 0) throw new Error('Incomplete translation coverage.');
  return pack;
}

export function parseRussianStemReview(input: unknown, pack: RussianStemPack, clock: Date): RussianStemReview {
  const review = reviewSchema.parse(input);
  if (!Number.isFinite(clock.getTime()) || review.packSha256 !== canonicalJsonSha256(pack)
    || new Date(review.reviewedAt) < new Date(pack.createdAt) || new Date(review.reviewedAt) > clock
    || pack.sources.some((source) => new Date(review.reviewedAt) <= new Date(source.reviewedAt))) {
    throw new Error('Invalid translation review.');
  }
  return review;
}

export function readRussianStemInputs(paths: [string, string, string, string], clock: Date) {
  const [packPath, reviewPath, firstPath, secondPath] = paths;
  const batches = [firstPath, secondPath].map((path) => parseCandidateBatch(readBoundedJsonFile(path)));
  const pack = parseRussianStemPack(readBoundedJsonFile(packPath), batches, clock);
  const review = parseRussianStemReview(readBoundedJsonFile(reviewPath), pack, clock);
  return { batches, pack, review };
}

export async function overlayRussianStems(
  database: PrismaClient,
  inputs: ReturnType<typeof readRussianStemInputs>,
  apply = false,
) {
  // Revalidate the whole chain even for direct callers, before opening the transaction.
  const batches = inputs.batches.map(parseCandidateBatch);
  const pack = parseRussianStemPack(inputs.pack, batches, new Date());
  const review = parseRussianStemReview(inputs.review, pack, new Date());
  return database.$transaction(async (transaction) => {
    const questions = batches.flatMap((batch) => batch.questions.map((question) => ({ batch, question })));
    const [categories, concepts] = await Promise.all([
      transaction.category.findMany({ where: { slug: { in: questions.map(({ question }) => question.categorySlug) } } }),
      transaction.concept.findMany({ where: { slug: { in: questions.map(({ question }) => question.conceptSlug) } } }),
    ]);
    const categoryIds = new Map(categories.map(({ slug, id }) => [slug, id]));
    const conceptIds = new Map(concepts.map(({ slug, id }) => [slug, id]));
    const reviewedAt = new Date(review.reviewedAt);
    let wouldApply = 0;
    let matched = 0;
    for (const { batch, question } of questions) {
      const categoryId = categoryIds.get(question.categorySlug);
      const conceptId = conceptIds.get(question.conceptSlug);
      const source = pack.sources.find((item) => item.batchId === batch.batchId);
      const translation = pack.translations.find((item) => item.batchId === batch.batchId && item.externalId === question.externalId);
      if (!categoryId || !conceptId || !source || !translation) throw new Error('Translation reference mismatch.');
      const expected = mapCandidateQuestion(batch, question, categoryId, conceptId);
      const existing = await transaction.question.findUnique({ where: { id: expected.question.id }, include: { choices: true } });
      if (existing === null || !existing.active || existing.verificationStatus !== 'VERIFIED') throw new Error('Translation target mismatch.');
      if (existing.textRussian === translation.textRussian) {
        expected.question.textRussian = translation.textRussian;
        if (!candidateContentMatches(existing, expected) || existing.reviewer !== review.reviewer
          || existing.reviewedAt?.getTime() !== reviewedAt.getTime()) throw new Error('Translation replay conflict.');
        matched += 1;
      } else {
        if (!candidateContentMatches(existing, expected) || existing.reviewer !== source.reviewer
          || existing.reviewedAt?.toISOString() !== source.reviewedAt
          || reviewedAt.getTime() <= new Date(source.reviewedAt).getTime()) throw new Error('Translation source conflict.');
        wouldApply += 1;
        if (apply) await transaction.question.update({ where: { id: existing.id }, data: {
          textRussian: translation.textRussian, reviewer: review.reviewer, reviewedAt,
        } });
      }
    }
    return { wouldApply: apply ? 0 : wouldApply, applied: apply ? wouldApply : 0, matched };
  }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 5000 });
}
