import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EXAM_DURATION_MS,
  EXAM_PASSING_SCORE,
  EXAM_QUESTION_COUNT,
  examStartRequestSchema,
  examStartResponseSchema,
  sampleExamQuestionIds,
} from '../packages/database/src/exam.ts';

function presentedQuestion() {
  return {
    id: randomUUID(),
    textThai: null,
    textExamEnglish: 'Exam wording',
    textEnglish: 'Question wording',
    textRussian: null,
    choices: (['A', 'B', 'C', 'D'] as const).map((key) => ({
      id: randomUUID(),
      key,
      textThai: null,
      textEnglish: `Choice ${key}`,
      textRussian: null,
    })),
  };
}

function validResponse() {
  const startedAt = new Date('2026-09-17T12:00:00.000Z');
  return {
    examId: randomUUID(),
    vehicleType: 'CAR' as const,
    questionCount: EXAM_QUESTION_COUNT,
    passingScore: EXAM_PASSING_SCORE,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + EXAM_DURATION_MS).toISOString(),
    questions: Array.from({ length: EXAM_QUESTION_COUNT }, (_, index) => ({
      examQuestionId: randomUUID(),
      position: index + 1,
      question: presentedQuestion(),
    })),
  };
}

describe('exam start contracts', () => {
  it('accepts only an exact empty request object', () => {
    expect(examStartRequestSchema.parse({})).toEqual({});
    for (const value of [undefined, null, [], '', { extra: true }]) {
      expect(examStartRequestSchema.safeParse(value).success).toBe(false);
    }
  });

  it('validates the exact policy, canonical timestamps, safe fields, uniqueness, and positions', () => {
    const response = validResponse();
    expect(examStartResponseSchema.parse(response)).toEqual(response);
    const duplicateExamQuestionId = response.questions[0]?.examQuestionId;
    const duplicateSourceQuestionId = response.questions[0]?.question.id;
    if (!duplicateExamQuestionId || !duplicateSourceQuestionId) throw new Error('Missing generated question');
    const invalid = [
      { ...response, questionCount: 49 },
      { ...response, passingScore: 44 },
      { ...response, startedAt: '2026-09-17T12:00:00Z' },
      { ...response, expiresAt: new Date(new Date(response.expiresAt).getTime() + 1).toISOString() },
      { ...response, questions: response.questions.map((question, index) => index === 1 ? { ...question, position: 1 } : question) },
      { ...response, questions: response.questions.map((question, index) => index === 1 ? { ...question, examQuestionId: duplicateExamQuestionId } : question) },
      { ...response, questions: response.questions.map((question, index) => index === 1 ? { ...question, question: { ...question.question, id: duplicateSourceQuestionId } } : question) },
      { ...response, ownerId: randomUUID() },
      { ...response, questions: response.questions.map((question, index) => index === 1 ? { ...question, isCorrect: false } : question) },
      { ...response, questions: response.questions.map((question, index) => index === 1 ? { ...question, question: { ...question.question, correctChoiceId: randomUUID() } } : question) },
    ];
    for (const value of invalid) expect(examStartResponseSchema.safeParse(value).success).toBe(false);
  });
});

describe('exam sampling', () => {
  const ids: string[] = Array.from({ length: 53 }, () => randomUUID());

  it('performs a bounded partial Fisher-Yates sample without replacement', () => {
    const bounds: number[] = [];
    const selected = sampleExamQuestionIds(ids, (remainingCount) => {
      bounds.push(remainingCount);
      return remainingCount - 1;
    });
    expect(bounds).toEqual(Array.from({ length: EXAM_QUESTION_COUNT }, (_, index) => ids.length - index));
    expect(selected).toHaveLength(EXAM_QUESTION_COUNT);
    expect(new Set(selected).size).toBe(EXAM_QUESTION_COUNT);
    expect(selected.every((id) => ids.includes(id))).toBe(true);
    expect(ids).toHaveLength(53);
  });

  it('rejects invalid pools and every invalid injected random result at runtime', () => {
    expect(() => sampleExamQuestionIds(ids.slice(0, 49), () => 0)).toThrow();
    expect(() => sampleExamQuestionIds([...ids, ids[0] as string], () => 0)).toThrow();
    expect(() => sampleExamQuestionIds(Array.from({ length: 10_001 }, () => randomUUID()), () => 0)).toThrow();
    for (const invalid of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, ids.length]) {
      expect(() => sampleExamQuestionIds(ids, () => invalid)).toThrow();
    }
  });
});
