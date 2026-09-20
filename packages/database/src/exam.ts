import { z } from 'zod';
import { parsePresentationSnapshot, presentedQuestionSchema } from './presentation.ts';

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

export type ExamQuestionRecord = {
  id: string;
  position: number;
  questionId: string;
  snapshot: unknown;
  selectedChoiceId: string | null;
  isCorrect: boolean | null;
  answeredAt: Date | null;
};

export type ExamSessionRecord = {
  questionCount: number;
  passingScore: number;
  startedAt: Date;
  expiresAt: Date;
  questions: readonly ExamQuestionRecord[];
};

export type ExamCompletionTuple = { completedAt: Date; score: number; passed: boolean };

/**
 * Shared authoritative validation for persisted exam rows. Completion and review both derive
 * every outcome from the immutable snapshot and the stored answer tuple; mutable source content
 * is never consulted. Any inconsistency fails closed.
 */
export function validateExamSessionRows(exam: ExamSessionRecord) {
  if (
    exam.questionCount !== EXAM_QUESTION_COUNT
    || exam.passingScore !== EXAM_PASSING_SCORE
    || exam.expiresAt.getTime() - exam.startedAt.getTime() !== EXAM_DURATION_MS
    || exam.questions.length !== EXAM_QUESTION_COUNT
    || exam.questions.some((question, index) => question.position !== index + 1)
    || new Set(exam.questions.map(({ id }) => id)).size !== EXAM_QUESTION_COUNT
    || new Set(exam.questions.map(({ questionId }) => questionId)).size !== EXAM_QUESTION_COUNT
  ) throw new Error('Stored exam session configuration is inconsistent');

  const rows = exam.questions.map((question) => {
    const snapshot = parsePresentationSnapshot(question.snapshot);
    if (snapshot.question.id !== question.questionId) throw new Error('Stored exam snapshot is inconsistent');
    const tuple = [question.selectedChoiceId, question.isCorrect, question.answeredAt];
    const nullCount = tuple.filter((value) => value === null).length;
    if (nullCount === tuple.length) return { question, snapshot, outcome: null };
    if (nullCount !== 0) throw new Error('Stored exam answer tuple is incomplete');
    const { selectedChoiceId, isCorrect, answeredAt } = question;
    if (
      selectedChoiceId === null
      || isCorrect === null
      || answeredAt === null
      || !snapshot.question.choices.some(({ id }) => id === selectedChoiceId)
      || isCorrect !== (selectedChoiceId === snapshot.correctChoiceId)
      || answeredAt.getTime() < exam.startedAt.getTime()
      || answeredAt.getTime() >= exam.expiresAt.getTime()
    ) throw new Error('Stored exam answer is inconsistent');
    return { question, snapshot, outcome: isCorrect };
  });
  return { rows, summary: summarizeExamOutcomes(rows.map(({ outcome }) => outcome)) };
}

/** Returns the persisted completion tuple, null when the exam is still open, and throws on a partial tuple. */
export function readExamCompletionTuple(
  exam: { completedAt: Date | null; score: number | null; passed: boolean | null },
): ExamCompletionTuple | null {
  const tuple = [exam.completedAt, exam.score, exam.passed];
  const nullCount = tuple.filter((value) => value === null).length;
  if (nullCount === tuple.length) return null;
  if (nullCount !== 0 || exam.completedAt === null || exam.score === null || exam.passed === null) {
    throw new Error('Stored exam completion tuple is incomplete');
  }
  return { completedAt: exam.completedAt, score: exam.score, passed: exam.passed };
}

export const examResultParamsSchema = z.strictObject({
  examId: canonicalUuidSchema,
});

const nullableTranslationSchema = z.string().nullable();

export const examResultQuestionSchema = z.strictObject({
  examQuestionId: canonicalUuidSchema,
  position: z.number().int().min(1).max(EXAM_QUESTION_COUNT),
  question: presentedQuestionSchema,
  selectedChoiceId: canonicalUuidSchema.nullable(),
  correctChoiceId: canonicalUuidSchema,
  isCorrect: z.boolean().nullable(),
  answeredAt: canonicalTimestampSchema.nullable(),
  explanationThai: nullableTranslationSchema,
  explanationEnglish: nullableTranslationSchema,
  explanationRussian: nullableTranslationSchema,
  trapExplanationThai: nullableTranslationSchema,
  trapExplanationEnglish: nullableTranslationSchema,
  trapExplanationRussian: nullableTranslationSchema,
}).superRefine((row, context) => {
  if (!row.question.choices.some(({ id }) => id === row.correctChoiceId)) {
    context.addIssue({ code: 'custom', path: ['correctChoiceId'], message: 'Correct choice is absent from snapshot' });
  }
  const nullCount = [row.selectedChoiceId, row.isCorrect, row.answeredAt].filter((value) => value === null).length;
  if (nullCount !== 0 && nullCount !== 3) {
    context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Exam answer tuple must be all null or all present' });
  }
  if (row.selectedChoiceId !== null) {
    if (!row.question.choices.some(({ id }) => id === row.selectedChoiceId)) {
      context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Selected choice is absent from snapshot' });
    }
    if (row.isCorrect !== (row.selectedChoiceId === row.correctChoiceId)) {
      context.addIssue({ code: 'custom', path: ['isCorrect'], message: 'Exam correctness is inconsistent' });
    }
  }
});

export const examResultResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  vehicleType: z.enum(['CAR', 'MOTORCYCLE']),
  questionCount: z.literal(EXAM_QUESTION_COUNT),
  answeredCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  unansweredCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  score: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  passingScore: z.literal(EXAM_PASSING_SCORE),
  passed: z.boolean(),
  startedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
  completedAt: canonicalTimestampSchema,
  questions: z.array(examResultQuestionSchema).length(EXAM_QUESTION_COUNT),
}).superRefine((response, context) => {
  if (new Date(response.expiresAt).getTime() - new Date(response.startedAt).getTime() !== EXAM_DURATION_MS) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration is invalid' });
  }
  if (new Date(response.completedAt).getTime() < new Date(response.startedAt).getTime()) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Exam completion precedes start' });
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
  const answeredCount = response.questions.filter(({ selectedChoiceId }) => selectedChoiceId !== null).length;
  const score = response.questions.filter(({ isCorrect }) => isCorrect === true).length;
  if (response.answeredCount !== answeredCount || response.unansweredCount !== EXAM_QUESTION_COUNT - answeredCount) {
    context.addIssue({ code: 'custom', path: ['answeredCount'], message: 'Exam counts must match the reviewed rows' });
  }
  if (response.score !== score) {
    context.addIssue({ code: 'custom', path: ['score'], message: 'Exam score must match the reviewed rows' });
  }
  if (response.passed !== (response.score >= response.passingScore)) {
    context.addIssue({ code: 'custom', path: ['passed'], message: 'Exam pass result is inconsistent' });
  }
});
