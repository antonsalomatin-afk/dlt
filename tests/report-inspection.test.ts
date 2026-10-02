import { describe, expect, it } from 'vitest';
import {
  createReportInspectionInventory,
  maximumReportInventorySize,
} from '../tools/content/report-inspection.ts';

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const userId = uuid(1);
const questionId = uuid(2);
const anchorId = uuid(3);
const sessionId = uuid(4);

function snapshot(id = questionId) {
  return {
    version: 1 as const,
    question: {
      id,
      textThai: 'คำถามทดสอบ',
      textExamEnglish: 'Synthetic exam wording',
      textEnglish: 'Synthetic normalized wording',
      textRussian: 'Синтетический вопрос',
      choices: (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
        id: uuid(10 + index),
        key,
        textThai: `ตัวเลือก ${key}`,
        textEnglish: `Choice ${key}`,
        textRussian: `Вариант ${key}`,
      })),
    },
    correctChoiceId: uuid(10),
    explanationThai: 'คำอธิบาย',
    explanationEnglish: 'Explanation',
    explanationRussian: 'Объяснение',
    trapExplanationThai: 'กับดัก',
    trapExplanationEnglish: 'Trap explanation',
    trapExplanationRussian: 'Объяснение ловушки',
  };
}

function practiceReport(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(100),
    userId,
    questionId,
    presentationId: anchorId,
    details: 'Practice allegation 😀\nSecond line.',
    createdAt: new Date('2026-10-02T10:00:00.000Z'),
    presentation: { id: anchorId, userId, questionId, snapshot: snapshot() },
    ...overrides,
  };
}

function examReport(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(101),
    userId,
    questionId,
    examSessionId: sessionId,
    examQuestionId: anchorId,
    details: 'Exam allegation ภาษาไทย\nSecond line.',
    createdAt: new Date('2026-10-02T11:00:00.000Z'),
    examQuestion: { id: anchorId, examSessionId: sessionId, questionId, snapshot: snapshot() },
    examSession: { id: sessionId, userId },
    ...overrides,
  };
}

function inventory(practiceReports: unknown[], examReports: unknown[], counts = {
  practice: practiceReports.length,
  exam: examReports.length,
}) {
  return createReportInspectionInventory({ counts, practiceReports, examReports });
}

describe('report inspection projection', () => {
  it('projects exact public fields, exact summary and a deterministic combined order', () => {
    const tiedId = uuid(900);
    const tieTime = new Date('2026-10-02T12:00:00.000Z');
    const result = inventory([
      practiceReport(),
      practiceReport({ id: tiedId, createdAt: tieTime }),
    ], [
      examReport(),
      examReport({ id: tiedId, createdAt: tieTime }),
    ]);

    expect(result).toEqual({
      version: 1,
      summary: { total: 4, practice: 2, exam: 2 },
      items: [
        expect.objectContaining({ reportId: tiedId, kind: 'EXAM' }),
        expect.objectContaining({ reportId: tiedId, kind: 'PRACTICE' }),
        expect.objectContaining({ reportId: uuid(101), kind: 'EXAM' }),
        expect.objectContaining({ reportId: uuid(100), kind: 'PRACTICE' }),
      ],
    });
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([
        'anchorId', 'createdAt', 'details', 'kind', 'questionId', 'reportId', 'snapshot',
      ]);
      expect(item.snapshot).toEqual(snapshot());
    }
    const serialized = JSON.stringify(result);
    for (const prohibited of [
      'userId', 'telegram', 'username', 'token', 'examSessionId', 'selectedChoiceId',
      'isCorrect', 'score', 'passed', 'verificationStatus', 'sourceReference', 'reviewer',
    ]) expect(serialized).not.toContain(prohibited);
  });

  it('accepts empty and exactly 500 reports, then rejects 501 before projection', () => {
    expect(inventory([], [])).toEqual({
      version: 1,
      summary: { total: 0, practice: 0, exam: 0 },
      items: [],
    });
    const reports = Array.from({ length: maximumReportInventorySize }, (_, index) => (
      practiceReport({ id: uuid(1_000 + index) })
    ));
    expect(inventory(reports, []).summary.total).toBe(500);
    expect(() => inventory([...reports, practiceReport({ id: uuid(2_000) })], [])).toThrow();
  });

  it('rejects invalid counts, count mismatches and duplicate identities within either kind', () => {
    expect(() => inventory([], [], { practice: -1, exam: 0 })).toThrow();
    expect(() => inventory([], [], { practice: 1, exam: 0 })).toThrow();
    expect(() => inventory([practiceReport(), practiceReport()], [])).toThrow();
    expect(() => inventory([], [examReport(), examReport()])).toThrow();
  });

  it('rejects every practice and exam ownership tuple mismatch', () => {
    const other = uuid(999);
    const invalidPractice = [
      practiceReport({ presentationId: other }),
      practiceReport({ presentation: { id: anchorId, userId: other, questionId, snapshot: snapshot() } }),
      practiceReport({ presentation: { id: anchorId, userId, questionId: other, snapshot: snapshot() } }),
    ];
    for (const report of invalidPractice) expect(() => inventory([report], [])).toThrow();

    const invalidExam = [
      examReport({ examQuestionId: other }),
      examReport({ examQuestion: { id: anchorId, examSessionId: other, questionId, snapshot: snapshot() } }),
      examReport({ examQuestion: { id: anchorId, examSessionId: sessionId, questionId: other, snapshot: snapshot() } }),
      examReport({ examSessionId: other }),
      examReport({ examSession: { id: sessionId, userId: other } }),
    ];
    for (const report of invalidExam) expect(() => inventory([], [report])).toThrow();
  });

  it('rejects malformed identities, timestamps, details, snapshots and extra private fields', () => {
    const invalidPractice = [
      practiceReport({ id: uuid(0xabcdef).toUpperCase() }),
      practiceReport({ createdAt: new Date(Number.NaN) }),
      practiceReport({ createdAt: new Date('+010000-01-01T00:00:00.000Z') }),
      practiceReport({ details: 'ab' }),
      practiceReport({ details: ' padded allegation' }),
      practiceReport({ presentation: { id: anchorId, userId, questionId, snapshot: { version: 999 } } }),
      practiceReport({ presentation: { id: anchorId, userId, questionId, snapshot: snapshot(uuid(998)) } }),
      practiceReport({ telegramUserId: 'private' }),
    ];
    for (const report of invalidPractice) expect(() => inventory([report], [])).toThrow();

    const uppercaseSnapshot = snapshot();
    uppercaseSnapshot.question.choices[0]!.id = uuid(10).toUpperCase();
    expect(() => inventory([], [examReport({
      examQuestion: { id: anchorId, examSessionId: sessionId, questionId, snapshot: uppercaseSnapshot },
    })])).toThrow();
    expect(() => inventory([], [examReport({ selectedChoiceId: uuid(12) })])).toThrow();
  });
});
