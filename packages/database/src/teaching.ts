import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { z } from 'zod';
import type { Prisma } from './index.ts';
import { candidateChoiceId, candidateQuestionId, canonicalJsonSha256 } from './content-identity.ts';

export const TEACHING_PACK_SHA256 = '1465c7a1b6800b53a5172bf26dea7dffbc787ff6887dcd5894a9a31e23165c29';
export const TEACHING_REVIEW_SHA256 = 'c791ec616ab3e74f9c1c6f478c1c44260e120aa6f0dba73e6139e65719dbdd51';
const packId = z.literal('launch-20261023-bilingual-teaching');
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const key = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const choiceKey = z.enum(['A', 'B', 'C', 'D']);
const text = z.string().min(1).max(4000).refine((value) => value === value.trim()
  && !/\p{Cc}|[\uD800-\uDFFF]/u.test(value));
const russian = text.refine((value) => /[А-Яа-яЁё]/u.test(value));
const nullableText = text.nullable();
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const httpsUrl = text.refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && value.length <= 2048;
  } catch { return false; }
});
const sourcePaths = [
  'content/imports/launch-20261016-car-candidates.json',
  'content/imports/launch-20261016-motorcycle-candidates.json',
  'content/imports/launch-20261021-russian-stems.json',
] as const;
const sourceHash = z.strictObject({ path: z.enum(sourcePaths), sha256: sha });
const sourceHashes = z.array(sourceHash).length(3);
const identity = { batchId: key, externalId: key };
const statuteSchema = z.strictObject({
  titleEnglish: text, titleRussian: russian, section: z.literal('33'), url: httpsUrl,
  locator: text, sourceStatus: z.literal('UNOFFICIAL_ENGLISH_TRANSLATION'),
  excerptEnglish: text, summaryEnglish: text, summaryRussian: russian,
});
const entrySchema = z.strictObject({
  ...identity, textRussian: russian,
  choices: z.array(z.strictObject({ key: choiceKey, textRussian: russian })).length(4)
    .refine((choices) => new Set(choices.map(({ key }) => key)).size === 4),
  explanationRussian: russian, whyOthersWrongEnglish: text, whyOthersWrongRussian: russian,
  safetyReasonEnglish: text, safetyReasonRussian: russian,
  guidanceCitation: text, basisKind: z.literal('DLT_GUIDANCE'), statute: statuteSchema.nullable(),
});
const packSchema = z.strictObject({
  version: z.literal(1), packId, createdAt: instant, sources: sourceHashes,
  entries: z.array(entrySchema).length(100),
});
const sourceChoiceSchema = z.strictObject({ key: choiceKey, textThai: nullableText, textEnglish: text, textRussian: nullableText });
const sourceQuestionSchema = z.strictObject({
  externalId: key, vehicleType: z.enum(['CAR', 'MOTORCYCLE']), categorySlug: key, conceptSlug: key,
  source: z.strictObject({ type: z.enum(['ORIGINAL', 'OFFICIAL', 'THIRD_PARTY']), reference: text, sourceDate: date.nullable(), legalCitation: nullableText }),
  textThai: nullableText, textExamEnglish: nullableText, textEnglish: text, textRussian: nullableText,
  explanationThai: nullableText, explanationEnglish: nullableText, explanationRussian: nullableText,
  trapExplanationThai: nullableText, trapExplanationEnglish: nullableText, trapExplanationRussian: nullableText,
  choices: z.array(sourceChoiceSchema).length(4).refine((choices) => new Set(choices.map(({ key }) => key)).size === 4),
  correctChoiceKey: choiceKey,
});
const batchSchema = z.strictObject({ batchId: key, version: z.literal(1), createdAt: instant, questions: z.array(sourceQuestionSchema).length(50) });
const stemRecordSchema = z.strictObject({ ...identity, textRussian: russian });
const stemsSchema = z.strictObject({
  version: z.literal(1), packId: z.literal('launch-20261021-russian-stems'), createdAt: instant,
  sources: z.array(z.strictObject({ batchId: key, sha256: sha, reviewer: text, reviewedAt: instant })).length(2),
  translations: z.array(stemRecordSchema).length(100),
});
const pass = z.literal('PASS');
const reviewedEntrySchema = z.strictObject({
  ...identity, vehicleType: z.enum(['CAR', 'MOTORCYCLE']), entrySha256: sha, sourceQuestionSha256: sha, stemSha256: sha,
  correctChoiceKey: choiceKey, verdict: pass, allFourEnglishAndRussianChoicesRead: z.literal(true),
  sourceAndRussianExplanationRead: z.literal(true), bothDistractorAndSafetyLanguagesRead: z.literal(true),
  criteria: z.strictObject({
    choicesFaithfulWithoutAddedHints: pass, explanationTranslationFaithful: pass, actualDistractorMisconceptions: pass,
    practicalReasoningBounded: pass, acceptedStemExact: pass, guidanceCitationExactAndNotStatute: pass,
    optionalStatutoryExample: z.enum(['PASS_BOUNDED_SECTION_33_SOURCE_CHECK', 'NOT_PROVIDED']),
  }), rationale: text,
});
const reviewSchema = z.strictObject({
  version: z.literal(1), packId, packSha256: sha, canonicalAlgorithm: z.literal('SHA256_CANONICAL_JSON_V1'),
  canonicalDefinition: text, reviewer: text, reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/u), reviewedAt: instant,
  verdict: pass, sourceHashes,
  coverage: z.strictObject({ questions: z.literal(100), car: z.literal(50), motorcycle: z.literal(50), russianChoices: z.literal(400),
    statutoryExamples: z.literal(2), distinctStatutoryClauses: z.literal(1), statuteNull: z.literal(98) }),
  reviewBoundary: text,
  statutorySourceReview: z.strictObject({
    url: httpsUrl, section: z.literal('33'), pdfPage: z.literal(13), printedPage: z.literal(13),
    sourceStatus: z.literal('UNOFFICIAL_ENGLISH_TRANSLATION'), method: text,
    defaultAndAllThreeExceptionsRead: z.literal(true), titleAndTranslationDisclaimerRead: z.literal(true),
    bothKeepLeftQuestionsSupported: z.literal(true), summariesRetainExistenceOfExceptions: z.literal(true),
    thaiPromulgatedTextSoleLegalAuthorityAcknowledged: z.literal(true), currentConsolidatedThaiLawAuditPerformed: z.literal(false),
  }), entries: z.array(reviewedEntrySchema).length(100),
});

