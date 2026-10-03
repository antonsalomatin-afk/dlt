import { z } from 'zod';
import { Prisma } from './index.ts';
import { parsePresentationSnapshot, presentedQuestionSchema } from './presentation.ts';

export const DAILY_PRACTICE_MAX_ATTEMPTS = 8;
const DAILY_PRACTICE_RETRY_BASE_DELAY_MS = 10;
const DAILY_PRACTICE_RETRY_MAX_DELAY_MS = 250;
const ICT_OFFSET_MS = 7 * 60 * 60 * 1_000;

const canonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase());
export const dailyPracticeDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString() === `${value}T00:00:00.000Z`;
});
const validInstantSchema = z.date().refine((value) => !Number.isNaN(value.getTime()));

export const dailyPracticeRequestSchema = z.strictObject({}).optional();
export const dailyPracticeQuerySchema = z.strictObject({});
export const dailyPracticeResponseSchema = z.strictObject({
  day: dailyPracticeDaySchema,
  presentationId: canonicalUuidSchema,
  answered: z.boolean(),
  question: presentedQuestionSchema,
});

const storedDailyPresentationSchema = z.strictObject({
  id: canonicalUuidSchema,
  userId: canonicalUuidSchema,
  questionId: canonicalUuidSchema,
  dailyDate: validInstantSchema,
  snapshot: z.unknown(),
  answer: z.strictObject({ id: canonicalUuidSchema }).nullable(),
  question: z.strictObject({ id: canonicalUuidSchema }),
});

export function thailandCalendarDay(requestInstantInput: unknown): string {
  const requestInstant = validInstantSchema.parse(requestInstantInput);
  const shifted = new Date(requestInstant.getTime() + ICT_OFFSET_MS);
  if (Number.isNaN(shifted.getTime())) throw new Error('Thailand calendar date is outside the supported range');
  return dailyPracticeDaySchema.parse(shifted.toISOString().slice(0, 10));
}

export function dailyPracticeDate(dayInput: unknown): Date {
  const day = dailyPracticeDaySchema.parse(dayInput);
  return new Date(`${day}T00:00:00.000Z`);
}

export function buildDailyPracticeResponse(
  input: unknown,
  expectedUserIdInput: unknown,
  expectedDayInput: unknown,
) {
  const presentation = storedDailyPresentationSchema.parse(input);
  const expectedUserId = canonicalUuidSchema.parse(expectedUserIdInput);
  const expectedDay = dailyPracticeDaySchema.parse(expectedDayInput);
  if (
    presentation.userId !== expectedUserId
    || presentation.question.id !== presentation.questionId
    || presentation.dailyDate.toISOString() !== `${expectedDay}T00:00:00.000Z`
  ) throw new Error('Stored daily presentation relationship is inconsistent');
  const snapshot = parsePresentationSnapshot(presentation.snapshot);
  for (const id of [
    snapshot.question.id,
    snapshot.correctChoiceId,
    ...snapshot.question.choices.map(({ id }) => id),
  ]) canonicalUuidSchema.parse(id);
  if (snapshot.question.id !== presentation.questionId) {
    throw new Error('Stored daily presentation snapshot is inconsistent');
  }
  return dailyPracticeResponseSchema.parse({
    day: expectedDay,
    presentationId: presentation.id,
    answered: presentation.answer !== null,
    question: snapshot.question,
  });
}

const dailyPresentationUniqueMetadataSchema = z.object({
  modelName: z.literal('QuestionPresentation'),
  driverAdapterError: z.object({ cause: z.object({
    originalCode: z.literal('23505'),
    kind: z.literal('UniqueConstraintViolation'),
    table: z.literal('QuestionPresentation'),
    constraint: z.object({ index: z.literal('QuestionPresentation_userId_dailyDate_key') }),
  }) }),
});

export function isDailyPresentationUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2002'
    && dailyPresentationUniqueMetadataSchema.safeParse(error.meta).success;
}

export function isRetryableDailyPracticeConflict(error: unknown): boolean {
  return isDailyPresentationUniqueConflict(error)
    || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034');
}

export function dailyPracticeRetryDelayMs(failedAttempt: number): number {
  if (
    !Number.isSafeInteger(failedAttempt)
    || failedAttempt < 1
    || failedAttempt >= DAILY_PRACTICE_MAX_ATTEMPTS
  ) throw new Error('Failed daily practice attempt is outside the retry range');
  return Math.min(
    DAILY_PRACTICE_RETRY_BASE_DELAY_MS * (2 ** (failedAttempt - 1)),
    DAILY_PRACTICE_RETRY_MAX_DELAY_MS,
  );
}

const waitForDailyPracticeRetry = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs);
});

export async function retryDailyPractice<T>(
  operation: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  wait: (delayMs: number) => Promise<void> = waitForDailyPracticeRetry,
): Promise<T> {
  for (let attempt = 1; attempt <= DAILY_PRACTICE_MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt === DAILY_PRACTICE_MAX_ATTEMPTS) throw error;
      await wait(dailyPracticeRetryDelayMs(attempt));
    }
  }
  throw new Error('Daily practice retry did not resolve');
}
