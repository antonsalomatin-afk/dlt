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
    const conceptKeys = new Set(data.concepts.map(({ key }) => key));
    expect(data.questions.every(({ concept }) => conceptKeys.has(concept))).toBe(true);
    expect(new Set(data.questions.map(({ concept }) => concept)).size).toBe(conceptKeys.size);
    expect(data.questions.filter(({ concept }) => concept === data.questions[0]?.concept).length).toBeGreaterThanOrEqual(2);
  });
  it('rejects undeclared, unreferenced, duplicate and ungrouped concepts', () => {
    const original = loadFixtures();
    const firstConcept = original.concepts[0];
    if (!firstConcept) throw new Error('Missing concept fixture');
    const invalid: unknown[] = [
      { ...original, concepts: [] },
      { ...original, concepts: [...original.concepts, { ...firstConcept, key: 'unreferenced-concept' }] },
      { ...original, concepts: [...original.concepts, firstConcept] },
      { ...original, concepts: original.concepts.map((concept) => ({ ...concept, nameEnglish: ' ' })) },
      { ...original, questions: original.questions.map((question, index) => (index === 0 ? { ...question, concept: 'undeclared-concept' } : question)) },
      { ...original, questions: original.questions.map((question) => Object.fromEntries(Object.entries(question).filter(([key]) => key !== 'concept'))) },
      {
        ...original,
        concepts: original.questions.map(({ id }) => ({ ...firstConcept, key: `${id}-solo` })),
        questions: original.questions.map((question) => ({ ...question, concept: `${question.id}-solo` })),
      },
    ];
    for (const input of invalid) expect(() => validateFixtures(input)).toThrow('Invalid development fixtures');
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
