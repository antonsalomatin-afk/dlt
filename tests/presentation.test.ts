import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { parsePresentationSnapshot, practiceNextRequestSchema, retryMistakeRequestSchema, selectRetryCandidateSet } from '../packages/database/src/presentation.ts';

const choices = (['A', 'B', 'C', 'D'] as const).map((key) => ({ id: randomUUID(), key, textThai: null, textEnglish: key, textRussian: null }));
const valid = { version: 1, question: { id: randomUUID(), textThai: null, textExamEnglish: null, textEnglish: 'Question', textRussian: null, choices }, correctChoiceId: choices[0]?.id, explanationThai: null, explanationEnglish: null, explanationRussian: null, trapExplanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null };
it('validates snapshot reads and rejects corrupt or unsupported snapshots', () => {
  expect(parsePresentationSnapshot(valid)).toEqual(valid);
  for (const value of [null, { ...valid, version: 2 }, { ...valid, correctChoiceId: randomUUID() }, { ...valid, extra: true }]) expect(() => parsePresentationSnapshot(value)).toThrow();
  for (const question of [
    { ...valid.question, textEnglish: '   ' },
    { ...valid.question, choices: choices.slice(1) },
    { ...valid.question, choices: [...choices, choices[0]] },
    { ...valid.question, choices: choices.map((choice) => ({ ...choice, id: choices[0]?.id })) },
    { ...valid.question, choices: choices.map((choice) => ({ ...choice, key: 'A' })) },
    { ...valid.question, choices: choices.map((choice) => ({ ...choice, textEnglish: '' })) },
    { ...valid.question, choices: choices.map((choice) => ({ ...choice, id: 'invalid' })) },
  ]) expect(() => parsePresentationSnapshot({ ...valid, question })).toThrow();
});

it('accepts only an optional strict category UUID selector for the next question', () => {
  const categoryId = randomUUID();
  for (const value of [undefined, {}, { categoryId }]) {
    expect(practiceNextRequestSchema.safeParse(value).success).toBe(true);
  }
  for (const value of [
    null,
    [],
    { categoryId: null },
    { categoryId: 'not-a-uuid' },
    { categoryId: [categoryId, categoryId] },
    { unknown: true },
    { categoryId, unknown: true },
  ]) expect(practiceNextRequestSchema.safeParse(value).success).toBe(false);
});

it('accepts only one canonical presentation UUID for mistake retry', () => {
  const presentationId = randomUUID();
  expect(retryMistakeRequestSchema.safeParse({ presentationId }).success).toBe(true);
  for (const value of [
    undefined, null, {}, [], presentationId,
    { presentationId: null }, { presentationId: 'not-a-uuid' },
    { presentationId: [presentationId] }, { presentationId, extra: true },
  ]) expect(retryMistakeRequestSchema.safeParse(value).success).toBe(false);
});

it('uses the alternative pool when present and the inclusive fallback only otherwise', () => {
  expect(selectRetryCandidateSet(3, 4, (count) => { expect(count).toBe(3); return 2; }))
    .toEqual({ candidateCount: 3, excludeSource: true, offset: 2 });
  expect(selectRetryCandidateSet(0, 1, (count) => { expect(count).toBe(1); return 0; }))
    .toEqual({ candidateCount: 1, excludeSource: false, offset: 0 });
  let called = false;
  expect(selectRetryCandidateSet(0, 0, () => { called = true; return 0; })).toBeNull();
  expect(called).toBe(false);
  for (const offset of [-1, 1, 0.5, Number.NaN, undefined, null]) {
    expect(() => selectRetryCandidateSet(0, 1, () => offset)).toThrow();
  }
  for (const counts of [[-1, 0], [2, 1], [0.5, 1], [0, Number.MAX_SAFE_INTEGER + 1]]) {
    expect(() => selectRetryCandidateSet(counts[0]!, counts[1]!, () => 0)).toThrow();
  }
});
