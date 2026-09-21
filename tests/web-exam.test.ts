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

import { examHistoryResponseSchema, examResultSchema } from '../apps/web/lib/contracts.ts';

const encodeCursor = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

describe('Mini App exam history and review contracts', () => {
  it('accepts only a strict consistent exam history page', () => {
    const completed = { examId: randomUUID(), vehicleType: 'CAR', status: 'COMPLETED', questionCount: 50, passingScore: 45, answeredCount: 48, startedAt, expiresAt, completedAt: expiresAt, score: 45, passed: true };
    const open = { ...completed, examId: randomUUID(), status: 'IN_PROGRESS', answeredCount: 3, completedAt: null, score: null, passed: null };
    const cursor = encodeCursor({ v: 1, startedAt, examId: completed.examId });
    expect(examHistoryResponseSchema.parse({ items: [completed, open], nextCursor: cursor })).toEqual({ items: [completed, open], nextCursor: cursor });
    for (const invalid of [
      { items: [completed, completed], nextCursor: null },
      { items: [{ ...completed, status: 'IN_PROGRESS' }], nextCursor: null },
      { items: [{ ...completed, score: 49 }], nextCursor: null },
      { items: [{ ...completed, passed: false }], nextCursor: null },
      { items: [{ ...open, score: 1 }], nextCursor: null },
      { items: [{ ...completed, questions: [] }], nextCursor: null },
      { items: [], nextCursor: `${cursor}=` },
      { items: [], nextCursor: encodeCursor({ v: 2, startedAt, examId: completed.examId }) },
      { items: [], nextCursor: encodeCursor({ examId: completed.examId, startedAt, v: 1 }) },
    ]) expect(examHistoryResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts only a strict consistent exam review', () => {
    const rows = questions.map((item, index) => ({
      examQuestionId: item.examQuestionId, position: item.position, question: item.question,
      selectedChoiceId: index >= 48 ? null : item.question.choices[index < 45 ? 0 : 1]!.id,
      correctChoiceId: item.question.choices[0]!.id,
      isCorrect: index >= 48 ? null : index < 45,
      answeredAt: index >= 48 ? null : startedAt,
      explanationThai: null, explanationEnglish: 'Why', explanationRussian: null,
      trapExplanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null,
    }));
    const review = { examId: start.examId, vehicleType: 'CAR', questionCount: 50, answeredCount: 48, unansweredCount: 2, score: 45, passingScore: 45, passed: true, startedAt, expiresAt, completedAt: expiresAt, questions: rows };
    expect(examResultSchema.parse(review)).toEqual(review);
    for (const invalid of [
      { ...review, score: 46 },
      { ...review, answeredCount: 50, unansweredCount: 0 },
      { ...review, passed: false },
      { ...review, questions: rows.slice(0, 49) },
      { ...review, questions: rows.map((row, index) => (index === 0 ? { ...row, isCorrect: false } : row)) },
      { ...review, questions: rows.map((row, index) => (index === 0 ? { ...row, selectedChoiceId: randomUUID() } : row)) },
      { ...review, questions: rows.map((row, index) => (index === 49 ? { ...row, isCorrect: false } : row)) },
      { ...review, questions: rows.map((row) => ({ ...row, position: 1 })) },
      { ...review, questions: rows.map((row) => ({ ...row, sourceType: 'ORIGINAL' })) },
    ]) expect(examResultSchema.safeParse(invalid).success).toBe(false);
  });
});
