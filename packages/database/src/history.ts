import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { presentedQuestionSchema } from './presentation.ts';

const canonicalTimestampSchema = z.iso.datetime().refine(
  (value) => {
    try { return new Date(value).toISOString() === value; }
    catch { return false; }
  },
  { message: 'Timestamp must use canonical ISO form' },
);
const historyCursorSchema = z.strictObject({
  v: z.literal(1),
  submittedAt: canonicalTimestampSchema,
  attemptId: z.uuid(),
});
const encodedCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u);
const rawHistoryQuerySchema = z.strictObject({
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/u).optional(),
  cursor: encodedCursorSchema.optional(),
});

export type HistoryCursor = z.infer<typeof historyCursorSchema>;

export const historyItemSchema = z.strictObject({
  presentationId: z.uuid(),
  submittedAt: canonicalTimestampSchema,
  selectedChoiceId: z.uuid(),
  correctChoiceId: z.uuid(),
  isCorrect: z.boolean(),
  question: presentedQuestionSchema,
  explanationThai: z.string().nullable(),
  explanationEnglish: z.string().nullable(),
  explanationRussian: z.string().nullable(),
  trapExplanationThai: z.string().nullable(),
  trapExplanationEnglish: z.string().nullable(),
  trapExplanationRussian: z.string().nullable(),
}).superRefine((item, context) => {
  if (!item.question.choices.some((choice) => choice.id === item.selectedChoiceId)) {
    context.addIssue({ code: 'custom', message: 'Selected choice is absent from snapshot' });
  }
  if (!item.question.choices.some((choice) => choice.id === item.correctChoiceId)) {
    context.addIssue({ code: 'custom', message: 'Correct choice is absent from snapshot' });
  }
  if (item.isCorrect !== (item.selectedChoiceId === item.correctChoiceId)) {
    context.addIssue({ code: 'custom', message: 'Persisted correctness is inconsistent' });
  }
});

export const historyResponseSchema = z.strictObject({
  items: z.array(historyItemSchema).max(50),
  nextCursor: encodedCursorSchema.nullable().superRefine((value, context) => {
    if (value === null) return;
    try { parseHistoryCursor(value); }
    catch { context.addIssue({ code: 'custom', message: 'Invalid next cursor' }); }
  }),
});

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  const parsed = historyCursorSchema.parse(cursor);
  const json = JSON.stringify({ v: parsed.v, submittedAt: parsed.submittedAt, attemptId: parsed.attemptId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function parseHistoryCursor(value: unknown): HistoryCursor {
  const encoded = encodedCursorSchema.parse(value);
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'));
  } catch {
    throw new Error('Invalid history cursor');
  }
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid history cursor');
  }
  const cursor = historyCursorSchema.parse(json);
  if (encodeHistoryCursor(cursor) !== encoded) throw new Error('Invalid history cursor');
  return cursor;
}

export function parseHistoryQuery(value: unknown): { limit: number; cursor: HistoryCursor | null } {
  const query = rawHistoryQuerySchema.parse(value);
  return {
    limit: query.limit === undefined ? 20 : Number(query.limit),
    cursor: query.cursor === undefined ? null : parseHistoryCursor(query.cursor),
  };
}
