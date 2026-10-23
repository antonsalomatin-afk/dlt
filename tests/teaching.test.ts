import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../packages/database/src/index.ts';
import { expect, it } from 'vitest';
import { candidateChoiceId, candidateQuestionId, canonicalJsonSha256 } from '../packages/database/src/content-identity.ts';
import { mapCandidateQuestion, candidateQuestionId as toolQuestionId, candidateChoiceId as toolChoiceId } from '../tools/content/candidate-import.ts';
import { canonicalJsonSha256 as toolHash } from '../tools/content/russian-stems.ts';
import { TEACHING_PACK_SHA256, TEACHING_REVIEW_SHA256, validateTeachingInputs } from '../packages/database/src/teaching.ts';
import { parsePresentationSnapshot, presentationResponseSchema, snapshotQuestion } from '../packages/database/src/presentation.ts';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as unknown;
const inputs = validateTeachingInputs({
  pack: read('content/imports/launch-20261023-bilingual-teaching.json'), review: read('.agent/reviews/TASK-084-content-review-01.json'),
  car: read('content/imports/launch-20261016-car-candidates.json'), motorcycle: read('content/imports/launch-20261016-motorcycle-candidates.json'),
  stems: read('content/imports/launch-20261021-russian-stems.json'),
});
const now = new Date();
function row(batch = inputs.car, index = 0): Prisma.QuestionGetPayload<{ include: { choices: true } }> {
  const original = batch.questions[index]!;
  const mapped = mapCandidateQuestion(batch, original, randomUUID(), randomUUID());
  const entry = inputs.pack.entries.find((item) => item.batchId === batch.batchId && item.externalId === original.externalId)!;
  return {
    ...mapped.question, verificationStatus: 'VERIFIED' as const, active: true, textRussian: entry.textRussian,
    createdAt: now, updatedAt: now,
    choices: mapped.choices,
  };
}
const enriched = (source = row()) => snapshotQuestion(source, { reviewedTeaching: true });

it('validates the actual complete independent review and preserves stable public helper compatibility', () => {
  expect(canonicalJsonSha256(inputs.pack)).toBe(TEACHING_PACK_SHA256);
  expect(canonicalJsonSha256(inputs.review)).toBe(TEACHING_REVIEW_SHA256);
  expect(toolHash).toBe(canonicalJsonSha256);
  expect(toolQuestionId).toBe(candidateQuestionId);
  expect(toolChoiceId).toBe(candidateChoiceId);
  expect(canonicalJsonSha256({ b: ['ё', 2], a: 1 })).toBe(canonicalJsonSha256({ a: 1, b: ['ё', 2] }));
  expect(canonicalJsonSha256([1, 2])).not.toBe(canonicalJsonSha256([2, 1]));
  for (const invalid of [undefined, Number.NaN, new Date(), { value: undefined }]) expect(() => canonicalJsonSha256(invalid)).toThrow();
  expect(inputs.review.entries).toHaveLength(100);
  expect(inputs.pack.entries.flatMap(({ choices }) => choices)).toHaveLength(400);
  const statutes = inputs.pack.entries.filter(({ statute }) => statute !== null);
  expect(statutes).toHaveLength(2);
  expect(new Set(statutes.map(({ statute }) => statute?.section))).toEqual(new Set(['33']));
  expect(statutes.every(({ statute }) => statute?.sourceStatus === 'UNOFFICIAL_ENGLISH_TRANSLATION')).toBe(true);
});

