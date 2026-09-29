import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateFixtures } from '../tools/content/fixtures.ts';

export function loadFixtures() {
  const input: unknown = JSON.parse(readFileSync(new URL('../content/fixtures/development.json', import.meta.url), 'utf8'));
  return validateFixtures(input);
}

describe('development fixture validation', () => {
  it('accepts 10 localized concepts grouping all 25 questions across categories and vehicles', () => {
    const data = loadFixtures();
    const references = new Map(data.concepts.map(({ key }) => [key, 0]));
    for (const question of data.questions) references.set(question.concept, (references.get(question.concept) ?? 0) + 1);
    expect(data.concepts).toHaveLength(10);
    expect(new Set(data.concepts.map(({ key }) => key)).size).toBe(10);
    expect([...references.values()].every((count) => count >= 2)).toBe(true);
    expect(data.questions).toHaveLength(25);
    expect(new Set(data.questions.map(({ category }) => category)).size).toBe(5);
    expect(new Set(data.questions.map(({ vehicleType }) => vehicleType)).size).toBe(2);
  });
  it('rejects malformed concept declarations and question assignments', () => {
    const original = loadFixtures();
    const firstConcept = original.concepts[0];
    const secondConcept = original.concepts[1];
    const firstQuestion = original.questions[0];
    if (!firstConcept || !secondConcept || !firstQuestion) throw new Error('Missing fixture');
    const firstReference = original.questions.findIndex(({ concept }) => concept === firstConcept.key);
    const invalid: unknown[] = [
      { ...original, concepts: original.concepts.slice(1) },
      { ...original, concepts: original.concepts.map(() => firstConcept) },
      { ...original, concepts: original.concepts.map((concept, index) => index === 0 ? { ...concept, key: ' invalid-key' } : concept) },
      { ...original, concepts: original.concepts.map((concept, index) => index === 0 ? { ...concept, nameEnglish: ' ' } : concept) },
      { ...original, concepts: original.concepts.map((concept, index) => index === 0 ? { ...concept, nameRussian: ` ${concept.nameRussian}` } : concept) },
      { ...original, concepts: original.concepts.map((concept, index) => index === 0 ? { ...concept, extra: true } : concept) },
      { ...original, questions: original.questions.map((question, index) => index === 0 ? { ...question, concept: undefined } : question) },
      { ...original, questions: original.questions.map((question, index) => index === 0 ? { ...question, concept: 'unknown-concept' } : question) },
      { ...original, questions: original.questions.map((question) => question.concept === firstConcept.key
        ? { ...question, concept: secondConcept.key } : question) },
      { ...original, questions: original.questions.map((question, index) => index === firstReference
        ? { ...question, concept: secondConcept.key } : question) },
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
