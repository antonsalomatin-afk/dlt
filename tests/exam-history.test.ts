import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encodeExamHistoryCursor,
  examHistoryItemSchema,
  examHistoryResponseSchema,
  examHistoryStatus,
  parseExamHistoryCursor,
  parseExamHistoryQuery,
} from '../packages/database/src/exam-history.ts';
import { EXAM_DURATION_MS } from '../packages/database/src/exam.ts';

const examId = randomUUID();
const startedAt = '2026-09-19T09:00:00.123Z';
const expiresAt = new Date(new Date(startedAt).getTime() + EXAM_DURATION_MS).toISOString();
const cursor = { v: 1 as const, startedAt, examId };

function item(overrides: Record<string, unknown> = {}) {
  return {
    examId,
    vehicleType: 'CAR',
    status: 'COMPLETED',
    questionCount: 50,
    passingScore: 45,
    answeredCount: 48,
    startedAt,
    expiresAt,
    completedAt: expiresAt,
    score: 45,
    passed: true,
    ...overrides,
  };
}

describe('exam history contracts', () => {
  it('round-trips the canonical bounded exam cursor and strict query', () => {
    const encoded = encodeExamHistoryCursor(cursor);
    expect(encoded).not.toContain('=');
    expect(parseExamHistoryCursor(encoded)).toEqual(cursor);
    expect(parseExamHistoryQuery({ cursor: encoded })).toEqual({ limit: 20, cursor });
    expect(parseExamHistoryQuery({})).toEqual({ limit: 20, cursor: null });
    expect(parseExamHistoryQuery({ limit: '50' })).toEqual({ limit: 50, cursor: null });
    for (const query of [
      { limit: '0' }, { limit: '01' }, { limit: '51' }, { limit: '+1' }, { limit: ['1', '2'] },
      { cursor: '' }, { cursor: `${encoded}=` }, { extra: '1' },
    ]) expect(() => parseExamHistoryQuery(query)).toThrow();
    const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    for (const value of [
      Buffer.from([0xff]).toString('base64url'),
      Buffer.from('{', 'utf8').toString('base64url'),
      encodeJson({ ...cursor, v: 2 }),
      encodeJson({ ...cursor, extra: true }),
      encodeJson({ ...cursor, examId: examId.toUpperCase() }),
      encodeJson({ ...cursor, startedAt: '2026-09-19T09:00:00Z' }),
      encodeJson({ examId, startedAt, v: 1 }),
    ]) expect(() => parseExamHistoryCursor(value)).toThrow();
  });

  it('derives status from completion and the request time', () => {
    const expiry = new Date(expiresAt);
    expect(examHistoryStatus({ expiresAt: expiry, completedAt: null }, new Date(expiry.getTime() - 1))).toBe('IN_PROGRESS');
    expect(examHistoryStatus({ expiresAt: expiry, completedAt: null }, expiry)).toBe('EXPIRED');
    expect(examHistoryStatus({ expiresAt: expiry, completedAt: expiry }, new Date(0))).toBe('COMPLETED');
  });

  it('enforces the strict item and envelope invariants', () => {
    expect(examHistoryItemSchema.parse(item())).toEqual(item());
    const open = item({ status: 'IN_PROGRESS', completedAt: null, score: null, passed: null, answeredCount: 3 });
    expect(examHistoryItemSchema.parse(open)).toEqual(open);
    expect(examHistoryItemSchema.parse({ ...open, status: 'EXPIRED' })).toEqual({ ...open, status: 'EXPIRED' });
    for (const invalid of [
      item({ status: 'IN_PROGRESS' }),
      item({ completedAt: null }),
      item({ score: null }),
      item({ passed: null }),
      item({ score: 44 }),
      item({ score: 49 }),
      item({ passed: false }),
      item({ questionCount: 49 }),
      item({ passingScore: 44 }),
      item({ expiresAt: new Date(new Date(expiresAt).getTime() + 1).toISOString() }),
      item({ completedAt: '2026-09-19T08:59:59.999Z' }),
      item({ examId: examId.toUpperCase() }),
      item({ questions: [] }),
      item({ userId: randomUUID() }),
      { ...open, status: 'COMPLETED' },
    ]) expect(() => examHistoryItemSchema.parse(invalid)).toThrow();
    expect(examHistoryResponseSchema.parse({ items: [item()], nextCursor: encodeExamHistoryCursor(cursor) }).items).toHaveLength(1);
    expect(() => examHistoryResponseSchema.parse({ items: [], nextCursor: 'not-a-cursor' })).toThrow();
    expect(() => examHistoryResponseSchema.parse({ items: Array.from({ length: 51 }, () => item()), nextCursor: null })).toThrow();
  });
});