/** Optional, hidden immutable metadata; never part of the public pre-answer question. */
export const teachingMetadataSchema = z.strictObject({
  version: z.literal(1), packId, packSha256: z.literal(TEACHING_PACK_SHA256), reviewSha256: z.literal(TEACHING_REVIEW_SHA256),
  reviewer: text, reviewedAt: instant, reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  batchId: key, externalId: key, entrySha256: sha, sourceQuestionSha256: sha, stemSha256: sha,
  whyOthersWrongEnglish: text, whyOthersWrongRussian: russian, safetyReasonEnglish: text, safetyReasonRussian: russian,
  guidanceCitation: text, basisKind: z.literal('DLT_GUIDANCE'), statute: statuteSchema.nullable(),
});

function requireBinding(condition: boolean) {
  if (!condition) throw new Error('Reviewed teaching artifact binding is invalid.');
}
const identityOf = (value: { batchId: string; externalId: string }) => `${value.batchId}:${value.externalId}`;
function uniqueMap<T>(values: T[], keyOf: (value: T) => string) {
  const map = new Map(values.map((value) => [keyOf(value), value]));
  requireBinding(map.size === values.length);
  return map;
}

/** Pure validation seam. Runtime loading below supplies only the five fixed shipped artifacts. */
export function validateTeachingInputs(input: { pack: unknown; review: unknown; car: unknown; motorcycle: unknown; stems: unknown }, clock = new Date()) {
  const pack = packSchema.parse(input.pack);
  const review = reviewSchema.parse(input.review);
  const car = batchSchema.parse(input.car);
  const motorcycle = batchSchema.parse(input.motorcycle);
  const stems = stemsSchema.parse(input.stems);
  requireBinding(canonicalJsonSha256(pack) === TEACHING_PACK_SHA256
    && canonicalJsonSha256(review) === TEACHING_REVIEW_SHA256 && review.packSha256 === TEACHING_PACK_SHA256);
  requireBinding(Number.isFinite(clock.getTime()) && Date.parse(review.reviewedAt) <= clock.getTime()
    && Date.parse(review.reviewedAt) >= Date.parse(pack.createdAt) && Date.parse(stems.createdAt) <= Date.parse(pack.createdAt));
  const artifacts = [car, motorcycle, stems];
  const packSources = uniqueMap(pack.sources, ({ path }) => path);
  const reviewSources = uniqueMap(review.sourceHashes, ({ path }) => path);
  sourcePaths.forEach((path, index) => requireBinding(packSources.get(path)?.sha256 === canonicalJsonSha256(artifacts[index])
    && reviewSources.get(path)?.sha256 === packSources.get(path)?.sha256));
  const stemSources = uniqueMap(stems.sources, ({ batchId }) => batchId);
  for (const [index, batch] of [car, motorcycle].entries()) {
    requireBinding(batch.batchId === (index === 0 ? 'launch-20261016-car' : 'launch-20261016-motorcycle'));
    const source = stemSources.get(batch.batchId);
    requireBinding(source !== undefined && source.sha256 === canonicalJsonSha256(batch)
      && Date.parse(source.reviewedAt) >= Date.parse(batch.createdAt) && Date.parse(source.reviewedAt) <= Date.parse(stems.createdAt));
    requireBinding(batch.questions.every((question) => question.vehicleType === (index === 0 ? 'CAR' : 'MOTORCYCLE')));
  }
  const questions = uniqueMap([car, motorcycle].flatMap((batch) => batch.questions.map((question) => ({ batch, question }))),
    ({ batch, question }) => identityOf({ batchId: batch.batchId, externalId: question.externalId }));
  const translations = uniqueMap(stems.translations, identityOf);
  const reviews = uniqueMap(review.entries, identityOf);
  uniqueMap(pack.entries, identityOf);
  let statuteCount = 0;
  for (const entry of pack.entries) {
    const id = identityOf(entry);
    const source = questions.get(id);
    const stem = translations.get(id);
    const checked = reviews.get(id);
    requireBinding(source !== undefined && stem !== undefined && checked !== undefined);
    if (!source || !stem || !checked) throw new Error('Missing teaching reference.');
    requireBinding(checked.entrySha256 === canonicalJsonSha256(entry) && checked.sourceQuestionSha256 === canonicalJsonSha256(source.question)
      && checked.stemSha256 === canonicalJsonSha256(stem) && stem.textRussian === entry.textRussian
      && checked.vehicleType === source.question.vehicleType && checked.correctChoiceKey === source.question.correctChoiceKey
      && entry.guidanceCitation === source.question.source.legalCitation);
    const url = entry.guidanceCitation.match(/https:\/\/\S+$/u)?.[0];
    requireBinding(url !== undefined && httpsUrl.safeParse(url).success);
    if (entry.statute !== null) {
      statuteCount += 1;
      requireBinding(checked.criteria.optionalStatutoryExample === 'PASS_BOUNDED_SECTION_33_SOURCE_CHECK'
        && entry.statute.url === review.statutorySourceReview.url);
    } else requireBinding(checked.criteria.optionalStatutoryExample === 'NOT_PROVIDED');
  }
  requireBinding(statuteCount === 2);
  return { pack, review, car, motorcycle, stems };
}

