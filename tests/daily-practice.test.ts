import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../packages/database/src/index.ts';
import {
  DAILY_PRACTICE_MAX_ATTEMPTS,
  buildDailyPracticeResponse,
  dailyPracticeDate,
  dailyPracticeQuerySchema,
  dailyPracticeRequestSchema,
  dailyPracticeResponseSchema,
  dailyPracticeRetryDelayMs,
  isDailyPresentationUniqueConflict,
  isRetryableDailyPracticeConflict,
  retryDailyPractice,
  thailandCalendarDay,
} from '../packages/database/src/daily-practice.ts';

function snapshot() {
  const questionId = randomUUID();
  const choices = (['A', 'B', 'C', 'D'] as const).map((key) => ({
    id: randomUUID(),
    key,
    textThai: null,
    textEnglish: `Choice ${key}`,
    textRussian: null,
  }));
  return {
    version: 1 as const,
    question: {
      id: questionId,
      textThai: null,
      textExamEnglish: 'Exam wording',
      textEnglish: 'Daily wording',
      textRussian: null,
      choices,
    },
    correctChoiceId: choices[0]!.id,
    explanationThai: null,
    explanationEnglish: 'PRIVATE EXPLANATION',
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: 'PRIVATE TRAP',
    trapExplanationRussian: null,
  };
}

describe('daily practice contracts', () => {
  it('accepts only no body or the exact empty JSON object and an exact empty query', () => {
    expect(dailyPracticeRequestSchema.parse(undefined)).toBeUndefined();
    expect(dailyPracticeRequestSchema.parse({})).toEqual({});
    expect(dailyPracticeQuerySchema.parse({})).toEqual({});
    for (const value of [null, [], '', 0, { unknown: true }]) {
      expect(dailyPracticeRequestSchema.safeParse(value).success).toBe(false);
    }
    for (const value of [undefined, null, [], { unknown: '1' }]) {
      expect(dailyPracticeQuerySchema.safeParse(value).success).toBe(false);
    }
  });

  it('derives the canonical Thailand date at the exact UTC+07:00 midnight boundary', () => {
    expect(thailandCalendarDay(new Date('2026-10-02T16:59:59.999Z'))).toBe('2026-10-02');
    expect(thailandCalendarDay(new Date('2026-10-02T17:00:00.000Z'))).toBe('2026-10-03');
    expect(thailandCalendarDay(new Date('2028-02-29T16:59:59.999Z'))).toBe('2028-02-29');
    expect(thailandCalendarDay(new Date('2028-02-29T17:00:00.000Z'))).toBe('2028-03-01');
    expect(dailyPracticeDate('2026-10-03').toISOString()).toBe('2026-10-03T00:00:00.000Z');
    for (const value of [undefined, '2026-10-03T00:00:00.000Z', new Date(Number.NaN), new Date(8.64e15)]) {
      expect(() => thailandCalendarDay(value)).toThrow();
    }
    for (const day of ['2026-1-01', '2026-02-29', '2026-13-01', '2026-10-03T00:00:00.000Z']) {
      expect(() => dailyPracticeDate(day)).toThrow();
    }
  });

  it('projects only safe immutable question data and validates every stored identity', () => {
    const storedSnapshot = snapshot();
    const userId = randomUUID();
    const presentationId = randomUUID();
    const input = {
      id: presentationId,
      userId,
      questionId: storedSnapshot.question.id,
      dailyDate: new Date('2026-10-03T00:00:00.000Z'),
      snapshot: storedSnapshot,
      answer: null,
      question: { id: storedSnapshot.question.id },
    };
    const pending = buildDailyPracticeResponse(input, userId, '2026-10-03');
    expect(pending).toEqual({
      day: '2026-10-03',
      presentationId,
      answered: false,
      question: storedSnapshot.question,
    });
    expect(Object.keys(pending).sort()).toEqual(['answered', 'day', 'presentationId', 'question']);
    expect(dailyPracticeResponseSchema.parse({
      ...pending,
      answered: true,
    }).answered).toBe(true);
    const serialized = JSON.stringify(pending);
    for (const prohibited of [
      'correctChoiceId', 'isCorrect', 'selectedChoiceId', 'PRIVATE EXPLANATION', 'PRIVATE TRAP',
      'sourceReference', 'conceptId', 'categoryId', 'userId', 'active', 'verificationStatus',
    ]) expect(serialized).not.toContain(prohibited);

    for (const invalid of [
      { ...input, userId: randomUUID() },
      { ...input, questionId: randomUUID() },
      { ...input, question: { id: randomUUID() } },
      { ...input, dailyDate: new Date('2026-10-04T00:00:00.000Z') },
      { ...input, dailyDate: new Date('2026-10-03T01:00:00.000Z') },
      { ...input, snapshot: { version: 999 } },
      { ...input, snapshot: {
        ...storedSnapshot,
        question: {
          ...storedSnapshot.question,
          choices: storedSnapshot.question.choices.map((choice, index) => (
            index === 0 ? { ...choice, id: choice.id.toUpperCase() } : choice
          )),
        },
        correctChoiceId: storedSnapshot.correctChoiceId.toUpperCase(),
      } },
      { ...input, privateField: 'must reject' },
    ]) expect(() => buildDailyPracticeResponse(invalid, userId, '2026-10-03')).toThrow();
    expect(() => buildDailyPracticeResponse(input, randomUUID(), '2026-10-03')).toThrow();
  });
});

