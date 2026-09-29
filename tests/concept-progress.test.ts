import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildConceptProgressItem,
  conceptProgressResponseSchema,
  encodeConceptProgressCursor,
  parseConceptProgressCursor,
  parseConceptProgressQuery,
} from '../packages/database/src/concept-progress.ts';

const conceptId = randomUUID();
const lastPracticeAt = new Date('2026-09-29T10:00:00.000Z');
const lastExamAt = new Date('2026-09-29T11:00:00.000Z');
const row = {
  conceptId,
  slug: 'right-of-way',
  nameThai: 'สิทธิ์ทาง',
  nameEnglish: 'Right of way',
  nameRussian: 'Преимущество',
  practiceAnswered: 3,
  practiceCorrect: 2,
  examAnswered: 2,
  examCorrect: 1,
  lastPracticeAt,
  lastExamAt,
  lastActivityAt: lastExamAt,
};

describe('concept progress contracts', () => {
  it('accepts only strict canonical queries and round-trips an opaque cursor', () => {
    const cursor = { v: 1 as const, lastActivityAt: lastExamAt.toISOString(), conceptId };
    const encoded = encodeConceptProgressCursor(cursor);
    expect(encoded).toBe(Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'));
    expect(encoded).not.toContain('=');
    expect(parseConceptProgressCursor(encoded)).toEqual(cursor);
    expect(parseConceptProgressQuery({})).toEqual({ limit: 20, cursor: null });
    expect(parseConceptProgressQuery({ limit: '1', cursor: encoded })).toEqual({ limit: 1, cursor });
    expect(parseConceptProgressQuery({ limit: '50' })).toEqual({ limit: 50, cursor: null });
    for (const query of [
      { limit: '' }, { limit: '0' }, { limit: '01' }, { limit: '+1' }, { limit: '1.0' },
      { limit: '51' }, { limit: ['1', '2'] }, { cursor: '' }, { cursor: ['one', 'two'] }, { extra: '1' },
    ]) expect(() => parseConceptProgressQuery(query)).toThrow();
  });

  it('rejects malformed, unsupported, and noncanonical cursors', () => {
    const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const valid = { v: 1, lastActivityAt: lastExamAt.toISOString(), conceptId };
    for (const value of [
      `${encodeJson(valid)}=`, '+', 'a'.repeat(513), Buffer.from([0xff]).toString('base64url'),
      Buffer.from('{').toString('base64url'), encodeJson({ ...valid, v: 2 }),
      encodeJson({ ...valid, extra: true }), encodeJson({ ...valid, conceptId: 'invalid' }),
      encodeJson({ ...valid, lastActivityAt: '2026-09-29T11:00:00Z' }),
      Buffer.from(JSON.stringify({ conceptId, lastActivityAt: lastExamAt.toISOString(), v: 1 })).toString('base64url'),
    ]) expect(() => parseConceptProgressCursor(value)).toThrow();
  });

  it('derives exact channel and combined facts with whole-percent rounding', () => {
    expect(buildConceptProgressItem(row)).toEqual({
      conceptId,
      slug: row.slug,
      nameThai: row.nameThai,
      nameEnglish: row.nameEnglish,
      nameRussian: row.nameRussian,
      practice: { answered: 3, correct: 2, incorrect: 1, lastAnsweredAt: lastPracticeAt.toISOString() },
      exam: { answered: 2, correct: 1, incorrect: 1, lastAnsweredAt: lastExamAt.toISOString() },
      total: { answered: 5, correct: 3, incorrect: 2, accuracyPercent: 60 },
      lastActivityAt: lastExamAt.toISOString(),
    });
    expect(buildConceptProgressItem({
      ...row,
      practiceAnswered: 1,
      practiceCorrect: 1,
      examAnswered: 2,
      examCorrect: 0,
    }).total.accuracyPercent).toBe(33);
  });

  it('rejects database arithmetic, timestamp, identity, label, and numeric-safety violations', () => {
    for (const invalid of [
      { ...row, practiceCorrect: 4 },
      { ...row, practiceAnswered: 0, practiceCorrect: 0, lastPracticeAt },
      { ...row, examAnswered: 1, examCorrect: 1, lastExamAt: null },
      { ...row, lastActivityAt: lastPracticeAt },
      { ...row, practiceAnswered: Number.MAX_SAFE_INTEGER, practiceCorrect: Number.MAX_SAFE_INTEGER },
      { ...row, conceptId: conceptId.toUpperCase() },
      { ...row, slug: ' right-of-way' },
      { ...row, nameEnglish: ' ' },
      { ...row, extra: true },
    ]) expect(() => buildConceptProgressItem(invalid)).toThrow();
  });

  it('enforces strict privacy, arithmetic, ordering, uniqueness, and final-item cursor invariants', () => {
    const first = buildConceptProgressItem(row);
    const secondId = '00000000-0000-4000-8000-000000000001';
    const secondTime = new Date('2026-09-29T09:00:00.000Z');
    const second = buildConceptProgressItem({
      ...row,
      conceptId: secondId,
      practiceAnswered: 0,
      practiceCorrect: 0,
      lastPracticeAt: null,
      examAnswered: 1,
      examCorrect: 1,
      lastExamAt: secondTime,
      lastActivityAt: secondTime,
    });
    const cursor = encodeConceptProgressCursor({
      v: 1, lastActivityAt: second.lastActivityAt, conceptId: second.conceptId,
    });
    expect(conceptProgressResponseSchema.parse({ items: [first, second], nextCursor: cursor })).toEqual({
      items: [first, second], nextCursor: cursor,
    });
    for (const invalid of [
      { items: [first], nextCursor: null, userId: randomUUID() },
      { items: [{ ...first, total: { ...first.total, answered: 6 } }], nextCursor: null },
      { items: [{ ...first, lastActivityAt: lastPracticeAt.toISOString() }], nextCursor: null },
      { items: [second, first], nextCursor: null },
      { items: [first, first], nextCursor: null },
      { items: [], nextCursor: cursor },
      { items: [first, second], nextCursor: encodeConceptProgressCursor({
        v: 1, lastActivityAt: first.lastActivityAt, conceptId: first.conceptId,
      }) },
    ]) expect(() => conceptProgressResponseSchema.parse(invalid)).toThrow();
  });
});
