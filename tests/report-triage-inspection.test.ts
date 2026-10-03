import { describe, expect, it } from 'vitest';
import {
  createReportTriageAuditInventory,
} from '../tools/content/report-triage-inspection.ts';

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const userId = uuid(1);
const questionId = uuid(2);
const anchorId = uuid(3);
const sessionId = uuid(4);
const commandClock = new Date('2026-10-03T00:00:00.000Z');

function snapshot(id = questionId) {
  return {
    version: 1 as const,
    question: {
      id,
      textThai: 'PRIVATE SNAPSHOT QUESTION',
      textExamEnglish: 'Private exam wording',
      textEnglish: 'Private normalized wording',
      textRussian: 'Приватный вопрос',
      choices: (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
        id: uuid(10 + index),
        key,
        textThai: `PRIVATE THAI CHOICE ${key}`,
        textEnglish: `Private choice ${key}`,
        textRussian: `Приватный вариант ${key}`,
      })),
    },
    correctChoiceId: uuid(10),
    explanationThai: 'PRIVATE THAI EXPLANATION',
    explanationEnglish: 'Private explanation',
    explanationRussian: 'Приватное объяснение',
    trapExplanationThai: 'PRIVATE THAI TRAP',
    trapExplanationEnglish: 'Private trap explanation',
    trapExplanationRussian: 'Приватная ловушка',
  };
}

function practiceReport(index = 0, overrides: Record<string, unknown> = {}) {
  const id = uuid(100 + index);
  const presentationId = uuid(200 + index);
  return {
    id,
    userId,
    questionId,
    presentationId,
    details: `PRIVATE ALLEGATION ${index} 😀\nSecond line.`,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    presentation: { id: presentationId, userId, questionId, snapshot: snapshot() },
    triageDecision: null,
    triagedBy: null,
    triagedAt: null,
    ...overrides,
  };
}

function examReport(index = 0, overrides: Record<string, unknown> = {}) {
  const id = uuid(300 + index);
  const examQuestionId = uuid(400 + index);
  return {
    id,
    userId,
    questionId,
    examSessionId: sessionId,
    examQuestionId,
    details: `PRIVATE EXAM ALLEGATION ${index} 😀\nSecond line.`,
    createdAt: new Date('2026-10-01T11:00:00.000Z'),
    examQuestion: { id: examQuestionId, examSessionId: sessionId, questionId, snapshot: snapshot() },
    examSession: { id: sessionId, userId },
    triageDecision: null,
    triagedBy: null,
    triagedAt: null,
    ...overrides,
  };
}

function audit(practiceReports: unknown[], examReports: unknown[], counts = {
  practice: practiceReports.length,
  exam: examReports.length,
}, clock = commandClock) {
  return createReportTriageAuditInventory({ counts, practiceReports, examReports, commandClock: clock });
}