describe('daily practice conflict and retry boundaries', () => {
  const error = (code: string, meta: Record<string, unknown> = {}) => (
    new Prisma.PrismaClientKnownRequestError('synthetic', { code, clientVersion: 'test', meta })
  );
  const cause = {
    originalCode: '23505',
    kind: 'UniqueConstraintViolation',
    table: 'QuestionPresentation',
    constraint: { index: 'QuestionPresentation_userId_dailyDate_key' },
  };
  const metadata = { modelName: 'QuestionPresentation', driverAdapterError: { cause } };

  it('classifies only the named learner/day unique conflict plus Prisma serialization conflicts', () => {
    expect(isDailyPresentationUniqueConflict(error('P2002', metadata))).toBe(true);
    expect(isRetryableDailyPracticeConflict(error('P2002', metadata))).toBe(true);
    expect(isRetryableDailyPracticeConflict(error('P2034'))).toBe(true);
    for (const patch of [
      { table: 'Other' },
      { constraint: { index: 'QuestionPresentation_pkey' } },
      { originalCode: '23503' },
    ]) {
      expect(isDailyPresentationUniqueConflict(error('P2002', {
        ...metadata,
        driverAdapterError: { cause: { ...cause, ...patch } },
      }))).toBe(false);
    }
    for (const value of [
      new Error('failure'),
      error('P2003', metadata),
      error('P2002', { modelName: 'QuestionPresentation', target: ['userId', 'dailyDate'] }),
      error('P2002', { modelName: 'Other', driverAdapterError: { cause } }),
      error('P2002'),
    ]) {
      expect(isDailyPresentationUniqueConflict(value)).toBe(false);
      expect(isRetryableDailyPracticeConflict(value)).toBe(false);
    }
  });

  it('bounds retries with finite capped delays and never retries unrelated errors', async () => {
    const retryable = error('P2034');
    const delays: number[] = [];
    let attempts = 0;
    expect(await retryDailyPractice(
      async () => {
        attempts++;
        if (attempts < 4) throw retryable;
        return 'saved';
      },
      isRetryableDailyPracticeConflict,
      async (delay) => { delays.push(delay); },
    )).toBe('saved');
    expect(delays).toEqual([10, 20, 40]);

    const unrelated = new Error('unrelated');
    await expect(retryDailyPractice(
      async () => { throw unrelated; },
      isRetryableDailyPracticeConflict,
      async () => { throw new Error('must not wait'); },
    )).rejects.toBe(unrelated);

    attempts = 0;
    await expect(retryDailyPractice(
      async () => { attempts++; throw retryable; },
      isRetryableDailyPracticeConflict,
      async () => undefined,
    )).rejects.toBe(retryable);
    expect(attempts).toBe(DAILY_PRACTICE_MAX_ATTEMPTS);
    expect(Array.from({ length: DAILY_PRACTICE_MAX_ATTEMPTS - 1 }, (_, index) => dailyPracticeRetryDelayMs(index + 1)))
      .toEqual([10, 20, 40, 80, 160, 250, 250]);
  });
});
