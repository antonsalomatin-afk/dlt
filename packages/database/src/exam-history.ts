import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { EXAM_DURATION_MS, EXAM_PASSING_SCORE, EXAM_QUESTION_COUNT } from './exam.ts';

const canonicalTimestampSchema = z.iso.datetime().refine(
  (value) => {
    try { return new Date(value).toISOString() === value; }
    catch { return false; }
  },
  { message: 'Timestamp must use canonical ISO form' },
);
const canonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase());
const examHistoryCursorSchema = z.strictObject({
  v: z.literal(1),
  startedAt: canonicalTimestampSchema,
  examId: canonicalUuidSchema,
});
const encodedCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u);
const rawExamHistoryQuerySchema = z.strictObject({
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/u).optional(),
  cursor: encodedCursorSchema.optional(),
});

export type ExamHistoryCursor = z.infer<typeof examHistoryCursorSchema>;
export type ExamHistoryStatus = 'IN_PROGRESS' | 'EXPIRED' | 'COMPLETED';

export const examHistoryItemSchema = z.strictObject({
  examId: canonicalUuidSchema,
  vehicleType: z.enum(['CAR', 'MOTORCYCLE']),
  status: z.enum(['IN_PROGRESS', 'EXPIRED', 'COMPLETED']),
  questionCount: z.literal(EXAM_QUESTION_COUNT),
  passingScore: z.literal(EXAM_PASSING_SCORE),
  answeredCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  startedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
  completedAt: canonicalTimestampSchema.nullable(),
  score: z.number().int().min(0).max(EXAM_QUESTION_COUNT).nullable(),
  passed: z.boolean().nullable(),
}).superRefine((item, context) => {
  if (new Date(item.expiresAt).getTime() - new Date(item.startedAt).getTime() !== EXAM_DURATION_MS) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration is invalid' });
  }
  const completed = item.status === 'COMPLETED';
  if ((item.completedAt !== null) !== completed || (item.score !== null) !== completed || (item.passed !== null) !== completed) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Exam completion tuple must match status' });
  }
  if (item.completedAt !== null && new Date(item.completedAt).getTime() < new Date(item.startedAt).getTime()) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Exam completion precedes start' });
  }
  if (item.score !== null && item.score > item.answeredCount) {
    context.addIssue({ code: 'custom', path: ['score'], message: 'Exam score cannot exceed answered count' });
  }
  if (item.score !== null && item.passed !== (item.score >= item.passingScore)) {
    context.addIssue({ code: 'custom', path: ['passed'], message: 'Exam pass result is inconsistent' });
  }
});

export const examHistoryResponseSchema = z.strictObject({
  items: z.array(examHistoryItemSchema).max(50),
  nextCursor: encodedCursorSchema.nullable().superRefine((value, context) => {
    if (value === null) return;
    try { parseExamHistoryCursor(value); }
    catch { context.addIssue({ code: 'custom', message: 'Invalid next cursor' }); }
  }),
});

export function examHistoryStatus(
  exam: { expiresAt: Date; completedAt: Date | null },
  referenceTime: Date,
): ExamHistoryStatus {
  if (exam.completedAt !== null) return 'COMPLETED';
  return exam.expiresAt.getTime() > referenceTime.getTime() ? 'IN_PROGRESS' : 'EXPIRED';
}

export function encodeExamHistoryCursor(cursor: ExamHistoryCursor): string {
  const parsed = examHistoryCursorSchema.parse(cursor);
  const json = JSON.stringify({ v: parsed.v, startedAt: parsed.startedAt, examId: parsed.examId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function parseExamHistoryCursor(value: unknown): ExamHistoryCursor {
  const encoded = encodedCursorSchema.parse(value);
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'));
  } catch {
    throw new Error('Invalid exam history cursor');
  }
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid exam history cursor');
  }
  const cursor = examHistoryCursorSchema.parse(json);
  if (encodeExamHistoryCursor(cursor) !== encoded) throw new Error('Invalid exam history cursor');
  return cursor;
}

export function parseExamHistoryQuery(value: unknown): { limit: number; cursor: ExamHistoryCursor | null } {
  const query = rawExamHistoryQuerySchema.parse(value);
  return {
    limit: query.limit === undefined ? 20 : Number(query.limit),
    cursor: query.cursor === undefined ? null : parseExamHistoryCursor(query.cursor),
  };
}
