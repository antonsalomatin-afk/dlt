import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { dailyPracticeResponseSchema } from '../apps/web/lib/contracts.ts';

const uuid = (value: number) => `550e8400-e29b-41d4-a716-${value.toString().padStart(12, '0')}`;
const valid = {
  day: '2026-10-03',
  presentationId: uuid(1),
  answered: false,
  question: {
    id: uuid(2),
    textThai: 'คำถาม',
    textExamEnglish: null,
    textEnglish: 'Which action is safe?',
    textRussian: null,
    choices: ['A', 'B', 'C', 'D'].map((key, index) => ({
      id: uuid(10 + index), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
    })),
  },
};

describe('Mini App daily-practice browser contract', () => {
  it('accepts only the exact privacy-safe response', () => {
    expect(dailyPracticeResponseSchema.parse(valid)).toEqual(valid);
    expect(dailyPracticeResponseSchema.parse({ ...valid, answered: true })).toEqual({ ...valid, answered: true });
    for (const payload of [
      { ...valid, correctChoiceId: uuid(10) },
      { ...valid, learnerId: uuid(99) },
      { ...valid, question: { ...valid.question, explanationEnglish: 'hidden' } },
    ]) expect(dailyPracticeResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects noncanonical dates and identifiers', () => {
    for (const payload of [
      { ...valid, day: '2026-02-29' },
      { ...valid, day: '2026-1-01' },
      { ...valid, presentationId: valid.presentationId.toUpperCase() },
      { ...valid, question: { ...valid.question, id: valid.question.id.toUpperCase() } },
      { ...valid, question: { ...valid.question, choices: valid.question.choices.map((choice, index) => index === 0 ? { ...choice, id: choice.id.toUpperCase() } : choice) } },
    ]) expect(dailyPracticeResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects malformed and internally inconsistent safe questions', () => {
    for (const question of [
      { ...valid.question, textEnglish: '   ' },
      { ...valid.question, choices: valid.question.choices.slice(1) },
      { ...valid.question, choices: valid.question.choices.map((choice, index) => index === 1 ? { ...choice, id: valid.question.choices[0]?.id } : choice) },
      { ...valid.question, choices: valid.question.choices.map((choice, index) => index === 1 ? { ...choice, key: 'A' } : choice) },
    ]) expect(dailyPracticeResponseSchema.safeParse({ ...valid, question }).success).toBe(false);
  });

  it('keeps the daily API behind one explicit Next rewrite', async () => {
    const source = await readFile(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
    expect(source.match(/'\/practice\/daily'/gu)).toHaveLength(1);
    expect(source).toContain('destination: `${origin}${path}`');
  });
});
