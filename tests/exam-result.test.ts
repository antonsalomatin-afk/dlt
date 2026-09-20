import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EXAM_DURATION_MS,
  EXAM_PASSING_SCORE,
  EXAM_QUESTION_COUNT,
  examResultParamsSchema,
  examResultQuestionSchema,
  examResultResponseSchema,
  readExamCompletionTuple,
  validateExamSessionRows,
  type ExamSessionRecord,
} from '../packages/database/src/exam.ts';

const examId = randomUUID();
const startedAt = new Date('2026-09-19T09:00:00.000Z');
const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
const completedAt = new Date(startedAt.getTime() + EXAM_DURATION_MS / 2);
const questionIds = Array.from({ length: EXAM_QUESTION_COUNT }, () => randomUUID());
const choiceIds = questionIds.map(() => Array.from({ length: 4 }, () => randomUUID()));

function choiceIdAt(questionIndex: number, choiceIndex: number) {
  const id = choiceIds[questionIndex]?.[choiceIndex];
  if (!id) throw new Error('Missing choice fixture');
  return id;
}

function snapshot(index: number) {
  return {
    version: 1,
    question: {
      id: questionIds[index],
      textThai: null,
      textExamEnglish: null,
      textEnglish: `Question ${index + 1}`,
      textRussian: null,
      choices: (['A', 'B', 'C', 'D'] as const).map((key, choiceIndex) => ({
        id: choiceIdAt(index, choiceIndex), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
      })),
    },
    correctChoiceId: choiceIdAt(index, 0),
    explanationThai: null,
    explanationEnglish: `Why ${index + 1}`,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: null,
    trapExplanationRussian: null,
  };
}

function record(outcomes: readonly (boolean | null)[]): ExamSessionRecord {
  return {
    questionCount: EXAM_QUESTION_COUNT,
    passingScore: EXAM_PASSING_SCORE,
    startedAt,
    expiresAt,
    questions: outcomes.map((outcome, index) => ({
      id: randomUUID(),
      position: index + 1,
      questionId: questionIds[index] as string,
      snapshot: snapshot(index),
      selectedChoiceId: outcome === null ? null : choiceIdAt(index, outcome ? 0 : 1),
      isCorrect: outcome,
      answeredAt: outcome === null ? null : completedAt,
    })),
  };
}

const examQuestionIds = questionIds.map(() => randomUUID());

function row(index: number, outcome: boolean | null) {
  const source = snapshot(index);
  return {
    examQuestionId: examQuestionIds[index] as string,
    position: index + 1,
    question: source.question,
    selectedChoiceId: outcome === null ? null : choiceIdAt(index, outcome ? 0 : 1),
    correctChoiceId: source.correctChoiceId,
    isCorrect: outcome,
    answeredAt: outcome === null ? null : completedAt.toISOString(),
    explanationThai: null,
    explanationEnglish: source.explanationEnglish,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: null,
    trapExplanationRussian: null,
  };
}

const outcomes: (boolean | null)[] = [
  ...Array.from({ length: 45 }, () => true),
  ...Array.from({ length: 3 }, () => false),
  null,
  null,
];

function response(overrides: Record<string, unknown> = {}) {
  return {
    examId,
    vehicleType: 'CAR',
    questionCount: EXAM_QUESTION_COUNT,
    answeredCount: 48,
    unansweredCount: 2,
    score: 45,
    passingScore: EXAM_PASSING_SCORE,
    passed: true,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    completedAt: expiresAt.toISOString(),
    questions: outcomes.map((outcome, index) => row(index, outcome)),
    ...overrides,
  };
}

