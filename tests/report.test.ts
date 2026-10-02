import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../packages/database/src/index.ts';
import {
  isDuplicateQuestionReport,
  questionReportRequestSchema,
  questionReportResponseSchema,
} from '../packages/database/src/report.ts';

describe('question report contracts', () => {
  it('accepts strict trimmed details with line feeds and exact character and UTF-8 byte bounds', () => {
    const presentationId = randomUUID();
    for (const details of ['abc', 'Line one\nLine two', 'a'.repeat(1000), '😀'.repeat(1000)]) {
      expect(questionReportRequestSchema.parse({ presentationId, details })).toEqual({ presentationId, details });
    }
  });

  it('rejects invalid fields, whitespace, bounds, bytes and non-line-feed controls', () => {
    const presentationId = randomUUID();
    const invalidDetails = [
      '', 'ab', ' abc', 'abc ', '\nabc', 'abc\n', 'a'.repeat(1001), '😀'.repeat(1000) + 'a',
      'ab\tcd', 'ab\rcd', 'ab\0cd', `ab${String.fromCodePoint(0x7f)}cd`,
      `ab${String.fromCharCode(0xd800)}cd`, `ab${String.fromCharCode(0xdc00)}cd`,
    ];
    for (const details of invalidDetails) {
      expect(() => questionReportRequestSchema.parse({ presentationId, details })).toThrow();
    }
    for (const input of [
      null,
      {},
      { presentationId: 'not-a-uuid', details: 'valid details' },
      { presentationId, details: 123 },
      { presentationId, details: 'valid details', extra: true },
    ]) expect(() => questionReportRequestSchema.parse(input)).toThrow();
  });

  it('enforces the minimal canonical response boundary', () => {
    const response = {
      reportId: randomUUID(),
      presentationId: randomUUID(),
      createdAt: '2026-10-01T15:00:00.000Z',
    };
    expect(questionReportResponseSchema.parse(response)).toEqual(response);
    for (const invalid of [
      { ...response, reportId: 'bad' },
      { ...response, createdAt: '2026-10-01T15:00:00Z' },
      { ...response, details: 'must not appear' },
    ]) expect(() => questionReportResponseSchema.parse(invalid)).toThrow();
  });

  it('classifies only the report presentation unique constraint', () => {
    const error = (code: string, meta: Record<string, unknown>) => (
      new Prisma.PrismaClientKnownRequestError('synthetic', { code, clientVersion: 'test', meta })
    );
    const cause = {
      originalCode: '23505',
      kind: 'UniqueConstraintViolation',
      table: 'QuestionReport',
      constraint: { index: 'QuestionReport_presentationId_key' },
    };
    const metadata = { modelName: 'QuestionReport', driverAdapterError: { cause } };
    expect(isDuplicateQuestionReport(error('P2002', metadata))).toBe(true);
    for (const patch of [
      { table: 'Other' },
      { constraint: { index: 'QuestionReport_pkey' } },
      { constraint: { index: 'QuestionReport_presentationId_userId_questionId_key' } },
      { originalCode: '23503' },
    ]) {
      expect(isDuplicateQuestionReport(error('P2002', {
        ...metadata,
        driverAdapterError: { cause: { ...cause, ...patch } },
      }))).toBe(false);
    }
    for (const value of [
      new Error('failure'),
      error('P2003', metadata),
      error('P2002', { modelName: 'QuestionReport', target: ['presentationId'] }),
      error('P2002', { modelName: 'Other', driverAdapterError: { cause } }),
      error('P2002', {}),
    ]) expect(isDuplicateQuestionReport(value)).toBe(false);
  });
});
