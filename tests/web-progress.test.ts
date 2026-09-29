import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  appendConceptProgressPage,
  conceptProgressResponseSchema,
  progressResponseSchema,
} from '../apps/web/lib/contracts.ts';

describe('Mini App progress contract', () => {
  it('accepts only the exact internally consistent summary', () => {
    const summary = { answered: 3, correct: 2, incorrect: 1, accuracyPercent: 67 };
    expect(progressResponseSchema.parse(summary)).toEqual(summary);
    expect(progressResponseSchema.parse({ answered: 0, correct: 0, incorrect: 0, accuracyPercent: null })).toEqual({
      answered: 0, correct: 0, incorrect: 0, accuracyPercent: null,
    });

    for (const invalid of [
      { ...summary, extra: true },
      { answered: 3, correct: 2, incorrect: 1 },
      { ...summary, answered: 3.5 },
      { ...summary, answered: Number.MAX_SAFE_INTEGER + 1 },
      { ...summary, answered: -1 },
      { ...summary, correct: 1 },
      { ...summary, accuracyPercent: 66 },
      { ...summary, accuracyPercent: null },
      { answered: 0, correct: 0, incorrect: 0, accuracyPercent: 0 },
      { ...summary, accuracyPercent: 101 },
    ]) expect(progressResponseSchema.safeParse(invalid).success).toBe(false);
  });
});

const conceptId = randomUUID();
const timestamp = '2026-09-29T12:00:00.000Z';
const concept = {
  conceptId,
  slug: 'right-of-way',
  nameThai: 'สิทธิ์ทาง',
  nameEnglish: 'Right of way',
  nameRussian: 'Преимущество',
  practice: { answered: 3, correct: 3, incorrect: 0, lastAnsweredAt: timestamp },
  exam: { answered: 2, correct: 1, incorrect: 1, lastAnsweredAt: timestamp },
  total: { answered: 5, correct: 4, incorrect: 1, accuracyPercent: 80 },
  masteryStatus: 'MASTERED' as const,
  lastActivityAt: timestamp,
};

const cursorFor = (item: { conceptId: string; lastActivityAt: string }) => btoa(JSON.stringify({
  v: 1, lastActivityAt: item.lastActivityAt, conceptId: item.conceptId,
})).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');

describe('Mini App concept progress contract', () => {
  it('accepts exact mixed-channel facts, mastery and an anchored canonical cursor', () => {
    const page = { items: [concept], nextCursor: cursorFor(concept) };
    expect(conceptProgressResponseSchema.parse(page)).toEqual(page);
    expect(appendConceptProgressPage([], page)).toEqual([concept]);
    const roundedToEighty = {
      ...concept,
      practice: { answered: 47, correct: 38, incorrect: 9, lastAnsweredAt: timestamp },
      total: { answered: 49, correct: 39, incorrect: 10, accuracyPercent: 80 },
      masteryStatus: 'LEARNING' as const,
    };
    expect(conceptProgressResponseSchema.parse({ items: [roundedToEighty], nextCursor: null }).items[0]?.masteryStatus).toBe('LEARNING');
  });

  it('rejects threshold, arithmetic, privacy, timestamp, ordering and cursor inconsistencies', () => {
    const earlier = {
      ...concept,
      conceptId: '00000000-0000-4000-8000-000000000001',
      practice: { answered: 4, correct: 4, incorrect: 0, lastAnsweredAt: '2026-09-29T11:00:00.000Z' },
      exam: { answered: 0, correct: 0, incorrect: 0, lastAnsweredAt: null },
      total: { answered: 4, correct: 4, incorrect: 0, accuracyPercent: 100 },
      masteryStatus: 'LEARNING' as const,
      lastActivityAt: '2026-09-29T11:00:00.000Z',
    };
    for (const invalid of [
      { items: [{ ...concept, masteryStatus: 'LEARNING' }], nextCursor: null },
      { items: [{ ...earlier, masteryStatus: 'MASTERED' }], nextCursor: null },
      { items: [{ ...concept, total: { ...concept.total, accuracyPercent: 79 } }], nextCursor: null },
      { items: [{ ...concept, userId: randomUUID() }], nextCursor: null },
      { items: [{ ...concept, nameEnglish: ' Right of way' }], nextCursor: null },
      { items: [earlier, concept], nextCursor: null },
      { items: [concept, concept], nextCursor: null },
      { items: [concept], nextCursor: cursorFor(earlier) },
    ]) expect(conceptProgressResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects duplicate and nondecreasing items across otherwise valid pages', () => {
    const laterPage = conceptProgressResponseSchema.parse({ items: [concept], nextCursor: null });
    expect(() => appendConceptProgressPage([concept], laterPage)).toThrow('repeats');
    const newer = { ...concept, conceptId: randomUUID(), lastActivityAt: '2026-09-29T13:00:00.000Z',
      practice: { ...concept.practice, lastAnsweredAt: '2026-09-29T13:00:00.000Z' },
      exam: { ...concept.exam, lastAnsweredAt: '2026-09-29T13:00:00.000Z' } };
    expect(() => appendConceptProgressPage([concept], { items: [newer], nextCursor: null })).toThrow('out of order');
  });
});
