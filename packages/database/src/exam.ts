import { z } from 'zod';
import { presentedQuestionSchema } from './presentation.ts';

export const EXAM_QUESTION_COUNT = 50;
export const EXAM_PASSING_SCORE = 45;
export const EXAM_DURATION_MS = 60 * 60 * 1_000;
export const EXAM_ELIGIBLE_LIMIT = 10_000;

export type ExamRandomOffset = (remainingCount: number) => unknown;

const canonicalTimestampSchema = z.string().refine((value) => {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
});

export const examStartRequestSchema = z.strictObject({});

export const examStartResponseSchema = z.strictObject({
  examId: z.uuid(),
  vehicleType: z.enum(['CAR', 'MOTORCYCLE']),
  questionCount: z.literal(EXAM_QUESTION_COUNT),
  passingScore: z.literal(EXAM_PASSING_SCORE),
  startedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
  questions: z.array(z.strictObject({
    examQuestionId: z.uuid(),
    position: z.number().int().min(1).max(EXAM_QUESTION_COUNT),
    question: presentedQuestionSchema,
  })).length(EXAM_QUESTION_COUNT),
}).superRefine((response, context) => {
  if (new Date(response.expiresAt).getTime() - new Date(response.startedAt).getTime() !== EXAM_DURATION_MS) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration is invalid' });
  }
  if (response.questions.some((question, index) => question.position !== index + 1)) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Exam positions must be consecutive' });
  }
  if (new Set(response.questions.map(({ examQuestionId }) => examQuestionId)).size !== EXAM_QUESTION_COUNT) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Exam question IDs must be unique' });
  }
  if (new Set(response.questions.map(({ question }) => question.id)).size !== EXAM_QUESTION_COUNT) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Source question IDs must be unique' });
  }
});

export function sampleExamQuestionIds(questionIds: readonly string[], randomOffset: ExamRandomOffset): string[] {
  if (
    questionIds.length < EXAM_QUESTION_COUNT
    || questionIds.length > EXAM_ELIGIBLE_LIMIT
    || new Set(questionIds).size !== questionIds.length
  ) throw new Error('Eligible exam question IDs are invalid');

  const pool = [...questionIds];
  const selected: string[] = [];
  for (let index = 0; index < EXAM_QUESTION_COUNT; index++) {
    const remainingCount = pool.length - index;
    const offset = randomOffset(remainingCount);
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset >= remainingCount) {
      throw new Error('Random offset is outside the remaining exam question range');
    }
    const selectedIndex = index + offset;
    [pool[index], pool[selectedIndex]] = [pool[selectedIndex] as string, pool[index] as string];
    selected.push(pool[index] as string);
  }
  return selected;
}
