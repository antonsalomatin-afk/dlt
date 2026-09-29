import { TextDecoder } from 'node:util';
import { z } from 'zod';

const safeCountSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
const canonicalTimestampSchema = z.iso.datetime().refine(
  (value) => {
    try { return new Date(value).toISOString() === value; }
    catch { return false; }
  },
  { message: 'Timestamp must use canonical ISO form' },
);
const canonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase());
const trimmedNonblankSchema = z.string().min(1).refine(
  (value) => value === value.trim() && value.length > 0,
  { message: 'Text must be nonblank and trimmed' },
);
const encodedCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u);
const conceptProgressCursorSchema = z.strictObject({
  v: z.literal(1),
  lastActivityAt: canonicalTimestampSchema,
  conceptId: canonicalUuidSchema,
});
const rawConceptProgressQuerySchema = z.strictObject({
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/u).optional(),
  cursor: encodedCursorSchema.optional(),
});

const channelProgressSchema = z.strictObject({
  answered: safeCountSchema,
  correct: safeCountSchema,
  incorrect: safeCountSchema,
  lastAnsweredAt: canonicalTimestampSchema.nullable(),
}).superRefine((channel, context) => {
  const answered = channel.correct + channel.incorrect;
  if (!Number.isSafeInteger(answered) || channel.answered !== answered) {
    context.addIssue({ code: 'custom', message: 'Channel counts are inconsistent' });
  }
  if ((channel.answered === 0) !== (channel.lastAnsweredAt === null)) {
    context.addIssue({ code: 'custom', message: 'Channel timestamp is inconsistent' });
  }
});

const totalProgressSchema = z.strictObject({
  answered: safeCountSchema,
  correct: safeCountSchema,
  incorrect: safeCountSchema,
  accuracyPercent: z.number().int().min(0).max(100).nullable(),
});

export const conceptProgressItemSchema = z.strictObject({
  conceptId: canonicalUuidSchema,
  slug: trimmedNonblankSchema,
  nameThai: trimmedNonblankSchema,
  nameEnglish: trimmedNonblankSchema,
  nameRussian: trimmedNonblankSchema,
  practice: channelProgressSchema,
  exam: channelProgressSchema,
  total: totalProgressSchema,
  lastActivityAt: canonicalTimestampSchema,
}).superRefine((item, context) => {
  const answered = item.practice.answered + item.exam.answered;
  const correct = item.practice.correct + item.exam.correct;
  const incorrect = item.practice.incorrect + item.exam.incorrect;
  if (
    !Number.isSafeInteger(answered)
    || !Number.isSafeInteger(correct)
    || !Number.isSafeInteger(incorrect)
    || item.total.answered !== answered
    || item.total.correct !== correct
    || item.total.incorrect !== incorrect
  ) context.addIssue({ code: 'custom', path: ['total'], message: 'Total counts are inconsistent' });

  const expectedAccuracy = answered === 0 ? null : Math.round((correct / answered) * 100);
  if (item.total.accuracyPercent !== expectedAccuracy) {
    context.addIssue({ code: 'custom', path: ['total', 'accuracyPercent'], message: 'Total accuracy is inconsistent' });
  }
  const activity = [item.practice.lastAnsweredAt, item.exam.lastAnsweredAt]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  if (activity === undefined || item.lastActivityAt !== activity) {
    context.addIssue({ code: 'custom', path: ['lastActivityAt'], message: 'Latest activity is inconsistent' });
  }
});