describe('exam result contracts', () => {
  it('accepts only one canonical lowercase exam UUID path parameter', () => {
    expect(examResultParamsSchema.parse({ examId })).toEqual({ examId });
    for (const value of [{}, { examId: examId.toUpperCase() }, { examId: 'x' }, { examId, extra: 1 }, null]) {
      expect(() => examResultParamsSchema.parse(value)).toThrow();
    }
  });

  it('validates each reviewed row against its snapshot', () => {
    expect(examResultQuestionSchema.parse(row(0, true))).toEqual(row(0, true));
    expect(examResultQuestionSchema.parse(row(1, null))).toEqual(row(1, null));
    for (const invalid of [
      { ...row(0, true), isCorrect: false },
      { ...row(0, false), isCorrect: true },
      { ...row(0, true), selectedChoiceId: randomUUID() },
      { ...row(0, true), correctChoiceId: randomUUID() },
      { ...row(0, null), isCorrect: false },
      { ...row(0, null), answeredAt: completedAt.toISOString() },
      { ...row(0, true), answeredAt: null },
      { ...row(0, true), sourceType: 'ORIGINAL' },
      { ...row(0, true), imageUrl: null },
    ]) expect(() => examResultQuestionSchema.parse(invalid)).toThrow();
  });

  it('requires aggregate counts, score and pass result to match the reviewed rows', () => {
    expect(examResultResponseSchema.parse(response())).toEqual(response());
    for (const invalid of [
      response({ answeredCount: 50, unansweredCount: 0 }),
      response({ score: 46 }),
      response({ score: 44, passed: false }),
      response({ passed: false }),
      response({ passingScore: 44 }),
      response({ questionCount: 49 }),
      response({ questions: response().questions.slice(0, 49) }),
      response({ questions: response().questions.map((item) => ({ ...item, position: 1 })) }),
      response({ questions: response().questions.map((item) => ({ ...item, examQuestionId: item.position === 2 ? response().questions[0]?.examQuestionId : item.examQuestionId })) }),
      response({ expiresAt: new Date(expiresAt.getTime() + 1).toISOString() }),
      response({ completedAt: new Date(startedAt.getTime() - 1).toISOString() }),
      response({ completedAt: '2026-09-19T10:00:00Z' }),
      response({ userId: randomUUID() }),
    ]) expect(() => examResultResponseSchema.parse(invalid)).toThrow();
  });

  it('derives outcomes only from immutable snapshots and rejects inconsistent rows', () => {
    const { rows, summary } = validateExamSessionRows(record(outcomes));
    expect(rows.map(({ outcome }) => outcome)).toEqual(outcomes);
    expect(summary).toEqual({ answeredCount: 48, unansweredCount: 2, score: 45, passed: true });

    const corrupt = (mutate: (exam: ExamSessionRecord & { questions: ExamSessionRecord['questions'][number][] }) => void) => {
      const source = record(outcomes);
      const exam = { ...source, questions: [...source.questions] };
      mutate(exam);
      return exam;
    };
    for (const exam of [
      corrupt((value) => { value.passingScore = 44; }),
      corrupt((value) => { value.expiresAt = new Date(expiresAt.getTime() + 1); }),
      corrupt((value) => { value.questions = value.questions.slice(0, 49); }),
      corrupt((value) => { value.questions[1]!.position = 1; }),
      corrupt((value) => { value.questions[1]!.questionId = value.questions[0]!.questionId; }),
      corrupt((value) => { value.questions[0]!.snapshot = { version: 2 }; }),
      corrupt((value) => { value.questions[0]!.isCorrect = false; }),
      corrupt((value) => { value.questions[0]!.selectedChoiceId = randomUUID(); }),
      corrupt((value) => { value.questions[0]!.answeredAt = null; }),
      corrupt((value) => { value.questions[0]!.answeredAt = expiresAt; }),
      corrupt((value) => { value.questions[48]!.isCorrect = false; }),
    ]) expect(() => validateExamSessionRows(exam)).toThrow();
  });

  it('reads an all-null or complete completion tuple and rejects a partial one', () => {
    expect(readExamCompletionTuple({ completedAt: null, score: null, passed: null })).toBeNull();
    expect(readExamCompletionTuple({ completedAt, score: 45, passed: true })).toEqual({ completedAt, score: 45, passed: true });
    for (const partial of [
      { completedAt, score: null, passed: null },
      { completedAt: null, score: 45, passed: null },
      { completedAt, score: 45, passed: null },
    ]) expect(() => readExamCompletionTuple(partial)).toThrow();
  });
});