function readStaticJson(relativePath: string): unknown {
  const descriptor = openSync(new URL(`../../../${relativePath}`, import.meta.url), 'r');
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > 2 * 1024 * 1024) throw new Error('Invalid teaching artifact size.');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== bytes.length || fstatSync(descriptor).size !== stat.size) throw new Error('Teaching artifact changed while reading.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally { closeSync(descriptor); }
}

let cached: ReturnType<typeof validateTeachingInputs> | undefined;
function shippedTeaching() {
  cached ??= validateTeachingInputs({
    pack: readStaticJson('content/imports/launch-20261023-bilingual-teaching.json'),
    review: readStaticJson('.agent/reviews/TASK-084-content-review-01.json'),
    car: readStaticJson(sourcePaths[0]), motorcycle: readStaticJson(sourcePaths[1]), stems: readStaticJson(sourcePaths[2]),
  });
  return cached;
}

type QuestionSource = Prisma.QuestionGetPayload<{ include: { choices: true } }>;
/** A drifted or unrelated row receives no overlay. Source rows are never written or mutated. */
export function reviewedTeachingForQuestion(source: QuestionSource) {
  if (!source.active || source.verificationStatus !== 'VERIFIED') return undefined;
  const inputs = shippedTeaching();
  for (const batch of [inputs.car, inputs.motorcycle]) {
    const original = batch.questions.find((question) => candidateQuestionId(1, batch.batchId, question.externalId) === source.id);
    if (!original) continue;
    const entry = inputs.pack.entries.find((item) => item.batchId === batch.batchId && item.externalId === original.externalId);
    const review = inputs.review.entries.find((item) => item.batchId === batch.batchId && item.externalId === original.externalId);
    if (!entry || !review) throw new Error('Missing reviewed teaching.');
    const fields = ['vehicleType', 'textThai', 'textExamEnglish', 'textEnglish', 'explanationThai', 'explanationEnglish',
      'trapExplanationThai', 'trapExplanationEnglish', 'trapExplanationRussian'] as const;
    if (fields.some((field) => source[field] !== original[field]) || source.textRussian !== entry.textRussian
      || (source.explanationRussian !== null && source.explanationRussian !== entry.explanationRussian)
      || source.imageReference !== null || source.sourceType !== original.source.type || source.sourceReference !== original.source.reference
      || (source.sourceDate?.getTime() ?? null) !== (original.source.sourceDate === null ? null : Date.parse(`${original.source.sourceDate}T00:00:00.000Z`))
      || source.legalCitation !== original.source.legalCitation || source.choices.length !== 4) return undefined;
    for (const choice of original.choices) {
      const stored = source.choices.find((item) => item.key === choice.key);
      const translated = entry.choices.find((item) => item.key === choice.key);
      if (!stored || !translated || stored.id !== candidateChoiceId(source.id, choice.key) || stored.questionId !== source.id
        || stored.textThai !== choice.textThai || stored.textEnglish !== choice.textEnglish
        || (stored.textRussian !== null && stored.textRussian !== translated.textRussian)
        || stored.isCorrect !== (choice.key === original.correctChoiceKey)) return undefined;
    }
    const teaching = teachingMetadataSchema.parse({
      version: 1, packId: inputs.pack.packId, packSha256: TEACHING_PACK_SHA256, reviewSha256: TEACHING_REVIEW_SHA256,
      reviewer: inputs.review.reviewer, reviewedAt: inputs.review.reviewedAt, reviewedCommit: inputs.review.reviewedCommit,
      batchId: batch.batchId, externalId: original.externalId, entrySha256: review.entrySha256,
      sourceQuestionSha256: review.sourceQuestionSha256, stemSha256: review.stemSha256,
      whyOthersWrongEnglish: entry.whyOthersWrongEnglish, whyOthersWrongRussian: entry.whyOthersWrongRussian,
      safetyReasonEnglish: entry.safetyReasonEnglish, safetyReasonRussian: entry.safetyReasonRussian,
      guidanceCitation: entry.guidanceCitation, basisKind: entry.basisKind, statute: entry.statute,
    });
    return { teaching, choices: entry.choices.map((choice) => ({ ...choice })), explanationRussian: entry.explanationRussian };
  }
  return undefined;
}
