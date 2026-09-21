import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EXAM_PASSING_SCORE,
  EXAM_QUESTION_COUNT,
  examReviewParamsSchema,
  examReviewResponseSchema,
} from '../packages/database/src/exam.ts';

const completedAt = '2026-09-18T18:00:00.123Z';

function mistake(position: number, unanswered = false) {
  const choiceIds = Array.from({ length: 4 }, () => randomUUID());
  return {
    examQuestionId: randomUUID(),
    position,
    selectedChoiceId: unanswered ? null : choiceIds[1],
    answeredAt: unanswered ? null : '2026-09-18T17:30:00.123Z',
    correctChoiceId: choiceIds[0],
    question: {
      id: randomUUID(),
      textThai: null,
      textExamEnglish: `Exam wording ${position}`,
      textEnglish: `Question ${position}`,
      textRussian: null,
      choices: (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
        id: choiceIds[index], key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
      })),
    },
    explanationThai: null,
    explanationEnglish: `Explanation ${position}`,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: `Trap ${position}`,
    trapExplanationRussian: null,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    examId: randomUUID(),
    questionCount: EXAM_QUESTION_COUNT,
    score: 48,
    passingScore: EXAM_PASSING_SCORE,
    passed: true,
    completedAt,
    mistakes: [mistake(2), mistake(50, true)],
    ...overrides,
  };
}

describe('exam review contracts', () => {
  it('accepts only a canonical lowercase exam path UUID', () => {
    const examId = randomUUID();
    expect(examReviewParamsSchema.parse({ examId })).toEqual({ examId });
    for (const value of [
      null, [], {}, { examId: 'not-a-uuid' }, { examId: examId.toUpperCase() }, { examId, extra: true },
    ]) expect(() => examReviewParamsSchema.parse(value)).toThrow();
  });

  it('accepts exact ordered incorrect and unanswered mistake shapes', () => {
    const value = response();
    expect(examReviewResponseSchema.parse(value)).toEqual(value);
    expect(Object.keys(value).sort()).toEqual([
      'completedAt', 'examId', 'mistakes', 'passed', 'passingScore', 'questionCount', 'score',
    ]);
    expect(Object.keys(value.mistakes[0]!).sort()).toEqual([
      'answeredAt', 'correctChoiceId', 'examQuestionId', 'explanationEnglish', 'explanationRussian',
      'explanationThai', 'position', 'question', 'selectedChoiceId', 'trapExplanationEnglish',
      'trapExplanationRussian', 'trapExplanationThai',
    ]);
  });

  it('accepts the zero and all-mistake bounds', () => {
    expect(examReviewResponseSchema.parse(response({ score: 50, passed: true, mistakes: [] })).mistakes).toEqual([]);
    const mistakes = Array.from({ length: 50 }, (_, index) => mistake(index + 1, index % 2 === 0));
    expect(examReviewResponseSchema.parse(response({ score: 0, passed: false, mistakes })).mistakes).toHaveLength(50);
  });

  it('rejects malformed pairs, ordering, identities, timestamps, counts and unsafe fields', () => {
    const first = mistake(2);
    const second = mistake(3, true);
    const invalid = [
      response({ mistakes: [{ ...first, answeredAt: null }, second] }),
      response({ mistakes: [{ ...first, selectedChoiceId: null }, second] }),
      response({ mistakes: [{ ...first, selectedChoiceId: first.correctChoiceId }, second] }),
      response({ mistakes: [{ ...first, selectedChoiceId: randomUUID() }, second] }),
      response({ mistakes: [{ ...first, answeredAt: '2026-09-18T17:30:00Z' }, second] }),
      response({ mistakes: [second, first] }),
      response({ mistakes: [first, { ...second, examQuestionId: first.examQuestionId }] }),
      response({ mistakes: [first, { ...second, question: { ...second.question, id: first.question.id } }] }),
      response({ score: 49 }),
      response({ score: 44, passed: true, mistakes: Array.from({ length: 6 }, (_, index) => mistake(index + 1)) }),
      response({ completedAt: '2026-09-18T18:00:00Z' }),
      response({ examId: randomUUID().toUpperCase() }),
      response({ userId: randomUUID() }),
      response({ mistakes: [{ ...first, sourceReference: 'private' }, second] }),
      response({ mistakes: [{ ...first, question: { ...first.question, correctChoiceId: first.correctChoiceId } }, second] }),
    ];
    for (const value of invalid) expect(() => examReviewResponseSchema.parse(value)).toThrow();
  });
});