describe('report triage audit projection', () => {
  it('projects mixed triage states, exact summaries and deterministic cross-kind ties', () => {
    const tiedId = uuid(900);
    const tiedAt = new Date('2026-10-02T12:00:00.000Z');
    const result = audit([
      practiceReport(),
      practiceReport(1, {
        id: tiedId,
        createdAt: tiedAt,
        triageDecision: 'ACTION_REQUIRED',
        triagedBy: 'Trusted Reviewer 😀',
        triagedAt: new Date('2026-10-02T13:00:00.000Z'),
      }),
    ], [
      examReport(0, {
        triageDecision: 'NO_ACTION_REQUIRED',
        triagedBy: 'Second Trusted Reviewer',
        triagedAt: new Date('2026-10-02T14:00:00.000Z'),
      }),
      examReport(1, { id: tiedId, createdAt: tiedAt }),
    ]);

    expect(result).toEqual({
      version: 1,
      summary: {
        total: 4,
        practice: 2,
        exam: 2,
        pending: 2,
        actionRequired: 1,
        noActionRequired: 1,
      },
      items: [
        expect.objectContaining({ reportId: tiedId, kind: 'EXAM', triage: null }),
        expect.objectContaining({ reportId: tiedId, kind: 'PRACTICE', triage: {
          decision: 'ACTION_REQUIRED',
          triagedBy: 'Trusted Reviewer 😀',
          triagedAt: '2026-10-02T13:00:00.000Z',
        } }),
        expect.objectContaining({ reportId: uuid(300), kind: 'EXAM', triage: {
          decision: 'NO_ACTION_REQUIRED',
          triagedBy: 'Second Trusted Reviewer',
          triagedAt: '2026-10-02T14:00:00.000Z',
        } }),
        expect.objectContaining({ reportId: uuid(100), kind: 'PRACTICE', triage: null }),
      ],
    });
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([
        'anchorId', 'createdAt', 'kind', 'questionId', 'reportId', 'triage',
      ]);
      if (item.triage !== null) {
        expect(Object.keys(item.triage).sort()).toEqual(['decision', 'triagedAt', 'triagedBy']);
      }
    }
    const serialized = JSON.stringify(result);
    for (const prohibited of [
      'PRIVATE ALLEGATION', 'PRIVATE EXAM ALLEGATION', 'PRIVATE SNAPSHOT QUESTION',
      'Private choice', 'correctChoiceId', 'Private explanation', 'userId',
      'examSessionId', 'details', 'snapshot', 'selectedChoiceId', 'isCorrect',
      'score', 'passed', 'verificationStatus', 'sourceReference',
    ]) expect(serialized).not.toContain(prohibited);
  });

  it('accepts 0 and 500 reports, then rejects 501 and count mismatches', () => {
    expect(audit([], [])).toEqual({
      version: 1,
      summary: { total: 0, practice: 0, exam: 0, pending: 0, actionRequired: 0, noActionRequired: 0 },
      items: [],
    });
    const reports = Array.from({ length: 500 }, (_, index) => practiceReport(index));
    expect(audit(reports, []).summary.total).toBe(500);
    expect(() => audit([...reports, practiceReport(500)], [])).toThrow();
    expect(() => audit([], [], { practice: 1, exam: 0 })).toThrow();
  });

  it('rejects duplicate report identities and invalid hidden evidence or ownership', () => {
    expect(() => audit([practiceReport(), practiceReport()], [])).toThrow();
    expect(() => audit([], [examReport(), examReport()])).toThrow();
    expect(() => audit([practiceReport(0, { details: 'ab' })], [])).toThrow();
    expect(() => audit([practiceReport(0, {
      presentation: { id: anchorId, userId, questionId, snapshot: { version: 999 } },
    })], [])).toThrow();
    expect(() => audit([], [examReport(0, { examSessionId: uuid(999) })])).toThrow();
    expect(() => audit([practiceReport(0, { selectedChoiceId: uuid(10) })], [])).toThrow();
  });

  it('rejects every partial triage tuple and malformed complete tuple', () => {
    const valid = {
      triageDecision: 'ACTION_REQUIRED',
      triagedBy: 'Trusted Reviewer',
      triagedAt: new Date('2026-10-02T00:00:00.000Z'),
    } as const;
    for (let mask = 1; mask < 7; mask++) {
      expect(() => audit([practiceReport(0, {
        triageDecision: (mask & 1) === 0 ? null : valid.triageDecision,
        triagedBy: (mask & 2) === 0 ? null : valid.triagedBy,
        triagedAt: (mask & 4) === 0 ? null : valid.triagedAt,
      })], [])).toThrow();
    }
    for (const override of [
      { ...valid, triageDecision: 'PENDING' },
      { ...valid, triagedBy: '' },
      { ...valid, triagedBy: ' padded ' },
      { ...valid, triagedBy: 'bad\u0000operator' },
      { ...valid, triagedBy: 'bad\ud800operator' },
      { ...valid, triagedBy: 'x'.repeat(201) },
      { ...valid, triagedAt: new Date('2026-10-01T09:59:59.999Z') },
      { ...valid, triagedAt: new Date('2026-10-03T00:00:00.001Z') },
      { ...valid, triagedAt: new Date(Number.NaN) },
      { ...valid, triagedAt: new Date('+010000-01-01T00:00:00.000Z') },
    ]) expect(() => audit([practiceReport(0, override)], [])).toThrow();
    expect(() => audit([practiceReport()], [], undefined, new Date(Number.NaN))).toThrow();
  });
});
