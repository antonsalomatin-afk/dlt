import { describe, expect, it } from 'vitest';
import { progressResponseSchema } from '../apps/web/lib/contracts.ts';

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
