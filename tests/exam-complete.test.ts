import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EXAM_PASSING_SCORE,
  EXAM_QUESTION_COUNT,
  examCompleteRequestSchema,
  examCompleteResponseSchema,
  summarizeExamOutcomes,
} from '../packages/database/src/exam.ts';

const examId = randomUUID();
const completedAt = '2026-09-18T17:00:00.123Z';

function response(overrides: Record<string, unknown> = {}) {
  return {
    examId,
    questionCount: EXAM_QUESTION_COUNT,
    answeredCount: 50,
    unansweredCount: 0,
    score: 45,
    passingScore: EXAM_PASSING_SCORE,
    passed: true,
    completedAt,
    ...overrides,
  };
}

describe('exam completion contracts', () => {
  it('accepts only one canonical lowercase exam UUID', () => {
    expect(examCompleteRequestSchema.parse({ examId })).toEqual({ examId });
    for (const value of [
      null,
      [],
      {},
      { examId: examId.toUpperCase() },
      { examId: 'not-a-uuid' },
      { examId, extra: true },
    ]) expect(() => examCompleteRequestSchema.parse(value)).toThrow();
  });

  it('computes counts, score and the 44/45 pass boundary', () => {
    expect(summarizeExamOutcomes([
      ...Array.from({ length: 44 }, () => true),
      ...Array.from({ length: 6 }, () => false),
    ])).toEqual({ answeredCount: 50, unansweredCount: 0, score: 44, passed: false });
    expect(summarizeExamOutcomes([
      ...Array.from({ length: 45 }, () => true),
      ...Array.from({ length: 3 }, () => false),
      null,
      null,
    ])).toEqual({ answeredCount: 48, unansweredCount: 2, score: 45, passed: true });
    expect(() => summarizeExamOutcomes(Array.from({ length: 49 }, () => null))).toThrow();
  });

  it('validates exact counts, score, pass result and canonical fields', () => {
    expect(examCompleteResponseSchema.parse(response())).toEqual(response());
    for (const invalid of [
      response({ examId: examId.toUpperCase() }),
      response({ questionCount: 49 }),
      response({ passingScore: 44 }),
      response({ answeredCount: 49 }),
      response({ unansweredCount: 1 }),
      response({ answeredCount: 44, unansweredCount: 6, score: 45 }),
      response({ score: 44, passed: true }),
      response({ completedAt: '2026-09-18T17:00:00Z' }),
      response({ selectedChoiceId: randomUUID() }),
      response({ correctChoiceId: randomUUID() }),
      response({ questions: [] }),
      response({ userId: randomUUID() }),
    ]) expect(() => examCompleteResponseSchema.parse(invalid)).toThrow();
  });
});
