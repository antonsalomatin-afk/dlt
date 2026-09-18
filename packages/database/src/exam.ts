import { z } from 'zod';
import { presentedQuestionSchema } from './presentation.ts';

export const EXAM_QUESTION_COUNT = 50;
export const EXAM_PASSING_SCORE = 45;
export const EXAM_DURATION_MS = 60 * 60 * 1_000;
export const EXAM_ELIGIBLE_LIMIT = 10_000;
export const EXAM_START_MAX_ATTEMPTS = 6;

const EXAM_START_RETRY_BASE_DELAY_MS = 10;
const EXAM_START_RETRY_MAX_DELAY_MS = 80;

export type ExamRandomOffset = (remainingCount: number) => unknown;
export type ExamRetryWait = (delayMs: number) => Promise<void>;

const canonicalTimestampSchema = z.string().refine((value) => {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
});

const canonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase());

export const examStartRequestSchema = z.strictObject({});

export function examStartRetryDelayMs(failedAttempt: number) {
  if (!Number.isSafeInteger(failedAttempt) || failedAttempt < 1 || failedAttempt >= EXAM_START_MAX_ATTEMPTS) {
    throw new Error('Failed exam start attempt is outside the retry range');
  }
  return Math.min(
    EXAM_START_RETRY_BASE_DELAY_MS * (2 ** (failedAttempt - 1)),
    EXAM_START_RETRY_MAX_DELAY_MS,
  );
}

const waitForExamRetry: ExamRetryWait = (delayMs) => new Promise((resolve) => {
  setTimeout(resolve, delayMs);
});

export async function retryExamStart<T>(
  operation: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  wait: ExamRetryWait = waitForExamRetry,
) {
  for (let attempt = 1; attempt <= EXAM_START_MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt === EXAM_START_MAX_ATTEMPTS) throw error;
      await wait(examStartRetryDelayMs(attempt));
    }
  }
  throw new Error('Exam start retry did not resolve');
}

export const examAnswerRequestSchema = z.strictObject({
  examQuestionId: canonicalUuidSchema,
  choiceId: canonicalUuidSchema,
});

export const examCompleteRequestSchema = z.strictObject({
  examId: canonicalUuidSchema,
});

export const examAnswerResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  examQuestionId: canonicalUuidSchema,
  selectedChoiceId: canonicalUuidSchema,
  answeredAt: canonicalTimestampSchema,
  answeredCount: z.number().int().min(1).max(EXAM_QUESTION_COUNT),
  remainingCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT - 1),
}).refine(
  ({ answeredCount, remainingCount }) => answeredCount + remainingCount === EXAM_QUESTION_COUNT,
  { path: ['remainingCount'], message: 'Exam answer counts must total 50' },
);

export const examCompleteResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  questionCount: z.literal(EXAM_QUESTION_COUNT),
  answeredCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  unansweredCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  score: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  passingScore: z.literal(EXAM_PASSING_SCORE),
  passed: z.boolean(),
  completedAt: canonicalTimestampSchema,
}).superRefine((response, context) => {
  if (response.answeredCount + response.unansweredCount !== EXAM_QUESTION_COUNT) {
    context.addIssue({ code: 'custom', path: ['unansweredCount'], message: 'Exam completion counts must total 50' });
  }
  if (response.score > response.answeredCount) {
    context.addIssue({ code: 'custom', path: ['score'], message: 'Exam score cannot exceed answered count' });
  }
  if (response.passed !== (response.score >= response.passingScore)) {
    context.addIssue({ code: 'custom', path: ['passed'], message: 'Exam pass result is inconsistent' });
  }
});

export function summarizeExamOutcomes(outcomes: readonly (boolean | null)[]) {
  if (outcomes.length !== EXAM_QUESTION_COUNT) throw new Error('Exam outcome cardinality is invalid');
  const answeredCount = outcomes.reduce((count, outcome) => count + (outcome === null ? 0 : 1), 0);
  const score = outcomes.reduce((count, outcome) => count + (outcome === true ? 1 : 0), 0);
  return {
    answeredCount,
    unansweredCount: EXAM_QUESTION_COUNT - answeredCount,
    score,
    passed: score >= EXAM_PASSING_SCORE,
  };
}

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
