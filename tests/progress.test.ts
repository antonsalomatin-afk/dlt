import { describe, expect, it } from 'vitest';
import { buildProgressSummary, progressResponseSchema } from '../packages/database/src/progress.ts';

describe('progress contracts', () => {
  it('accepts only the exact response envelope', () => {
    const progress = { answered: 3, correct: 2, incorrect: 1, accuracyPercent: 67 };
    expect(progressResponseSchema.parse(progress)).toEqual(progress);
    expect(progressResponseSchema.safeParse({ ...progress, extra: true }).success).toBe(false);
    expect(progressResponseSchema.safeParse({ answered: 3, correct: 2, incorrect: 1 }).success).toBe(false);
  });

  it('requires nonnegative safe integer counts with an exact sum', () => {
    const baseline = { answered: 2, correct: 1, incorrect: 1, accuracyPercent: 50 };
    for (const progress of [
      { ...baseline, answered: -1 },
      { ...baseline, correct: 0.5 },
      { ...baseline, incorrect: Number.MAX_SAFE_INTEGER + 1 },
      { ...baseline, answered: 3 },
      {
        answered: Number.MAX_SAFE_INTEGER,
        correct: Number.MAX_SAFE_INTEGER,
        incorrect: 1,
        accuracyPercent: 100,
      },
    ]) expect(progressResponseSchema.safeParse(progress).success).toBe(false);
  });

  it('requires null accuracy for empty progress and exact rounded accuracy otherwise', () => {
    expect(progressResponseSchema.parse({
      answered: 0, correct: 0, incorrect: 0, accuracyPercent: null,
    })).toEqual({ answered: 0, correct: 0, incorrect: 0, accuracyPercent: null });
    for (const progress of [
      { answered: 0, correct: 0, incorrect: 0, accuracyPercent: 0 },
      { answered: 3, correct: 2, incorrect: 1, accuracyPercent: 66 },
      { answered: 200, correct: 1, incorrect: 199, accuracyPercent: 0 },
      { answered: 1, correct: 1, incorrect: 0, accuracyPercent: null },
    ]) expect(progressResponseSchema.safeParse(progress).success).toBe(false);

    expect(progressResponseSchema.parse({
      answered: 200, correct: 1, incorrect: 199, accuracyPercent: 1,
    }).accuracyPercent).toBe(1);
  });

  it('builds an exact summary from strict unique outcome aggregates', () => {
    expect(buildProgressSummary([])).toEqual({
      answered: 0, correct: 0, incorrect: 0, accuracyPercent: null,
    });
    expect(buildProgressSummary([
      { isCorrect: false, _count: { _all: 5 } },
      { isCorrect: true, _count: { _all: 2 } },
    ])).toEqual({ answered: 7, correct: 2, incorrect: 5, accuracyPercent: 29 });
  });

  it('rejects impossible or unsafe aggregate data', () => {
    for (const rows of [
      [{ isCorrect: true, _count: { _all: 1 }, extra: true }],
      [{ isCorrect: true, _count: { _all: -1 } }],
      [{ isCorrect: true, _count: { _all: 0 } }],
      [{ isCorrect: true, _count: { _all: Number.MAX_SAFE_INTEGER + 1 } }],
      [
        { isCorrect: true, _count: { _all: 1 } },
        { isCorrect: true, _count: { _all: 2 } },
      ],
      [
        { isCorrect: true, _count: { _all: Number.MAX_SAFE_INTEGER } },
        { isCorrect: false, _count: { _all: 1 } },
      ],
    ]) expect(() => buildProgressSummary(rows)).toThrow();
  });
});