export const conceptProgressResponseSchema = z.strictObject({
  items: z.array(conceptProgressItemSchema).max(50),
  nextCursor: encodedCursorSchema.nullable().superRefine((value, context) => {
    if (value === null) return;
    try { parseConceptProgressCursor(value); }
    catch { context.addIssue({ code: 'custom', message: 'Invalid next cursor' }); }
  }),
}).superRefine((response, context) => {
  if (response.items.some((item, index, items) => index > 0 && (
    item.lastActivityAt > items[index - 1]!.lastActivityAt
    || (item.lastActivityAt === items[index - 1]!.lastActivityAt && item.conceptId >= items[index - 1]!.conceptId)
  ))) context.addIssue({ code: 'custom', path: ['items'], message: 'Concept progress order is invalid' });
  if (new Set(response.items.map(({ conceptId }) => conceptId)).size !== response.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Concept IDs must be unique' });
  }
  if (response.nextCursor !== null) {
    const last = response.items.at(-1);
    if (last === undefined) {
      context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'Empty pages cannot have a cursor' });
    } else {
      try {
        const cursor = parseConceptProgressCursor(response.nextCursor);
        if (cursor.lastActivityAt !== last.lastActivityAt || cursor.conceptId !== last.conceptId) {
          context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'Cursor does not identify the final item' });
        }
      } catch {
        // The field-level refinement reports malformed cursors.
      }
    }
  }
});

const conceptProgressDatabaseRowSchema = z.strictObject({
  conceptId: canonicalUuidSchema,
  slug: trimmedNonblankSchema,
  nameThai: trimmedNonblankSchema,
  nameEnglish: trimmedNonblankSchema,
  nameRussian: trimmedNonblankSchema,
  practiceAnswered: safeCountSchema,
  practiceCorrect: safeCountSchema,
  examAnswered: safeCountSchema,
  examCorrect: safeCountSchema,
  lastPracticeAt: z.date().nullable(),
  lastExamAt: z.date().nullable(),
  lastActivityAt: z.date(),
});

export type ConceptProgressCursor = z.infer<typeof conceptProgressCursorSchema>;

export function encodeConceptProgressCursor(cursor: ConceptProgressCursor): string {
  const parsed = conceptProgressCursorSchema.parse(cursor);
  const json = JSON.stringify({ v: parsed.v, lastActivityAt: parsed.lastActivityAt, conceptId: parsed.conceptId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function parseConceptProgressCursor(value: unknown): ConceptProgressCursor {
  const encoded = encodedCursorSchema.parse(value);
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url')); }
  catch { throw new Error('Invalid concept progress cursor'); }
  let json: unknown;
  try { json = JSON.parse(decoded); }
  catch { throw new Error('Invalid concept progress cursor'); }
  const cursor = conceptProgressCursorSchema.parse(json);
  if (encodeConceptProgressCursor(cursor) !== encoded) throw new Error('Invalid concept progress cursor');
  return cursor;
}

export function parseConceptProgressQuery(value: unknown): { limit: number; cursor: ConceptProgressCursor | null } {
  const query = rawConceptProgressQuerySchema.parse(value);
  return {
    limit: query.limit === undefined ? 20 : Number(query.limit),
    cursor: query.cursor === undefined ? null : parseConceptProgressCursor(query.cursor),
  };
}

export function buildConceptProgressItem(value: unknown) {
  const row = conceptProgressDatabaseRowSchema.parse(value);
  const practiceIncorrect = row.practiceAnswered - row.practiceCorrect;
  const examIncorrect = row.examAnswered - row.examCorrect;
  const answered = row.practiceAnswered + row.examAnswered;
  const correct = row.practiceCorrect + row.examCorrect;
  const incorrect = practiceIncorrect + examIncorrect;
  return conceptProgressItemSchema.parse({
    conceptId: row.conceptId,
    slug: row.slug,
    nameThai: row.nameThai,
    nameEnglish: row.nameEnglish,
    nameRussian: row.nameRussian,
    practice: {
      answered: row.practiceAnswered,
      correct: row.practiceCorrect,
      incorrect: practiceIncorrect,
      lastAnsweredAt: row.lastPracticeAt?.toISOString() ?? null,
    },
    exam: {
      answered: row.examAnswered,
      correct: row.examCorrect,
      incorrect: examIncorrect,
      lastAnsweredAt: row.lastExamAt?.toISOString() ?? null,
    },
    total: {
      answered,
      correct,
      incorrect,
      accuracyPercent: answered === 0 ? null : Math.round((correct / answered) * 100),
    },
    lastActivityAt: row.lastActivityAt.toISOString(),
  });
}
