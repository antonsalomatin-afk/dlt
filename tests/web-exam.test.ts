import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { examAnswerSchema, examCompleteSchema, examStartSchema } from '../apps/web/lib/contracts.ts';

const startedAt = '2026-09-21T09:00:00.000Z';
const expiresAt = '2026-09-21T10:00:00.000Z';
const questions = Array.from({ length: 50 }, (_, index) => ({
  examQuestionId: randomUUID(), position: index + 1,
  question: {
    id: randomUUID(), textThai: null, textExamEnglish: null, textEnglish: `Question ${index + 1}`, textRussian: null,
    choices: (['A', 'B', 'C', 'D'] as const).map((key) => ({ id: randomUUID(), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null })),
  },
}));
const start = { examId: randomUUID(), vehicleType: 'CAR', questionCount: 50, passingScore: 45, startedAt, expiresAt, questions };

describe('Mini App exam contracts', () => {
  it('accepts only a strict consistent exam start', () => {
    expect(examStartSchema.parse(start)).toEqual(start);
    for (const invalid of [
      { ...start, extra: true },
      { ...start, questionCount: 49 },
      { ...start, passingScore: 44 },
      { ...start, expiresAt: '2026-09-21T10:00:01.000Z' },
      { ...start, questions: questions.slice(0, 49) },
      { ...start, questions: questions.map((item) => ({ ...item, position: 1 })) },
      { ...start, questions: questions.map((item, index) => (index === 1 ? { ...item, examQuestionId: questions[0]!.examQuestionId } : item)) },
      { ...start, questions: questions.map((item, index) => (index === 1 ? { ...item, question: questions[0]!.question } : item)) },
      { ...start, questions: questions.map((item) => ({ ...item, correctChoiceId: randomUUID() })) },
    ]) expect(examStartSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts only a strict exam answer receipt without correctness', () => {
    const answer = { examId: start.examId, examQuestionId: questions[0]!.examQuestionId, selectedChoiceId: randomUUID(), answeredAt: startedAt, answeredCount: 1, remainingCount: 49 };
    expect(examAnswerSchema.parse(answer)).toEqual(answer);
    for (const invalid of [
      { ...answer, isCorrect: true },
      { ...answer, correctChoiceId: randomUUID() },
      { ...answer, answeredCount: 0, remainingCount: 50 },
      { ...answer, remainingCount: 48 },
      { ...answer, answeredAt: '2026-09-21T09:00:00Z' },
    ]) expect(examAnswerSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts only a strict consistent exam completion summary', () => {
    const summary = { examId: start.examId, questionCount: 50, answeredCount: 48, unansweredCount: 2, score: 45, passingScore: 45, passed: true, completedAt: expiresAt };
    expect(examCompleteSchema.parse(summary)).toEqual(summary);
    for (const invalid of [
      { ...summary, unansweredCount: 3 },
      { ...summary, score: 49 },
      { ...summary, score: 44 },
      { ...summary, passed: false },
      { ...summary, questions: [] },
      { ...summary, passingScore: 44 },
    ]) expect(examCompleteSchema.safeParse(invalid).success).toBe(false);
  });
});
