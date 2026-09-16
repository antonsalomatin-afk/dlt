import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  encodeFavoriteCursor,
  favoriteFeedResponseSchema,
  parseFavoriteCursor,
  parseFavoriteFeedQuery,
} from '../packages/database/src/favorite-feed.ts';

const favoriteId = randomUUID();
const updatedAt = '2026-09-16T07:30:00.123Z';
const cursor = { v: 1 as const, updatedAt, favoriteId };

it('round-trips the canonical bounded favorite cursor', () => {
  const encoded = encodeFavoriteCursor(cursor);
  expect(encoded).toBe(Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'));
  expect(encoded).not.toContain('=');
  expect(parseFavoriteCursor(encoded)).toEqual(cursor);
  expect(parseFavoriteFeedQuery({ cursor: encoded })).toEqual({ limit: 20, cursor });
});

it('accepts only strict favorite query keys and canonical decimal limits from 1 through 50', () => {
  expect(parseFavoriteFeedQuery({})).toEqual({ limit: 20, cursor: null });
  expect(parseFavoriteFeedQuery({ limit: '1' })).toEqual({ limit: 1, cursor: null });
  expect(parseFavoriteFeedQuery({ limit: '50' })).toEqual({ limit: 50, cursor: null });
  for (const query of [
    { limit: '' }, { limit: '0' }, { limit: '01' }, { limit: '+1' }, { limit: '-1' },
    { limit: '1.0' }, { limit: ' 1' }, { limit: '51' }, { limit: ['1', '2'] },
    { cursor: '' }, { cursor: ['one', 'two'] }, { extra: '1' },
  ]) expect(() => parseFavoriteFeedQuery(query)).toThrow();
});

it('rejects malformed, unsupported, and noncanonical favorite cursors', () => {
  const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const valid = encodeFavoriteCursor(cursor);
  for (const value of [
    `${valid}=`, '+', 'a'.repeat(513), Buffer.from([0xff]).toString('base64url'),
    Buffer.from('{', 'utf8').toString('base64url'),
    encodeJson({ ...cursor, v: 2 }),
    encodeJson({ ...cursor, extra: true }),
    encodeJson({ ...cursor, favoriteId: 'invalid' }),
    encodeJson({ ...cursor, updatedAt: '2026-09-16T07:30:00Z' }),
    Buffer.from(JSON.stringify({ favoriteId, updatedAt, v: 1 }), 'utf8').toString('base64url'),
    Buffer.from(`{ "v":1,"updatedAt":"${updatedAt}","favoriteId":"${favoriteId}" }`, 'utf8').toString('base64url'),
  ]) expect(() => parseFavoriteCursor(value)).toThrow();
});

it('enforces the strict safe favorite feed response boundary', () => {
  const choices = (['A', 'B', 'C', 'D'] as const).map((key) => ({
    id: randomUUID(), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
  }));
  const item = {
    presentationId: randomUUID(),
    favoritedAt: updatedAt,
    question: {
      id: randomUUID(), textThai: null, textExamEnglish: null,
      textEnglish: 'Question', textRussian: null, choices,
    },
  };
  const response = { items: [item], nextCursor: encodeFavoriteCursor(cursor) };
  expect(favoriteFeedResponseSchema.parse(response)).toEqual(response);
  for (const invalid of [
    { ...response, extra: true },
    { ...response, items: [{ ...item, favoriteId }] },
    { ...response, items: [{ ...item, favoritedAt: '2026-09-16T07:30:00Z' }] },
    { ...response, items: [{ ...item, question: { ...item.question, correctChoiceId: choices[0]?.id } }] },
    { ...response, items: Array.from({ length: 51 }, () => item) },
    { ...response, nextCursor: `${encodeFavoriteCursor(cursor)}=` },
    { ...response, nextCursor: Buffer.from('{}', 'utf8').toString('base64url') },
  ]) expect(() => favoriteFeedResponseSchema.parse(invalid)).toThrow();
});
