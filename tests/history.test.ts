import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  encodeHistoryCursor,
  historyResponseSchema,
  mistakesResponseSchema,
  parseHistoryCursor,
  parseHistoryQuery,
} from '../packages/database/src/history.ts';

const attemptId = randomUUID();
const submittedAt = '2026-09-15T07:30:00.123Z';
const cursor = { v: 1 as const, submittedAt, attemptId };

it('round-trips the canonical bounded history cursor', () => {
  const encoded = encodeHistoryCursor(cursor);
  expect(encoded).toBe(Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'));
  expect(encoded).not.toContain('=');
  expect(parseHistoryCursor(encoded)).toEqual(cursor);
  expect(parseHistoryQuery({ cursor: encoded })).toEqual({ limit: 20, cursor });
});

it('accepts only strict history query keys and decimal limits from 1 through 50', () => {
  expect(parseHistoryQuery({})).toEqual({ limit: 20, cursor: null });
  expect(parseHistoryQuery({ limit: '1' })).toEqual({ limit: 1, cursor: null });
  expect(parseHistoryQuery({ limit: '50' })).toEqual({ limit: 50, cursor: null });
  for (const query of [
    { limit: '' }, { limit: '0' }, { limit: '01' }, { limit: '+1' }, { limit: '-1' },
    { limit: '1.0' }, { limit: ' 1' }, { limit: '51' }, { limit: ['1', '2'] },
    { cursor: '' }, { cursor: ['one', 'two'] }, { extra: '1' },
  ]) expect(() => parseHistoryQuery(query)).toThrow();
});

it('rejects malformed, unsupported, and noncanonical cursors', () => {
  const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const valid = encodeHistoryCursor(cursor);
  for (const value of [
    `${valid}=`, '+', 'a'.repeat(513), Buffer.from([0xff]).toString('base64url'),
    Buffer.from('{', 'utf8').toString('base64url'),
    encodeJson({ ...cursor, v: 2 }),
    encodeJson({ ...cursor, extra: true }),
    encodeJson({ ...cursor, attemptId: 'invalid' }),
    encodeJson({ ...cursor, submittedAt: '2026-09-15T07:30:00Z' }),
    Buffer.from(JSON.stringify({ attemptId, submittedAt, v: 1 }), 'utf8').toString('base64url'),
    Buffer.from(`{ "v":1,"submittedAt":"${submittedAt}","attemptId":"${attemptId}" }`, 'utf8').toString('base64url'),
  ]) expect(() => parseHistoryCursor(value)).toThrow();
});

it('enforces the strict history response envelope and result integrity', () => {
  const choices = (['A', 'B', 'C', 'D'] as const).map((key) => ({
    id: randomUUID(), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
  }));
  const item = {
    presentationId: randomUUID(), submittedAt, selectedChoiceId: choices[0]?.id,
    correctChoiceId: choices[0]?.id, isCorrect: true,
    question: {
      id: randomUUID(), textThai: null, textExamEnglish: null,
      textEnglish: 'Question', textRussian: null, choices,
    },
    explanationThai: null, explanationEnglish: 'Explanation', explanationRussian: null,
    trapExplanationThai: null, trapExplanationEnglish: 'Trap', trapExplanationRussian: null,
  };
  const response = { items: [item], nextCursor: null };
  expect(historyResponseSchema.parse(response)).toEqual(response);
  for (const invalid of [
    { ...response, extra: true },
    { ...response, items: [{ ...item, extra: true }] },
    { ...response, items: [{ ...item, selectedChoiceId: randomUUID() }] },
    { ...response, items: [{ ...item, correctChoiceId: randomUUID() }] },
    { ...response, items: [{ ...item, isCorrect: false }] },
    { ...response, items: Array.from({ length: 51 }, () => item) },
    { ...response, nextCursor: `${encodeHistoryCursor(cursor)}=` },
    { ...response, nextCursor: Buffer.from('{}', 'utf8').toString('base64url') },
  ]) expect(() => historyResponseSchema.parse(invalid)).toThrow();
});

it('reuses the history query, cursor, and envelope while enforcing the mistakes invariant', () => {
  const choices = (['A', 'B', 'C', 'D'] as const).map((key) => ({
    id: randomUUID(), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
  }));
  const nextCursor = encodeHistoryCursor(cursor);
  expect(parseHistoryQuery({ limit: '1', cursor: nextCursor })).toEqual({ limit: 1, cursor });
  const item = {
    presentationId: randomUUID(), submittedAt, selectedChoiceId: choices[1]?.id,
    correctChoiceId: choices[0]?.id, isCorrect: false,
    question: {
      id: randomUUID(), textThai: null, textExamEnglish: null,
      textEnglish: 'Question', textRussian: null, choices,
    },
    explanationThai: null, explanationEnglish: 'Explanation', explanationRussian: null,
    trapExplanationThai: null, trapExplanationEnglish: 'Trap', trapExplanationRussian: null,
  };
  const response = { items: [item], nextCursor };
  expect(mistakesResponseSchema.parse(response)).toEqual(response);
  expect(() => mistakesResponseSchema.parse({
    ...response,
    items: [{ ...item, selectedChoiceId: item.correctChoiceId, isCorrect: true }],
  })).toThrow();
});
