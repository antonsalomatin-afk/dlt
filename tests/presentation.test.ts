import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { parsePresentationSnapshot, practiceNextRequestSchema } from '../packages/database/src/presentation.ts';

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

it('accepts one optional strict category or concept UUID selector for the next question', () => {
  const categoryId = randomUUID();
  const conceptId = randomUUID();
  for (const value of [undefined, {}, { categoryId }, { conceptId }]) {
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
    { conceptId: null },
    { conceptId: 'not-a-uuid' },
    { conceptId: [conceptId, conceptId] },
    { conceptId, unknown: true },
    { categoryId, conceptId },
  ]) expect(practiceNextRequestSchema.safeParse(value).success).toBe(false);
});
