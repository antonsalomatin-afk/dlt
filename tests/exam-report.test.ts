import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../packages/database/src/index.ts';
import {
  examQuestionReportRequestSchema,
  examQuestionReportResponseSchema,
  isDuplicateExamQuestionReport,
} from '../packages/database/src/report.ts';

describe('exam question report contracts', () => {
  it('reuses the exact bounded report text rules in a strict request', () => {
    const examQuestionId = randomUUID();
    for (const details of ['abc', 'Line one\nLine two', 'a'.repeat(1000), '😀'.repeat(1000)]) {
      expect(examQuestionReportRequestSchema.parse({ examQuestionId, details })).toEqual({ examQuestionId, details });
    }
    for (const details of [
      '', 'ab', ' abc', 'abc ', '\nabc', 'abc\n', 'a'.repeat(1001), '😀'.repeat(1000) + 'a',
      'ab\tcd', 'ab\rcd', 'ab\0cd', `ab${String.fromCodePoint(0x7f)}cd`,
      `ab${String.fromCharCode(0xd800)}cd`, `ab${String.fromCharCode(0xdc00)}cd`,
    ]) expect(examQuestionReportRequestSchema.safeParse({ examQuestionId, details }).success).toBe(false);
    for (const input of [null, {}, { examQuestionId: 'bad', details: 'valid details' }, { examQuestionId, details: 'valid details', extra: true }]) {
      expect(examQuestionReportRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it('enforces the minimal canonical response boundary', () => {
    const response = { reportId: randomUUID(), examQuestionId: randomUUID(), createdAt: '2026-10-02T07:00:00.000Z' };
    expect(examQuestionReportResponseSchema.parse(response)).toEqual(response);
    for (const invalid of [
      { ...response, reportId: 'bad' }, { ...response, examQuestionId: 'bad' },
      { ...response, createdAt: '2026-10-02T07:00:00Z' }, { ...response, details: 'hidden' },
    ]) expect(examQuestionReportResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('classifies only the global exam-question report uniqueness conflict', () => {
    const error = (code: string, meta: Record<string, unknown>) => (
      new Prisma.PrismaClientKnownRequestError('synthetic', { code, clientVersion: 'test', meta })
    );
    const cause = {
      originalCode: '23505', kind: 'UniqueConstraintViolation', table: 'ExamQuestionReport',
      constraint: { index: 'ExamQuestionReport_examQuestionId_key' },
    };
    const metadata = { modelName: 'ExamQuestionReport', driverAdapterError: { cause } };
    expect(isDuplicateExamQuestionReport(error('P2002', metadata))).toBe(true);
    for (const patch of [
      { table: 'QuestionReport' }, { constraint: { index: 'ExamQuestionReport_pkey' } },
      { constraint: { index: 'ExamQuestionReport_examQuestionId_examSessionId_questionId_key' } }, { originalCode: '23503' },
    ]) expect(isDuplicateExamQuestionReport(error('P2002', {
      ...metadata, driverAdapterError: { cause: { ...cause, ...patch } },
    }))).toBe(false);
    for (const value of [
      new Error('failure'), error('P2003', metadata), error('P2002', { modelName: 'ExamQuestionReport', target: ['examQuestionId'] }),
      error('P2002', { modelName: 'QuestionReport', driverAdapterError: { cause } }), error('P2002', {}),
    ]) expect(isDuplicateExamQuestionReport(value)).toBe(false);
  });
});
