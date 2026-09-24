import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { currentExamResponseSchema } from '../packages/database/src/exam.ts';

const startedAt = '2026-09-24T06:00:00.000Z';
const expiresAt = '2026-09-24T07:00:00.000Z';

function question(position: number, answered = position <= 2) {
  const choiceIds = Array.from({ length: 4 }, () => randomUUID());
  return {
    examQuestionId: randomUUID(),
    position,
    selectedChoiceId: answered ? choiceIds[1] : null,
    answeredAt: answered ? '2026-09-24T06:15:00.123Z' : null,
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
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    examId: 'abcdefab-cdef-4abc-8def-abcdefabcdef',
    vehicleType: 'CAR',
    questionCount: 50,
    passingScore: 45,
    startedAt,
    expiresAt,
    serverTime: '2026-09-24T06:30:00.123Z',
    expired: false,
    answeredCount: 2,
    remainingCount: 48,
    questions: Array.from({ length: 50 }, (_, index) => question(index + 1)),
    ...overrides,
  };
}

describe('current exam response contract', () => {
  it('accepts the exact active response and safe question fields', () => {
    const value = response();
    expect(currentExamResponseSchema.parse(value)).toEqual(value);
    expect(Object.keys(value).sort()).toEqual([
      'answeredCount', 'examId', 'expired', 'expiresAt', 'passingScore', 'questionCount', 'questions',
      'remainingCount', 'serverTime', 'startedAt', 'vehicleType',
    ]);
    expect(Object.keys(value.questions[0]!).sort()).toEqual([
      'answeredAt', 'examQuestionId', 'position', 'question', 'selectedChoiceId',
    ]);
    expect(Object.keys(value.questions[0]!.question).sort()).toEqual([
      'choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai',
    ]);
  });

  it('computes expiry at the exact server-time boundary', () => {
    expect(currentExamResponseSchema.parse(response({ serverTime: expiresAt, expired: true })).expired).toBe(true);
    expect(() => currentExamResponseSchema.parse(response({ serverTime: expiresAt, expired: false }))).toThrow();
    expect(() => currentExamResponseSchema.parse(response({ serverTime: '2026-09-24T06:59:59.999Z', expired: true }))).toThrow();
  });

  it('enforces progress counts, answer pairing, choice membership and answer timing', () => {
    const value = response();
    const answered = value.questions[0]!;
    for (const invalid of [
      response({ answeredCount: 1, remainingCount: 49 }),
      response({ remainingCount: 47 }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, selectedChoiceId: null } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, answeredAt: null } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, selectedChoiceId: randomUUID() } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, answeredAt: '2026-09-24T05:59:59.999Z' } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, answeredAt: expiresAt } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, answeredAt: '2026-09-24T06:15:00Z' } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, selectedChoiceId: answered.question.choices[0]?.id, isCorrect: true } : item) }),
    ]) expect(() => currentExamResponseSchema.parse(invalid)).toThrow();
  });

  it('enforces canonical timing, fixed policy, ordered unique identities and strict privacy', () => {
    const value = response();
    const first = value.questions[0]!;
    const second = value.questions[1]!;
    for (const invalid of [
      response({ questionCount: 49 }),
      response({ passingScore: 44 }),
      response({ expiresAt: '2026-09-24T07:00:00.001Z' }),
      response({ serverTime: '2026-09-24T06:30:00Z' }),
      response({ examId: value.examId.toUpperCase() }),
      response({ score: 2 }),
      response({ questions: value.questions.slice(0, 49) }),
      response({ questions: [second, first, ...value.questions.slice(2)] }),
      response({ questions: value.questions.map((item, index) => index === 1 ? { ...item, examQuestionId: first.examQuestionId } : item) }),
      response({ questions: value.questions.map((item, index) => index === 1 ? { ...item, question: { ...item.question, id: first.question.id } } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, examQuestionId: item.examQuestionId.toUpperCase() } : item) }),
      response({ questions: value.questions.map((item, index) => index === 0 ? { ...item, question: { ...item.question, correctChoiceId: item.question.choices[0]?.id } } : item) }),
    ]) expect(() => currentExamResponseSchema.parse(invalid)).toThrow();
  });
});