it('enriches every exact current launch source without changing source rows, IDs, English, answers or option order', () => {
  let count = 0;
  for (const batch of [inputs.car, inputs.motorcycle]) for (let index = 0; index < batch.questions.length; index += 1) {
    const source = row(batch, index);
    // Deliberately use a different order: the overlay maps by immutable key, never by position.
    source.choices.reverse();
    const before = structuredClone(source);
    const base = snapshotQuestion(source);
    const snapshot = enriched(source);
    const entry = inputs.pack.entries.find((item) => item.batchId === batch.batchId && item.externalId === batch.questions[index]!.externalId)!;
    expect(source).toEqual(before);
    expect(base.teaching).toBeUndefined();
    expect(base.explanationRussian).toBeNull();
    expect(base.question.choices.every(({ textRussian }) => textRussian === null)).toBe(true);
    expect(snapshot.correctChoiceId).toBe(base.correctChoiceId);
    expect(snapshot.question.choices.map(({ id, key, textEnglish }) => ({ id, key, textEnglish })))
      .toEqual(base.question.choices.map(({ id, key, textEnglish }) => ({ id, key, textEnglish })));
    expect(snapshot.explanationEnglish).toBe(base.explanationEnglish);
    expect(snapshot.explanationRussian).toBe(entry.explanationRussian);
    expect(snapshot.teaching).toMatchObject({ packSha256: TEACHING_PACK_SHA256, reviewSha256: TEACHING_REVIEW_SHA256,
      whyOthersWrongEnglish: entry.whyOthersWrongEnglish, statute: entry.statute });
    for (const choice of snapshot.question.choices) expect(choice.textRussian).toBe(entry.choices.find(({ key }) => key === choice.key)?.textRussian);
    expect(parsePresentationSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    count += 1;
  }
  expect(count).toBe(100);
});

it('keeps default/exam and legacy snapshots unchanged and excludes all hidden metadata from existing public DTOs', () => {
  const source = row();
  const legacy = snapshotQuestion(source);
  expect(parsePresentationSnapshot(legacy)).toEqual(legacy);
  const snapshot = enriched(source);
  const dto = presentationResponseSchema.parse({ presentationId: randomUUID(), question: snapshot.question });
  expect(Object.keys(dto.question).sort()).toEqual(['choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai']);
  const json = JSON.stringify(dto);
  for (const secret of ['teaching', 'correctChoiceId', 'explanation', 'statute', 'guidanceCitation', 'safetyReason', 'whyOthersWrong', TEACHING_PACK_SHA256]) expect(json).not.toContain(secret);
  expect(() => presentationResponseSchema.parse({ ...dto, teaching: snapshot.teaching })).toThrow();
  expect(() => parsePresentationSnapshot({ ...snapshot, teaching: { ...snapshot.teaching, extra: true } })).toThrow();
  expect(() => parsePresentationSnapshot({ ...snapshot, teaching: { ...snapshot.teaching, statute: { ...snapshot.teaching?.statute, sourceStatus: 'OFFICIAL' } } })).toThrow();
  expect(() => parsePresentationSnapshot({ ...snapshot, teaching: { ...snapshot.teaching, statute: { ...snapshot.teaching?.statute, url: 'https://user:password@example.com/' } } })).toThrow();
  snapshot.teaching!.statute!.summaryEnglish = 'Caller mutation';
  expect(enriched(source).teaching?.statute?.summaryEnglish).not.toBe('Caller mutation');
});

it('retains un-enriched behavior for unrelated, ineligible, drifted or translation-conflicting sources', () => {
  const changes: Array<(source: ReturnType<typeof row>) => void> = [
    (source) => { source.id = randomUUID(); }, (source) => { source.active = false; },
    (source) => { source.textEnglish += ' changed'; }, (source) => { source.textThai = 'changed'; },
    (source) => { source.textExamEnglish = 'changed'; }, (source) => { source.textRussian = null; },
    (source) => { source.textRussian += ' конфликт'; }, (source) => { source.explanationEnglish += ' changed'; },
    (source) => { source.explanationRussian = 'Другая версия'; }, (source) => { source.trapExplanationEnglish = 'changed'; },
    (source) => { source.sourceReference += '-changed'; }, (source) => { source.sourceDate = new Date('2026-10-16T01:00:00Z'); },
    (source) => { source.legalCitation += ' changed'; }, (source) => { source.imageReference = 'https://example.com/a.png'; },
    (source) => { source.choices[0]!.id = randomUUID(); }, (source) => { source.choices[0]!.questionId = randomUUID(); },
    (source) => { source.choices[0]!.textEnglish += ' changed'; }, (source) => { source.choices[0]!.textRussian = 'Конфликт'; },
    (source) => { source.choices[0]!.isCorrect = false; source.choices[1]!.isCorrect = true; },
  ];
  for (const change of changes) {
    const source = row(); change(source);
    expect(enriched(source)).toEqual(snapshotQuestion(source));
  }
  expect(enriched({ ...row(), verificationStatus: 'DRAFT' }).teaching).toBeUndefined();
  const alreadyTranslated = row();
  const approved = enriched(alreadyTranslated);
  alreadyTranslated.explanationRussian = approved.explanationRussian;
  alreadyTranslated.choices = alreadyTranslated.choices.map((choice) => ({ ...choice,
    textRussian: approved.question.choices.find(({ id }) => id === choice.id)!.textRussian }));
  expect(enriched(alreadyTranslated)).toEqual(approved);
});

it('rejects pack/source/stem/review tampering, incomplete or duplicate identities, declarations and unsafe content', () => {
  type Inputs = typeof inputs;
  const changes: Array<(value: Inputs) => void> = [
    (value) => { value.pack.entries.pop(); }, (value) => { value.pack.entries[1] = value.pack.entries[0]!; },
    (value) => { value.pack.entries[0]!.choices[0]!.textRussian += ' неверно'; },
    (value) => { value.pack.entries[0]!.choices[1]!.key = 'A'; },
    (value) => { value.pack.entries[0]!.safetyReasonEnglish = 'unsafe\ntext'; },
    (value) => { value.pack.entries[0]!.safetyReasonEnglish = 'x'.repeat(4001); },
    (value) => { value.pack.entries[0]!.statute = null; },
    (value) => { value.pack.sources[0]!.sha256 = '0'.repeat(64); },
    (value) => { value.car.questions[0]!.textEnglish += ' changed'; },
    (value) => { value.car.questions[0]!.correctChoiceKey = 'B'; },
    (value) => { value.car.questions[1] = value.car.questions[0]!; },
    (value) => { value.stems.translations[0]!.textRussian += ' изменено'; },
    (value) => { value.stems.translations.pop(); },
    (value) => { value.review.entries.pop(); },
    (value) => { value.review.entries[1] = value.review.entries[0]!; },
    (value) => { value.review.entries[0]!.stemSha256 = canonicalJsonSha256(value.stems.translations[0]!.textRussian); },
    (value) => { value.review.entries[0]!.sourceQuestionSha256 = '0'.repeat(64); },
    (value) => { value.review.entries[0]!.entrySha256 = '0'.repeat(64); },
    (value) => { value.review.entries[0]!.criteria.optionalStatutoryExample = 'NOT_PROVIDED'; },
    (value) => { value.review.reviewedAt = '2026-10-22T00:00:00.000Z'; },
    (value) => { value.review.reviewedAt = '2026-02-30T00:00:00.000Z'; },
  ];
  for (const change of changes) { const value = structuredClone(inputs); change(value); expect(() => validateTeachingInputs(value)).toThrow(); }
  for (const value of [
    { ...inputs, review: { ...inputs.review, verdict: 'FAIL' } },
    { ...inputs, review: { ...inputs.review, entries: inputs.review.entries.map((entry, index) => index === 0 ? { ...entry, allFourEnglishAndRussianChoicesRead: false } : entry) } },
    { ...inputs, pack: { ...inputs.pack, entries: inputs.pack.entries.map((entry, index) => index === 0 ? { ...entry, statute: { ...entry.statute, sourceStatus: 'OFFICIAL' } } : entry) } },
    { ...inputs, pack: { ...inputs.pack, extra: true } },
    { ...inputs, review: null },
  ]) expect(() => validateTeachingInputs(value)).toThrow();
  expect(() => validateTeachingInputs(inputs, new Date('2026-10-23T10:00:00.000Z'))).toThrow();
  expect(() => validateTeachingInputs(inputs, new Date('invalid'))).toThrow();
});
