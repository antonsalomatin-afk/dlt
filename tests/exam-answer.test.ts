import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  examAnswerRequestSchema,
  examAnswerResponseSchema,
} from '../packages/database/src/exam.ts';

function validResponse() {
  return {
    examId: randomUUID(),
    examQuestionId: randomUUID(),
    selectedChoiceId: randomUUID(),
    answeredAt: '2026-09-17T15:00:00.000Z',
    answeredCount: 1,
    remainingCount: 49,
  };
}

describe('exam answer contracts', () => {
  it('accepts only the exact two-member canonical UUID request', () => {
    const request = { examQuestionId: randomUUID(), choiceId: randomUUID() };
    expect(examAnswerRequestSchema.parse(request)).toEqual(request);
    for (const value of [
      undefined,
      null,
      [],
      {},
      { examQuestionId: request.examQuestionId },
      { ...request, choiceId: request.choiceId.toUpperCase() },
      { ...request, extra: true },
    ]) expect(examAnswerRequestSchema.safeParse(value).success).toBe(false);
  });

  it('validates the exact safe acknowledgement and count invariants', () => {
    const response = validResponse();
    expect(examAnswerResponseSchema.parse(response)).toEqual(response);
    for (const value of [
      { ...response, answeredAt: '2026-09-17T15:00:00Z' },
      { ...response, answeredCount: 0, remainingCount: 50 },
      { ...response, answeredCount: 51, remainingCount: -1 },
      { ...response, answeredCount: 1, remainingCount: 48 },
      { ...response, isCorrect: true },
      { ...response, correctChoiceId: randomUUID() },
      { ...response, score: 1 },
      { ...response, explanationEnglish: 'private' },
      { ...response, userId: randomUUID() },
    ]) expect(examAnswerResponseSchema.safeParse(value).success).toBe(false);
  });

  it('accepts the 50th-answer boundary without disclosing completion data', () => {
    const response = { ...validResponse(), answeredCount: 50, remainingCount: 0 };
    expect(examAnswerResponseSchema.parse(response)).toEqual(response);
    expect(Object.keys(response).sort()).toEqual([
      'answeredAt',
      'answeredCount',
      'examId',
      'examQuestionId',
      'remainingCount',
      'selectedChoiceId',
    ]);
  });
});
