import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encodeExamHistoryCursor,
  examHistoryResponseSchema,
  parseExamHistoryCursor,
  parseExamHistoryQuery,
} from '../packages/database/src/exam-history.ts';

const examId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const startedAt = '2026-09-18T08:00:00.123Z';
const cursor = { v: 1 as const, startedAt, examId };

function item(overrides: Record<string, unknown> = {}) {
  return {
    examId,
    vehicleType: 'CAR',
    questionCount: 50,
    answeredCount: 48,
    unansweredCount: 2,
    score: 45,
    passingScore: 45,
    passed: true,
    startedAt,
    completedAt: '2026-09-18T09:00:00.123Z',
    ...overrides,
  };
}

describe('exam history query and cursor contracts', () => {
  it('round-trips the canonical bounded unpadded cursor', () => {
    const encoded = encodeExamHistoryCursor(cursor);
    expect(encoded).toBe(Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'));
    expect(encoded).not.toContain('=');
    expect(parseExamHistoryCursor(encoded)).toEqual(cursor);
    expect(parseExamHistoryQuery({ cursor: encoded })).toEqual({ limit: 20, cursor });
  });

  it('accepts only exact keys and canonical decimal limits from 1 through 50', () => {
    expect(parseExamHistoryQuery({})).toEqual({ limit: 20, cursor: null });
    expect(parseExamHistoryQuery({ limit: '1' })).toEqual({ limit: 1, cursor: null });
    expect(parseExamHistoryQuery({ limit: '50' })).toEqual({ limit: 50, cursor: null });
    for (const query of [
      null, [], { limit: '' }, { limit: '0' }, { limit: '01' }, { limit: '+1' }, { limit: '-1' },
      { limit: '1.0' }, { limit: ' 1' }, { limit: '51' }, { limit: ['1', '2'] },
      { cursor: '' }, { cursor: ['one', 'two'] }, { extra: '1' },
    ]) expect(() => parseExamHistoryQuery(query)).toThrow();
  });

  it('rejects malformed, unsupported and noncanonical cursors', () => {
    const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const encoded = encodeExamHistoryCursor(cursor);
    for (const value of [
      `${encoded}=`, '+', 'a'.repeat(513), Buffer.from([0xff]).toString('base64url'),
      Buffer.from('{', 'utf8').toString('base64url'),
      encodeJson({ ...cursor, v: 2 }),
      encodeJson({ ...cursor, extra: true }),
      encodeJson({ ...cursor, examId: 'invalid' }),
      encodeJson({ ...cursor, examId: examId.toUpperCase() }),
      encodeJson({ ...cursor, startedAt: '2026-09-18T08:00:00Z' }),
      Buffer.from(JSON.stringify({ examId, startedAt, v: 1 }), 'utf8').toString('base64url'),
      Buffer.from(`{ "v":1,"startedAt":"${startedAt}","examId":"${examId}" }`, 'utf8').toString('base64url'),
    ]) expect(() => parseExamHistoryCursor(value)).toThrow();
  });
});

describe('exam history response contract', () => {
  it('accepts exact pass/fail summaries in descending stable order', () => {
    const response = {
      items: [
        item(),
        item({
          examId: 'abcdefab-cdef-4abc-8def-abcdefabcdee',
          vehicleType: 'MOTORCYCLE',
          answeredCount: 50,
          unansweredCount: 0,
          score: 44,
          passed: false,
        }),
      ],
      nextCursor: encodeExamHistoryCursor(cursor),
    };
    expect(examHistoryResponseSchema.parse(response)).toEqual(response);
    expect(examHistoryResponseSchema.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
    expect(Object.keys(response.items[0]!).sort()).toEqual([
      'answeredCount', 'completedAt', 'examId', 'passed', 'passingScore', 'questionCount', 'score',
      'startedAt', 'unansweredCount', 'vehicleType',
    ]);
  });

  it('rejects count, score, pass, order, identity, timestamp and privacy violations', () => {
    const first = item();
    const second = item({ examId: 'abcdefab-cdef-4abc-8def-abcdefabcdee' });
    const response = { items: [first, second], nextCursor: null };
    for (const invalid of [
      { ...response, extra: true },
      { ...response, items: [{ ...first, userId: randomUUID() }, second] },
      { ...response, items: [{ ...first, questionCount: 49 }, second] },
      { ...response, items: [{ ...first, passingScore: 44 }, second] },
      { ...response, items: [{ ...first, answeredCount: 47 }, second] },
      { ...response, items: [{ ...first, score: 49 }, second] },
      { ...response, items: [{ ...first, passed: false }, second] },
      { ...response, items: [{ ...first, completedAt: '2026-09-18T09:00:00Z' }, second] },
      { ...response, items: [{ ...first, completedAt: '2026-09-18T07:59:59.999Z' }, second] },
      { ...response, items: [{ ...first, examId: examId.toUpperCase() }, second] },
      { ...response, items: [second, first] },
      { ...response, items: [first, { ...second, examId: first.examId }] },
      { ...response, items: Array.from({ length: 51 }, (_, index) => item({ examId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}` })) },
      { ...response, nextCursor: `${encodeExamHistoryCursor(cursor)}=` },
    ]) expect(() => examHistoryResponseSchema.parse(invalid)).toThrow();
  });
});
