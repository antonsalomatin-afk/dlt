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

export const examReviewParamsSchema = z.strictObject({
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

const examReviewQuestionSchema = presentedQuestionSchema.superRefine((question, context) => {
  if (question.id !== question.id.toLowerCase()) {
    context.addIssue({ code: 'custom', path: ['id'], message: 'Question ID must be canonical' });
  }
  if (question.choices.some(({ id }) => id !== id.toLowerCase())) {
    context.addIssue({ code: 'custom', path: ['choices'], message: 'Choice IDs must be canonical' });
  }
});

const examReviewMistakeSchema = z.strictObject({
  examQuestionId: canonicalUuidSchema,
  position: z.number().int().min(1).max(EXAM_QUESTION_COUNT),
  selectedChoiceId: canonicalUuidSchema.nullable(),
  answeredAt: canonicalTimestampSchema.nullable(),
  correctChoiceId: canonicalUuidSchema,
  question: examReviewQuestionSchema,
  explanationThai: z.string().nullable(),
  explanationEnglish: z.string().nullable(),
  explanationRussian: z.string().nullable(),
  trapExplanationThai: z.string().nullable(),
  trapExplanationEnglish: z.string().nullable(),
  trapExplanationRussian: z.string().nullable(),
}).superRefine((mistake, context) => {
  if ((mistake.selectedChoiceId === null) !== (mistake.answeredAt === null)) {
    context.addIssue({ code: 'custom', path: ['answeredAt'], message: 'Unanswered fields must both be null' });
  }
  if (!mistake.question.choices.some(({ id }) => id === mistake.correctChoiceId)) {
    context.addIssue({ code: 'custom', path: ['correctChoiceId'], message: 'Correct choice is absent' });
  }
  if (
    mistake.selectedChoiceId !== null
    && (
      mistake.selectedChoiceId === mistake.correctChoiceId
      || !mistake.question.choices.some(({ id }) => id === mistake.selectedChoiceId)
    )
  ) {
    context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Selected choice is not an incorrect presented choice' });
  }
});

export const examReviewResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  questionCount: z.literal(EXAM_QUESTION_COUNT),
  score: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  passingScore: z.literal(EXAM_PASSING_SCORE),
  passed: z.boolean(),
  completedAt: canonicalTimestampSchema,
  mistakes: z.array(examReviewMistakeSchema).max(EXAM_QUESTION_COUNT),
}).superRefine((response, context) => {
  if (response.passed !== (response.score >= response.passingScore)) {
    context.addIssue({ code: 'custom', path: ['passed'], message: 'Exam pass result is inconsistent' });
  }
  if (response.mistakes.length !== response.questionCount - response.score) {
    context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Exam mistake count is inconsistent' });
  }
  if (response.mistakes.some((mistake, index, mistakes) => index > 0 && mistake.position <= mistakes[index - 1]!.position)) {
    context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Exam mistakes must have increasing positions' });
  }
  if (new Set(response.mistakes.map(({ examQuestionId }) => examQuestionId)).size !== response.mistakes.length) {
    context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Exam question IDs must be unique' });
  }
  if (new Set(response.mistakes.map(({ question }) => question.id)).size !== response.mistakes.length) {
    context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Source question IDs must be unique' });
  }
});

const examCurrentQuestionSchema = presentedQuestionSchema.superRefine((question, context) => {
  if (question.id !== question.id.toLowerCase()) {
    context.addIssue({ code: 'custom', path: ['id'], message: 'Question ID must be canonical' });
  }
  if (question.choices.some(({ id }) => id !== id.toLowerCase())) {
    context.addIssue({ code: 'custom', path: ['choices'], message: 'Choice IDs must be canonical' });
  }
});

const currentExamQuestionSchema = z.strictObject({
  examQuestionId: canonicalUuidSchema,
  position: z.number().int().min(1).max(EXAM_QUESTION_COUNT),
  selectedChoiceId: canonicalUuidSchema.nullable(),
  answeredAt: canonicalTimestampSchema.nullable(),
  question: examCurrentQuestionSchema,
}).superRefine((item, context) => {
  if ((item.selectedChoiceId === null) !== (item.answeredAt === null)) {
    context.addIssue({ code: 'custom', path: ['answeredAt'], message: 'Exam answer fields must both be null or present' });
  }
  if (
    item.selectedChoiceId !== null
    && !item.question.choices.some(({ id }) => id === item.selectedChoiceId)
  ) {
    context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Selected choice is absent from the question' });
  }
});

export const currentExamResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  vehicleType: z.enum(['CAR', 'MOTORCYCLE']),
  questionCount: z.literal(EXAM_QUESTION_COUNT),
  passingScore: z.literal(EXAM_PASSING_SCORE),
  startedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
  serverTime: canonicalTimestampSchema,
  expired: z.boolean(),
  answeredCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  remainingCount: z.number().int().min(0).max(EXAM_QUESTION_COUNT),
  questions: z.array(currentExamQuestionSchema).length(EXAM_QUESTION_COUNT),
}).superRefine((response, context) => {
  const startedAt = new Date(response.startedAt).getTime();
  const expiresAt = new Date(response.expiresAt).getTime();
  const serverTime = new Date(response.serverTime).getTime();
  if (expiresAt - startedAt !== EXAM_DURATION_MS) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration is invalid' });
  }
  if (response.expired !== (serverTime >= expiresAt)) {
    context.addIssue({ code: 'custom', path: ['expired'], message: 'Exam expiry state is inconsistent' });
  }
  if (response.answeredCount + response.remainingCount !== response.questionCount) {
    context.addIssue({ code: 'custom', path: ['remainingCount'], message: 'Exam progress counts must total 50' });
  }
  const selectedCount = response.questions.filter(({ selectedChoiceId }) => selectedChoiceId !== null).length;
  if (response.answeredCount !== selectedCount) {
    context.addIssue({ code: 'custom', path: ['answeredCount'], message: 'Exam answered count is inconsistent' });
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
  response.questions.forEach((question, index) => {
    if (question.answeredAt === null) return;
    const answeredAt = new Date(question.answeredAt).getTime();
    if (answeredAt < startedAt || answeredAt >= expiresAt) {
      context.addIssue({ code: 'custom', path: ['questions', index, 'answeredAt'], message: 'Exam answer time is invalid' });
    }
  });
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
