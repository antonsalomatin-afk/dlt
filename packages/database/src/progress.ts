import { z } from 'zod';

const safeCountSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
const safePositiveCountSchema = safeCountSchema.refine((count) => count > 0);

export const progressResponseSchema = z.strictObject({
  answered: safeCountSchema,
  correct: safeCountSchema,
  incorrect: safeCountSchema,
  accuracyPercent: z.number().int().min(0).max(100).nullable(),
}).superRefine((progress, context) => {
  const answered = progress.correct + progress.incorrect;
  if (!Number.isSafeInteger(answered) || progress.answered !== answered) {
    context.addIssue({ code: 'custom', message: 'Progress counts are inconsistent' });
  }
  const expectedAccuracy = progress.answered === 0
    ? null
    : Math.round((progress.correct / progress.answered) * 100);
  if (progress.accuracyPercent !== expectedAccuracy) {
    context.addIssue({ code: 'custom', message: 'Progress accuracy is inconsistent' });
  }
});

const progressAggregateRowsSchema = z.array(z.strictObject({
  isCorrect: z.boolean(),
  _count: z.strictObject({ _all: safePositiveCountSchema }),
})).max(2).refine(
  (rows) => new Set(rows.map((row) => row.isCorrect)).size === rows.length,
  { message: 'Progress aggregate outcomes must be unique' },
);

export function buildProgressSummary(rows: unknown) {
  const aggregates = progressAggregateRowsSchema.parse(rows);
  let correct = 0;
  let incorrect = 0;
  for (const aggregate of aggregates) {
    if (aggregate.isCorrect) correct = aggregate._count._all;
    else incorrect = aggregate._count._all;
  }
  const answered = correct + incorrect;
  return progressResponseSchema.parse({
    answered,
    correct,
    incorrect,
    accuracyPercent: answered === 0 ? null : Math.round((correct / answered) * 100),
  });
}
