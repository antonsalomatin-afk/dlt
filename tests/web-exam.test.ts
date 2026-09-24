import { describe, expect, it } from 'vitest';
import {
  currentExamResponseSchema,
  examAnswerResponseSchema,
  examCompletionResponseSchema,
  examStartResponseSchema,
} from '../apps/web/lib/contracts.ts';

const uuid = (value: number) => `550e8400-e29b-41d4-a716-${value.toString().padStart(12, '0')}`;
const startedAt = '2098-01-01T00:00:00.000Z';
const expiresAt = '2098-01-01T01:00:00.000Z';
const questions = Array.from({ length: 50 }, (_, index) => ({
  examQuestionId: uuid(index + 1), position: index + 1,
  question: {
    id: uuid(100 + index), textThai: index === 0 ? 'คำถาม' : null, textExamEnglish: null,
    textEnglish: `Question ${index + 1}`, textRussian: index === 0 ? 'Вопрос' : null,
    choices: ['A', 'B', 'C', 'D'].map((key, choice) => ({
      id: uuid(1_000 + index * 4 + choice), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
    })),
  },
}));

const started = { examId: uuid(999), vehicleType: 'CAR', questionCount: 50, passingScore: 45, startedAt, expiresAt, questions };
const current = {
  ...started, serverTime: '2098-01-01T00:10:00.000Z', expired: false, answeredCount: 1, remainingCount: 49,
  questions: questions.map((question, index) => ({ ...question, selectedChoiceId: index === 0 ? question.question.choices[0]?.id : null, answeredAt: index === 0 ? '2098-01-01T00:05:00.000Z' : null })),
};

describe('Mini App mock-exam browser contracts', () => {
  it('accepts exact start/current/answer/completion payloads', () => {
    expect(examStartResponseSchema.parse(started)).toEqual(started);
    expect(currentExamResponseSchema.parse(current)).toEqual(current);
    const answer = { examId: uuid(999), examQuestionId: uuid(2), selectedChoiceId: uuid(1004), answeredAt: '2098-01-01T00:06:00.000Z', answeredCount: 2, remainingCount: 48 };
    expect(examAnswerResponseSchema.parse(answer)).toEqual(answer);
    const completion = { examId: uuid(999), questionCount: 50, answeredCount: 49, unansweredCount: 1, score: 45, passingScore: 45, passed: true, completedAt: '2098-01-01T01:00:00.000Z' };
    expect(examCompletionResponseSchema.parse(completion)).toEqual(completion);
  });

  it('rejects hidden fields, unsafe question fields and start invariants', () => {
    for (const invalid of [
      { ...started, correctChoiceId: uuid(1) },
      { ...started, questions: started.questions.map((question, index) => index === 0 ? { ...question, isCorrect: true } : question) },
      { ...started, questions: started.questions.map((question, index) => index === 0 ? { ...question, question: { ...question.question, explanationEnglish: 'hidden' } } : question) },
      { ...started, passingScore: 44 },
      { ...started, expiresAt: '2098-01-01T00:59:59.000Z' },
      { ...started, questions: started.questions.slice(1) },
      { ...started, questions: started.questions.map((question, index) => index === 1 ? { ...question, examQuestionId: uuid(1) } : question) },
      { ...started, questions: started.questions.map((question, index) => index === 1 ? { ...question, position: 3 } : question) },
    ]) expect(examStartResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects current-exam privacy and progress inconsistencies', () => {
    for (const invalid of [
      { ...current, score: 1 },
      { ...current, answeredCount: 2, remainingCount: 48 },
      { ...current, expired: true },
      { ...current, serverTime: '2097-12-31T23:59:59.999Z' },
      { ...current, serverTime: expiresAt, expired: false },
      { ...current, questions: current.questions.map((question, index) => index === 0 ? { ...question, answeredAt: null } : question) },
      { ...current, questions: current.questions.map((question, index) => index === 0 ? { ...question, selectedChoiceId: uuid(9999) } : question) },
      { ...current, questions: current.questions.map((question, index) => index === 0 ? { ...question, answeredAt: expiresAt } : question) },
    ]) expect(currentExamResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects answer and completion disclosure or arithmetic mismatches', () => {
    const answer = { examId: uuid(999), examQuestionId: uuid(2), selectedChoiceId: uuid(1004), answeredAt: '2098-01-01T00:06:00.000Z', answeredCount: 2, remainingCount: 48 };
    for (const invalid of [{ ...answer, isCorrect: true }, { ...answer, remainingCount: 47 }, { ...answer, answeredCount: 0 }]) {
      expect(examAnswerResponseSchema.safeParse(invalid).success).toBe(false);
    }
    const completion = { examId: uuid(999), questionCount: 50, answeredCount: 49, unansweredCount: 1, score: 45, passingScore: 45, passed: true, completedAt: expiresAt };
    for (const invalid of [{ ...completion, mistakes: [] }, { ...completion, unansweredCount: 2 }, { ...completion, score: 50 }, { ...completion, passed: false }]) {
      expect(examCompletionResponseSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
