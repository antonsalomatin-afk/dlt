import { z } from 'zod';
import { progressResponseSchema } from './progress.ts';

const safeCountSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
const trimmedNonblankString = z.string().min(1).refine((value) => value === value.trim());

const conceptProgressRowSchema = z.strictObject({
  conceptId: z.uuid().nullable(),
  slug: trimmedNonblankString.nullable(),
  nameThai: trimmedNonblankString.nullable(),
  nameEnglish: trimmedNonblankString.nullable(),
  nameRussian: trimmedNonblankString.nullable(),
  correct: safeCountSchema,
  incorrect: safeCountSchema,
}).refine((row) => {
  const assigned = row.conceptId !== null;
  return [row.slug, row.nameThai, row.nameEnglish, row.nameRussian].every((value) => (value !== null) === assigned);
}, { message: 'Concept identity must be complete or entirely absent' })
  .refine((row) => row.correct + row.incorrect > 0 && Number.isSafeInteger(row.correct + row.incorrect), { message: 'Concept rows must carry answers' });

export const conceptProgressItemSchema = z.strictObject({
  conceptId: z.uuid(),
  slug: trimmedNonblankString,
  nameThai: trimmedNonblankString,
  nameEnglish: trimmedNonblankString,
  nameRussian: trimmedNonblankString,
  answered: safeCountSchema.refine((count) => count > 0),
  correct: safeCountSchema,
  incorrect: safeCountSchema,
  accuracyPercent: z.number().int().min(0).max(100),
}).superRefine((item, context) => {
  if (item.correct + item.incorrect !== item.answered) context.addIssue({ code: 'custom', message: 'Concept counts are inconsistent' });
  if (item.accuracyPercent !== Math.round((item.correct / item.answered) * 100)) context.addIssue({ code: 'custom', message: 'Concept accuracy is inconsistent' });
});

export const conceptProgressResponseSchema = z.strictObject({
  concepts: z.array(conceptProgressItemSchema).max(500),
  unassigned: progressResponseSchema,
  total: progressResponseSchema,
}).superRefine((response, context) => {
  if (new Set(response.concepts.map((item) => item.conceptId)).size !== response.concepts.length) {
    context.addIssue({ code: 'custom', path: ['concepts'], message: 'Concept IDs must be unique' });
  }
  const correct = response.concepts.reduce((sum, item) => sum + item.correct, response.unassigned.correct);
  const incorrect = response.concepts.reduce((sum, item) => sum + item.incorrect, response.unassigned.incorrect);
  if (response.total.correct !== correct || response.total.incorrect !== incorrect) {
    context.addIssue({ code: 'custom', path: ['total'], message: 'Total must equal the sum of concepts and unassigned' });
  }
  for (let index = 1; index < response.concepts.length; index++) {
    const previous = response.concepts[index - 1];
    const current = response.concepts[index];
    if (!previous || !current) continue;
    const ordered = previous.accuracyPercent < current.accuracyPercent
      || (previous.accuracyPercent === current.accuracyPercent && (previous.answered > current.answered
        || (previous.answered === current.answered && previous.slug < current.slug)));
    if (!ordered) context.addIssue({ code: 'custom', path: ['concepts', index], message: 'Concepts must be ordered weakest first' });
  }
});

function summary(correct: number, incorrect: number) {
  const answered = correct + incorrect;
  return progressResponseSchema.parse({ answered, correct, incorrect, accuracyPercent: answered === 0 ? null : Math.round((correct / answered) * 100) });
}

export function buildConceptProgress(rows: unknown) {
  const parsed = z.array(conceptProgressRowSchema).max(500).parse(rows);
  const unassignedRows = parsed.filter((row) => row.conceptId === null);
  if (unassignedRows.length > 1) throw new Error('Unassigned concept progress must aggregate to one row');
  const concepts = parsed.flatMap((row) => {
    if (row.conceptId === null || row.slug === null || row.nameThai === null || row.nameEnglish === null || row.nameRussian === null) return [];
    const answered = row.correct + row.incorrect;
    return [{
      conceptId: row.conceptId, slug: row.slug, nameThai: row.nameThai, nameEnglish: row.nameEnglish, nameRussian: row.nameRussian,
      answered, correct: row.correct, incorrect: row.incorrect, accuracyPercent: Math.round((row.correct / answered) * 100),
    }];
  }).sort((left, right) => left.accuracyPercent - right.accuracyPercent || right.answered - left.answered || (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0));
  const unassigned = summary(unassignedRows[0]?.correct ?? 0, unassignedRows[0]?.incorrect ?? 0);
  const total = summary(
    parsed.reduce((sum, row) => sum + row.correct, 0),
    parsed.reduce((sum, row) => sum + row.incorrect, 0),
  );
  return conceptProgressResponseSchema.parse({ concepts, unassigned, total });
}
