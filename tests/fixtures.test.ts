import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateFixtures } from '../tools/content/fixtures.ts';

export function loadFixtures() {
  const input: unknown = JSON.parse(readFileSync(new URL('../content/fixtures/development.json', import.meta.url), 'utf8'));
  return validateFixtures(input);
}

describe('development fixture validation', () => {
  it('accepts exactly 25 synthetic questions spanning five categories and both vehicles', () => {
    const data = loadFixtures();
    expect(data.questions).toHaveLength(25);
    expect(new Set(data.questions.map(({ category }) => category)).size).toBe(5);
    expect(new Set(data.questions.map(({ vehicleType }) => vehicleType)).size).toBe(2);
  });
  it('rejects wrong counts, duplicate identities/choices, invalid answers and blank text', () => {
    const original = loadFixtures();
    const first = original.questions[0];
    if (!first) throw new Error('Missing fixture');
    const invalid: unknown[] = [
      { ...original, questions: original.questions.slice(1) },
      { ...original, questions: original.questions.map(() => first) },
      { ...original, sourceType: 'OFFICIAL' },
      { ...original, active: true },
      { ...original, categories: original.categories.slice(1) },
      { ...original, questions: original.questions.map((q) => ({ ...q, vehicleType: 'CAR' })) },
    ];
    for (const badQuestion of [
      { ...first, textEnglish: ' ' },
      { ...first, choices: first.choices.slice(1) },
      { ...first, choices: first.choices.map((c) => ({ ...c, key: 'A' })) },
      { ...first, choices: first.choices.map((c) => ({ ...c, isCorrect: false })) },
      { ...first, choices: first.choices.map((c) => ({ ...c, isCorrect: true })) },
      { ...first, textExamEnglish: 'Official DLT question' },
    ]) invalid.push({ ...original, questions: [badQuestion, ...original.questions.slice(1)] });
    for (const input of invalid) expect(() => validateFixtures(input)).toThrow('Invalid development fixtures');
  });
});
