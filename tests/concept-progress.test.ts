import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildConceptProgress, conceptProgressResponseSchema } from '../packages/database/src/concept-progress.ts';

const concept = (slug: string, correct: number, incorrect: number, conceptId: string = randomUUID()) => ({
  conceptId, slug, nameThai: `ไทย ${slug}`, nameEnglish: `English ${slug}`, nameRussian: `Русский ${slug}`, correct, incorrect,
});
const unassigned = (correct: number, incorrect: number) => ({ conceptId: null, slug: null, nameThai: null, nameEnglish: null, nameRussian: null, correct, incorrect });

describe('concept progress', () => {
  it('builds an empty response without rows', () => {
    expect(buildConceptProgress([])).toEqual({
      concepts: [],
      unassigned: { answered: 0, correct: 0, incorrect: 0, accuracyPercent: null },
      total: { answered: 0, correct: 0, incorrect: 0, accuracyPercent: null },
    });
  });

  it('orders concepts weakest first and reconciles the total with the unassigned bucket', () => {
    const rows = [concept('signs', 2, 0), concept('law', 1, 1), concept('hazards', 2, 2), concept('grip', 0, 3), unassigned(1, 2)];
    const response = buildConceptProgress(rows);
    expect(response.concepts.map((item) => [item.slug, item.answered, item.accuracyPercent])).toEqual([
      ['grip', 3, 0], ['hazards', 4, 50], ['law', 2, 50], ['signs', 2, 100],
    ]);
    expect(response.unassigned).toEqual({ answered: 3, correct: 1, incorrect: 2, accuracyPercent: 33 });
    expect(response.total).toEqual({ answered: 14, correct: 6, incorrect: 8, accuracyPercent: 43 });
    expect(Object.keys(response.concepts[0] ?? {})).toEqual(['conceptId', 'slug', 'nameThai', 'nameEnglish', 'nameRussian', 'answered', 'correct', 'incorrect', 'accuracyPercent']);
  });

  it('rejects inconsistent aggregate rows', () => {
    for (const rows of [
      [{ ...concept('a', 1, 0), extra: true }],
      [concept('a', 0, 0)],
      [concept('a', -1, 2)],
      [concept('a', 1.5, 0)],
      [{ ...concept('a', 1, 0), slug: null }],
      [{ ...unassigned(1, 0), slug: 'orphan' }],
      [unassigned(1, 0), unassigned(0, 1)],
      [concept('a', 1, 0, 'not-a-uuid')],
      [{ ...concept(' padded ', 1, 0) }],
    ]) expect(() => buildConceptProgress(rows)).toThrow();
  });

  it('enforces the strict response invariants', () => {
    const response = buildConceptProgress([concept('a', 1, 1), concept('b', 2, 0)]);
    expect(conceptProgressResponseSchema.parse(response)).toEqual(response);
    const [weak, strong] = response.concepts;
    if (!weak || !strong) throw new Error('Missing concepts');
    for (const invalid of [
      { ...response, concepts: [strong, weak] },
      { ...response, concepts: [weak, { ...strong, conceptId: weak.conceptId }] },
      { ...response, total: { ...response.total, correct: 4, answered: 5, accuracyPercent: 80 } },
      { ...response, concepts: [{ ...weak, accuracyPercent: 100 }, strong] },
      { ...response, concepts: [{ ...weak, answered: 3 }, strong] },
      { ...response, extra: true },
    ]) expect(conceptProgressResponseSchema.safeParse(invalid).success).toBe(false);
  });
});
