import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { presentedQuestionSchema } from './presentation.ts';

const canonicalTimestampSchema = z.iso.datetime().refine(
  (value) => {
    try { return new Date(value).toISOString() === value; }
    catch { return false; }
  },
  { message: 'Timestamp must use canonical ISO form' },
);
const favoriteCursorSchema = z.strictObject({
  v: z.literal(1),
  updatedAt: canonicalTimestampSchema,
  favoriteId: z.uuid(),
});
const encodedCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u);
const rawFavoriteFeedQuerySchema = z.strictObject({
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/u).optional(),
  cursor: encodedCursorSchema.optional(),
});

export type FavoriteCursor = z.infer<typeof favoriteCursorSchema>;

export const favoriteFeedItemSchema = z.strictObject({
  presentationId: z.uuid(),
  favoritedAt: canonicalTimestampSchema,
  question: presentedQuestionSchema,
});

export const favoriteFeedResponseSchema = z.strictObject({
  items: z.array(favoriteFeedItemSchema).max(50),
  nextCursor: encodedCursorSchema.nullable().superRefine((value, context) => {
    if (value === null) return;
    try { parseFavoriteCursor(value); }
    catch { context.addIssue({ code: 'custom', message: 'Invalid next cursor' }); }
  }),
});

export function encodeFavoriteCursor(cursor: FavoriteCursor): string {
  const parsed = favoriteCursorSchema.parse(cursor);
  const json = JSON.stringify({ v: parsed.v, updatedAt: parsed.updatedAt, favoriteId: parsed.favoriteId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function parseFavoriteCursor(value: unknown): FavoriteCursor {
  const encoded = encodedCursorSchema.parse(value);
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'));
  } catch {
    throw new Error('Invalid favorite cursor');
  }
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid favorite cursor');
  }
  const cursor = favoriteCursorSchema.parse(json);
  if (encodeFavoriteCursor(cursor) !== encoded) throw new Error('Invalid favorite cursor');
  return cursor;
}

export function parseFavoriteFeedQuery(value: unknown): { limit: number; cursor: FavoriteCursor | null } {
  const query = rawFavoriteFeedQuerySchema.parse(value);
  return {
    limit: query.limit === undefined ? 20 : Number(query.limit),
    cursor: query.cursor === undefined ? null : parseFavoriteCursor(query.cursor),
  };
}
