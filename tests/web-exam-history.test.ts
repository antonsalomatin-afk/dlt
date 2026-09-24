import { describe, expect, it } from 'vitest';
import { examHistoryCursorSchema, examHistoryResponseSchema, examReviewResponseSchema } from '../apps/web/lib/contracts.ts';

const uuid = (value: number) => `650e8400-e29b-41d4-a716-${value.toString().padStart(12, '0')}`;
const cursor = (startedAt: string, examId: string) => Buffer.from(JSON.stringify({ v: 1, startedAt, examId }), 'utf8').toString('base64url');
const historyItem = (index: number, score = 45) => ({
  examId: uuid(index), vehicleType: index % 2 ? 'CAR' : 'MOTORCYCLE', questionCount: 50,
  answeredCount: 49, unansweredCount: 1, score, passingScore: 45, passed: score >= 45,
  startedAt: `2026-09-${20 - index}T08:00:00.000Z`, completedAt: `2026-09-${20 - index}T09:00:00.000Z`,
});
const question = (index: number) => ({
  id: uuid(100 + index), textThai: null, textExamEnglish: null, textEnglish: `Question ${index}`, textRussian: null,
  choices: ['A', 'B', 'C', 'D'].map((key, choice) => ({ id: uuid(1_000 + index * 4 + choice), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null })),
});
const mistake = (index: number, unanswered = false) => ({
  examQuestionId: uuid(500 + index), position: index, selectedChoiceId: unanswered ? null : question(index).choices[0]?.id,
  answeredAt: unanswered ? null : `2026-09-20T08:0${index}:00.000Z`, correctChoiceId: question(index).choices[2]?.id,
  question: question(index), explanationThai: null, explanationEnglish: 'Explanation', explanationRussian: null,
  trapExplanationThai: null, trapExplanationEnglish: 'Trap', trapExplanationRussian: null,
});

describe('Mini App exam history and review contracts', () => {
  it('accepts an exact ordered history page and canonical cursor', () => {
    const items = [historyItem(1), historyItem(2, 40)];
    const nextCursor = cursor(items[1]!.startedAt, items[1]!.examId);
    expect(examHistoryCursorSchema.parse(nextCursor)).toBe(nextCursor);
    expect(examHistoryResponseSchema.parse({ items, nextCursor })).toEqual({ items, nextCursor });
  });

  it('rejects malformed cursors, privacy fields, arithmetic, order, identity and cursor mismatches', () => {
    const first = historyItem(1);
    const second = historyItem(2, 40);
    for (const invalid of [
      { items: [{ ...first, userId: uuid(900) }], nextCursor: null },
      { items: [{ ...first, answeredCount: 48 }], nextCursor: null },
      { items: [{ ...first, score: 50 }], nextCursor: null },
      { items: [{ ...first, passed: false }], nextCursor: null },
      { items: [{ ...first, completedAt: '2026-09-19T07:59:59.000Z' }], nextCursor: null },
      { items: [second, first], nextCursor: null },
      { items: [first, first], nextCursor: null },
      { items: [first], nextCursor: cursor(second.startedAt, second.examId) },
      { items: [], nextCursor: cursor(first.startedAt, first.examId) },
    ]) expect(examHistoryResponseSchema.safeParse(invalid).success).toBe(false);
    for (const invalid of ['', 'abc=', cursor(first.startedAt, first.examId).toUpperCase(), Buffer.from('{}').toString('base64url')]) {
      expect(examHistoryCursorSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts exact incorrect and unanswered immutable mistakes', () => {
    const review = { examId: uuid(900), questionCount: 50, score: 48, passingScore: 45, passed: true, completedAt: '2026-09-20T09:00:00.000Z', mistakes: [mistake(1), mistake(2, true)] };
    expect(examReviewResponseSchema.parse(review)).toEqual(review);
    expect(examReviewResponseSchema.parse({ ...review, score: 50, mistakes: [] })).toEqual({ ...review, score: 50, mistakes: [] });
  });

  it('rejects review privacy, arithmetic, identity, ordering and choice violations', () => {
    const mistakes = [mistake(1), mistake(2, true)];
    const review = { examId: uuid(900), questionCount: 50, score: 48, passingScore: 45, passed: true, completedAt: '2026-09-20T09:00:00.000Z', mistakes };
    for (const invalid of [
      { ...review, userId: uuid(901) },
      { ...review, passed: false },
      { ...review, score: 47 },
      { ...review, mistakes: [mistakes[1], mistakes[0]] },
      { ...review, mistakes: [mistakes[0], { ...mistakes[1], examQuestionId: mistakes[0]!.examQuestionId }] },
      { ...review, mistakes: [mistakes[0], { ...mistakes[1], question: mistakes[0]!.question }] },
      { ...review, mistakes: [{ ...mistakes[0], answeredAt: null }, mistakes[1]] },
      { ...review, mistakes: [{ ...mistakes[0], selectedChoiceId: mistakes[0]!.correctChoiceId }, mistakes[1]] },
      { ...review, mistakes: [{ ...mistakes[0], selectedChoiceId: uuid(9999) }, mistakes[1]] },
      { ...review, mistakes: [{ ...mistakes[0], correctChoiceId: uuid(9999) }, mistakes[1]] },
      { ...review, mistakes: [{ ...mistakes[0], question: { ...mistakes[0]!.question, sourceUrl: 'hidden' } }, mistakes[1]] },
    ]) expect(examReviewResponseSchema.safeParse(invalid).success).toBe(false);
  });
});
