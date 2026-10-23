import { createHash, randomBytes, randomInt } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../../../packages/database/src/index.ts';
import { parsePresentationSnapshot, practiceNextRequestSchema, presentationResponseSchema, retryMistakeRequestSchema, selectRetryCandidateSet, selectPracticeQuestion, snapshotQuestion } from '../../../packages/database/src/presentation.ts';
import {
  dailyPracticeQuerySchema,
  dailyPracticeRequestSchema,
  assignDailyPresentation,
  getOwnedDailyPresentation,
  ownedDailyPresentationRequestSchema,
} from '../../../packages/database/src/daily-practice.ts';
import { answerRequestSchema, isDuplicateAnswer, submitPracticeAnswer } from '../../../packages/database/src/answer.ts';
import { encodeHistoryCursor, historyResponseSchema, mistakesResponseSchema, parseHistoryQuery } from '../../../packages/database/src/history.ts';
import { practiceCategoriesResponseSchema } from '../../../packages/database/src/practice-categories.ts';
import { favoriteRequestSchema, favoriteResponseSchema } from '../../../packages/database/src/favorite.ts';
import {
  examQuestionReportRequestSchema,
  examQuestionReportResponseSchema,
  isDuplicateExamQuestionReport,
  isDuplicateQuestionReport,
  questionReportRequestSchema,
  questionReportResponseSchema,
} from '../../../packages/database/src/report.ts';
import { encodeFavoriteCursor, favoriteFeedResponseSchema, parseFavoriteFeedQuery } from '../../../packages/database/src/favorite-feed.ts';
import { buildProgressSummary } from '../../../packages/database/src/progress.ts';
import {
  buildConceptProgressItem,
  conceptProgressResponseSchema,
  encodeConceptProgressCursor,
  parseConceptProgressQuery,
} from '../../../packages/database/src/concept-progress.ts';
import {
  encodeExamHistoryCursor,
  examHistoryResponseSchema,
  parseExamHistoryQuery,
} from '../../../packages/database/src/exam-history.ts';
import {
  EXAM_DURATION_MS,
  EXAM_ELIGIBLE_LIMIT,
  EXAM_PASSING_SCORE,
  EXAM_QUESTION_COUNT,
  currentExamResponseSchema,
  examAnswerRequestSchema,
  examAnswerResponseSchema,
  examCompleteRequestSchema,
  examCompleteResponseSchema,
  examReviewParamsSchema,
  examReviewResponseSchema,
  retryExamStart,
  examStartRequestSchema,
  examStartResponseSchema,
  sampleExamQuestionIds,
  summarizeExamOutcomes,
  type ExamRandomOffset,
} from '../../../packages/database/src/exam.ts';
import { InvalidInitDataError, validateInitData } from '../../../packages/telegram/src/index.ts';
import { reminderPreferenceRequestSchema, reminderPreferenceResponseSchema } from '../../../packages/database/src/reminder.ts';
import { languagePreferenceRequestSchema, languagePreferenceResponseSchema } from '../../../packages/database/src/language.ts';

export const userSchema = z.strictObject({
  id: z.uuid(), username: z.string().nullable(), firstName: z.string().nullable(),
  selectedVehicleType: z.enum(['CAR', 'MOTORCYCLE']).nullable(),
});
export const loginSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), expiresAt: z.iso.datetime(), user: userSchema });
const bodySchema = z.strictObject({ initData: z.string().min(1).max(16384).refine((value) => Buffer.byteLength(value, 'utf8') <= 16384) });
const bearerSchema = z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/u);
const vehicleSchema = z.strictObject({ vehicleType: z.enum(['CAR', 'MOTORCYCLE']) });
const emptyQuerySchema = z.strictObject({});
const errorSchema = z.strictObject({ error: z.enum(['Unauthorized', 'Bad Request', 'Internal Server Error', 'Vehicle selection required', 'No questions available', 'Presentation not found', 'Mistake not found', 'Mistake has no concept', 'Exam question not found', 'Exam not found', 'Answer already submitted', 'Report already submitted', 'Not enough questions available', 'Exam already in progress', 'Exam already completed', 'Exam incomplete', 'Exam not completed', 'Exam expired']) });
const userSelect = { id: true, username: true, firstName: true, selectedVehicleType: true } as const;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const lifetimeMs = 24 * 60 * 60 * 1000;

class BadRequestJsonError extends Error {
  readonly statusCode = 400;
}

function parseJsonWithUniqueTopLevelMembers(raw: string): unknown {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new BadRequestJsonError(); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  const keys = new Set<string>();
  let depth = 0;
  let expectingKey = false;
  let inString = false;
  let escaped = false;
  let keyStart = -1;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        inString = false;
        if (keyStart >= 0) {
          const key: unknown = JSON.parse(raw.slice(keyStart, index + 1));
          if (typeof key !== 'string' || keys.has(key)) throw new BadRequestJsonError();
          keys.add(key);
          keyStart = -1;
          expectingKey = false;
        }
      }
    } else if (character === '"') {
      inString = true;
      if (depth === 1 && expectingKey) keyStart = index;
    } else if (character === '{' || character === '[') {
      depth++;
      if (depth === 1 && character === '{') expectingKey = true;
    } else if (character === '}' || character === ']') {
      depth--;
    } else if (character === ',' && depth === 1) {
      expectingKey = true;
    }
  }
  return value;
}

function mapHistoryAttempt(attempt: {
  id: string;
  selectedChoiceId: string;
  isCorrect: boolean;
  submittedAt: Date;
  presentation: { id: string; snapshot: unknown };
}) {
  const snapshot = parsePresentationSnapshot(attempt.presentation.snapshot);
  if (!snapshot.question.choices.some((choice) => choice.id === attempt.selectedChoiceId)) {
    throw new Error('Stored answer choice is absent from presentation snapshot');
  }
  if (attempt.isCorrect !== (attempt.selectedChoiceId === snapshot.correctChoiceId)) {
    throw new Error('Stored answer result is inconsistent with presentation snapshot');
  }
  return {
    cursor: { v: 1 as const, submittedAt: attempt.submittedAt.toISOString(), attemptId: attempt.id },
    item: {
      presentationId: attempt.presentation.id,
      submittedAt: attempt.submittedAt.toISOString(),
      selectedChoiceId: attempt.selectedChoiceId,
      correctChoiceId: snapshot.correctChoiceId,
      isCorrect: attempt.isCorrect,
      question: snapshot.question,
      explanationThai: snapshot.explanationThai,
      explanationEnglish: snapshot.explanationEnglish,
      explanationRussian: snapshot.explanationRussian,
      trapExplanationThai: snapshot.trapExplanationThai,
      trapExplanationEnglish: snapshot.trapExplanationEnglish,
      trapExplanationRussian: snapshot.trapExplanationRussian,
    },
  };
}

function mapFavorite(row: {
  id: string;
  userId: string;
  questionId: string;
  updatedAt: Date;
  presentation: null | { id: string; userId: string; questionId: string; snapshot: unknown };
}) {
  if (
    row.presentation === null
    || row.presentation.userId !== row.userId
    || row.presentation.questionId !== row.questionId
  ) throw new Error('Stored favorite presentation relationship is inconsistent');
  const snapshot = parsePresentationSnapshot(row.presentation.snapshot);
  if (snapshot.question.id !== row.questionId || snapshot.question.id !== row.presentation.questionId) {
    throw new Error('Stored favorite snapshot question is inconsistent');
  }
  const favoritedAt = row.updatedAt.toISOString();
  return {
    cursor: { v: 1 as const, updatedAt: favoritedAt, favoriteId: row.id },
    item: { presentationId: row.presentation.id, favoritedAt, question: snapshot.question },
  };
}

function mapExamHistorySession(exam: {
  id: string;
  vehicleType: 'CAR' | 'MOTORCYCLE';
  questionCount: number;
  passingScore: number;
  startedAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  score: number | null;
  passed: boolean | null;
  questions: Array<{
    id: string;
    position: number;
    questionId: string;
    snapshot: unknown;
    selectedChoiceId: string | null;
    isCorrect: boolean | null;
    answeredAt: Date | null;
  }>;
}) {
  if (
    exam.questionCount !== EXAM_QUESTION_COUNT
    || exam.passingScore !== EXAM_PASSING_SCORE
    || exam.expiresAt.getTime() - exam.startedAt.getTime() !== EXAM_DURATION_MS
    || exam.questions.length !== EXAM_QUESTION_COUNT
    || exam.questions.some((question, index) => question.position !== index + 1)
    || new Set(exam.questions.map(({ id }) => id)).size !== EXAM_QUESTION_COUNT
    || new Set(exam.questions.map(({ questionId }) => questionId)).size !== EXAM_QUESTION_COUNT
  ) throw new Error('Stored exam session configuration is inconsistent');
  if (exam.completedAt === null || exam.score === null || exam.passed === null) {
    throw new Error('Stored exam completion tuple is incomplete');
  }
  const completedAt = exam.completedAt;

  const outcomes = exam.questions.map((question) => {
    const snapshot = parsePresentationSnapshot(question.snapshot);
    if (snapshot.question.id !== question.questionId) throw new Error('Stored exam snapshot is inconsistent');
    const tuple = [question.selectedChoiceId, question.isCorrect, question.answeredAt];
    const nullCount = tuple.filter((value) => value === null).length;
    if (nullCount === tuple.length) return null;
    if (nullCount !== 0) throw new Error('Stored exam answer tuple is incomplete');
    const selectedChoiceId = question.selectedChoiceId;
    const isCorrect = question.isCorrect;
    const answeredAt = question.answeredAt;
    if (
      selectedChoiceId === null
      || isCorrect === null
      || answeredAt === null
      || !snapshot.question.choices.some(({ id }) => id === selectedChoiceId)
      || isCorrect !== (selectedChoiceId === snapshot.correctChoiceId)
      || answeredAt.getTime() < exam.startedAt.getTime()
      || answeredAt.getTime() >= exam.expiresAt.getTime()
      || answeredAt.getTime() > completedAt.getTime()
    ) throw new Error('Stored exam answer is inconsistent');
    return isCorrect;
  });
  const summary = summarizeExamOutcomes(outcomes);
  if (
    exam.score !== summary.score
    || exam.passed !== summary.passed
    || (summary.unansweredCount > 0 && completedAt.getTime() < exam.expiresAt.getTime())
  ) throw new Error('Stored exam completion result is inconsistent');

  const startedAt = exam.startedAt.toISOString();
  return {
    cursor: { v: 1 as const, startedAt, examId: exam.id },
    item: {
      examId: exam.id,
      vehicleType: exam.vehicleType,
      questionCount: exam.questionCount,
      answeredCount: summary.answeredCount,
      unansweredCount: summary.unansweredCount,
      score: exam.score,
      passingScore: exam.passingScore,
      passed: exam.passed,
      startedAt,
      completedAt: completedAt.toISOString(),
    },
  };
}

type RandomOffset = (eligibleCount: number) => unknown;

/** Caller owns the database connection. Credentials are never logged. */
export function createApi(options: {
  database: PrismaClient;
  botToken: string;
  now?: () => Date;
  randomOffset?: RandomOffset;
  examRandomOffset?: ExamRandomOffset;
}) {
  if (!options.botToken.trim()) throw new Error('BOT_TOKEN is required');
  const app = Fastify({ logger: false, bodyLimit: 100000 });
  const now = options.now ?? (() => new Date());
  const randomOffset = options.randomOffset ?? ((eligibleCount: number) => randomInt(eligibleCount));
  const examRandomOffset = options.examRandomOffset ?? ((remainingCount: number) => randomInt(remainingCount));
  app.addHook('onRequest', async (request, reply) => {
    if (['/me/reminders', '/me/language', '/me/history', '/me/mistakes', '/me/favorites', '/me/progress', '/me/concept-progress', '/practice/categories', '/practice/next', '/practice/daily', '/practice/presentation', '/practice/retry-mistake', '/practice/answer', '/practice/favorite', '/practice/report', '/exam/start', '/exam/answer', '/exam/complete', '/exam/report', '/exam/history', '/exam/current', '/exam/:examId/review'].includes(request.routeOptions.url ?? '')) reply.header('Cache-Control', 'no-store');
  });
  async function authenticatedUser(header: unknown, referenceTime = now()) {
    const authorization = bearerSchema.safeParse(header);
    if (!authorization.success) return null;
    const session = await options.database.session.findUnique({ where: { tokenHash: digest(authorization.data.slice(7)) }, select: { expiresAt: true, user: { select: userSelect } } });
    if (!session || referenceTime.getTime() >= session.expiresAt.getTime()) return null;
    return userSchema.parse(session.user);
  }
  app.setErrorHandler((error, _request, reply) => {
    const badRequest = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500;
    return reply.code(badRequest ? 400 : 500).send(errorSchema.parse({ error: badRequest ? 'Bad Request' : 'Internal Server Error' }));
  });
  app.post('/auth/telegram', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const body = bodySchema.safeParse(request.body);
    if (!body.success) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    const issuedAt = now();
    let identity;
    try { identity = validateInitData(body.data.initData, options.botToken, { now: () => Math.floor(issuedAt.getTime() / 1000) }); }
    catch (error) {
      if (error instanceof InvalidInitDataError) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
      throw error;
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(issuedAt.getTime() + lifetimeMs);
    const profile = { username: identity.username ?? null, firstName: identity.first_name, lastSeenAt: issuedAt };
    const telegramUserId = BigInt(identity.id);
    const result = await options.database.$transaction(async (tx) => {
      // A database-native upsert handles simultaneous first logins for the unique identity.
      const user = await tx.user.upsert({ where: { telegramUserId }, create: { telegramUserId, ...profile }, update: profile, select: userSelect });
      await tx.session.create({ data: { userId: user.id, tokenHash: digest(token), createdAt: issuedAt, expiresAt } });
      return loginSchema.parse({ token, expiresAt: expiresAt.toISOString(), user });
    });
    return result;
  });
  app.get('/me', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    return user;
  });
  app.patch('/me/vehicle', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    const body = vehicleSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
    return options.database.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: user.id }, data: { selectedVehicleType: body.data.vehicleType }, select: userSelect });
      return userSchema.parse(updated);
    });
  });
  app.register((remindersApp, _pluginOptions, done) => {
    const authenticatedUsers = new WeakMap<object, z.infer<typeof userSchema>>();
    remindersApp.removeContentTypeParser('application/json');
    remindersApp.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, parseDone) => {
      if (typeof body !== 'string') {
        parseDone(new BadRequestJsonError(), undefined);
        return;
      }
      try { parseDone(null, parseJsonWithUniqueTopLevelMembers(body)); }
      catch (error) { parseDone(error instanceof BadRequestJsonError ? error : new BadRequestJsonError(), undefined); }
    });
    remindersApp.addHook('onRequest', async (request, reply) => {
      const user = await authenticatedUser(request.headers.authorization);
      if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
      authenticatedUsers.set(request, user);
      if (request.method === 'PATCH') {
        const contentType = request.headers['content-type'];
        if (contentType !== undefined && contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
          return reply.code(415).send(errorSchema.parse({ error: 'Bad Request' }));
        }
      }
    });
    remindersApp.get('/me/reminders', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated reminder user missing');
      const contentLength = request.headers['content-length'];
      if (
        request.body !== undefined
        || (contentLength !== undefined && contentLength !== '0')
        || request.headers['transfer-encoding'] !== undefined
        || !emptyQuerySchema.safeParse(request.query).success
      ) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const preference = await options.database.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { dailyQuestionReminderEnabled: true },
      });
      return reminderPreferenceResponseSchema.parse(preference);
    });
    remindersApp.patch('/me/reminders', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated reminder user missing');
      if (!emptyQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const body = reminderPreferenceRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      const preference = await options.database.user.update({
        where: { id: user.id },
        data: { dailyQuestionReminderEnabled: body.data.dailyQuestionReminderEnabled },
        select: { dailyQuestionReminderEnabled: true },
      });
      return reminderPreferenceResponseSchema.parse(preference);
    });
    remindersApp.get('/me/language', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated language user missing');
      const contentLength = request.headers['content-length'];
      if (
        request.body !== undefined
        || (contentLength !== undefined && contentLength !== '0')
        || request.headers['transfer-encoding'] !== undefined
        || !emptyQuerySchema.safeParse(request.query).success
      ) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const preference = await options.database.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { preferredLanguage: true },
      });
      return languagePreferenceResponseSchema.parse(preference);
    });
    remindersApp.patch('/me/language', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated language user missing');
      if (!emptyQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const body = languagePreferenceRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      const preference = await options.database.user.update({
        where: { id: user.id },
        data: { preferredLanguage: body.data.preferredLanguage },
        select: { preferredLanguage: true },
      });
      return languagePreferenceResponseSchema.parse(preference);
    });
    done();
  });
  app.get('/me/history', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    let query;
    try { query = parseHistoryQuery(request.query); }
    catch { return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' })); }
    const after = query.cursor === null ? {} : {
      OR: [
        { submittedAt: { lt: new Date(query.cursor.submittedAt) } },
        { submittedAt: new Date(query.cursor.submittedAt), id: { lt: query.cursor.attemptId } },
      ],
    };
    const attempts = await options.database.answerAttempt.findMany({
      where: { presentation: { userId: user.id }, ...after },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true, selectedChoiceId: true, isCorrect: true, submittedAt: true,
        presentation: { select: { id: true, snapshot: true } },
      },
    });
    const validated = attempts.map(mapHistoryAttempt);
    const page = validated.slice(0, query.limit);
    const last = page.at(-1);
    return historyResponseSchema.parse({
      items: page.map(({ item }) => item),
      nextCursor: validated.length > query.limit && last ? encodeHistoryCursor(last.cursor) : null,
    });
  });
  app.get('/me/mistakes', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    let query;
    try { query = parseHistoryQuery(request.query); }
    catch { return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' })); }
    const after = query.cursor === null ? {} : {
      OR: [
        { submittedAt: { lt: new Date(query.cursor.submittedAt) } },
        { submittedAt: new Date(query.cursor.submittedAt), id: { lt: query.cursor.attemptId } },
      ],
    };
    const attempts = await options.database.answerAttempt.findMany({
      where: { isCorrect: false, presentation: { userId: user.id }, ...after },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true, selectedChoiceId: true, isCorrect: true, submittedAt: true,
        presentation: { select: { id: true, snapshot: true } },
      },
    });
    const validated = attempts.map(mapHistoryAttempt);
    const page = validated.slice(0, query.limit);
    const last = page.at(-1);
    return mistakesResponseSchema.parse({
      items: page.map(({ item }) => item),
      nextCursor: validated.length > query.limit && last ? encodeHistoryCursor(last.cursor) : null,
    });
  });
  app.get('/me/favorites', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    let query;
    try { query = parseFavoriteFeedQuery(request.query); }
    catch { return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' })); }
    const after = query.cursor === null ? {} : {
      OR: [
        { updatedAt: { lt: new Date(query.cursor.updatedAt) } },
        { updatedAt: new Date(query.cursor.updatedAt), id: { lt: query.cursor.favoriteId } },
      ],
    };
    const favorites = await options.database.favorite.findMany({
      where: { userId: user.id, ...after },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true, userId: true, questionId: true, updatedAt: true,
        presentation: { select: { id: true, userId: true, questionId: true, snapshot: true } },
      },
    });
    const validated = favorites.map(mapFavorite);
    const page = validated.slice(0, query.limit);
    const last = page.at(-1);
    return favoriteFeedResponseSchema.parse({
      items: page.map(({ item }) => item),
      nextCursor: validated.length > query.limit && last ? encodeFavoriteCursor(last.cursor) : null,
    });
  });
  app.get('/me/progress', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    if (!emptyQuerySchema.safeParse(request.query).success) {
      return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
    }
    const aggregates = await options.database.answerAttempt.groupBy({
      by: ['isCorrect'],
      where: { presentation: { userId: user.id } },
      _count: { _all: true },
    });
    return buildProgressSummary(aggregates);
  });
  app.get('/me/concept-progress', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    let query;
    try { query = parseConceptProgressQuery(request.query); }
    catch { return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' })); }
    const cursorPredicate = query.cursor === null ? Prisma.empty : Prisma.sql`
      AND (
        GREATEST(state."lastPracticeAt", state."lastExamAt") < ${new Date(query.cursor.lastActivityAt)}
        OR (
          GREATEST(state."lastPracticeAt", state."lastExamAt") = ${new Date(query.cursor.lastActivityAt)}
          AND state."conceptId" < ${query.cursor.conceptId}::uuid
        )
      )
    `;
    const rows: unknown = await options.database.$queryRaw(Prisma.sql`
      SELECT
        state."conceptId",
        concept.slug,
        concept."nameThai",
        concept."nameEnglish",
        concept."nameRussian",
        state."practiceAnswered",
        state."practiceCorrect",
        state."examAnswered",
        state."examCorrect",
        state."lastPracticeAt",
        state."lastExamAt",
        GREATEST(state."lastPracticeAt", state."lastExamAt") AS "lastActivityAt"
      FROM "ConceptLearningState" AS state
      INNER JOIN "Concept" AS concept ON concept.id = state."conceptId"
      WHERE state."userId" = ${user.id}::uuid
      ${cursorPredicate}
      ORDER BY "lastActivityAt" DESC, state."conceptId" DESC
      LIMIT ${query.limit + 1}
    `);
    if (!Array.isArray(rows)) throw new Error('Concept progress query result is invalid');
    const validated = rows.map(buildConceptProgressItem);
    const page = validated.slice(0, query.limit);
    const last = page.at(-1);
    return conceptProgressResponseSchema.parse({
      items: page,
      nextCursor: validated.length > query.limit && last ? encodeConceptProgressCursor({
        v: 1, lastActivityAt: last.lastActivityAt, conceptId: last.conceptId,
      }) : null,
    });
  });
  app.get('/practice/categories', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    if (!emptyQuerySchema.safeParse(request.query).success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
    if (!user.selectedVehicleType) return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
    const eligibleQuestion = {
      vehicleType: user.selectedVehicleType,
      active: true,
      verificationStatus: 'VERIFIED',
    } as const;
    const categories = await options.database.category.findMany({
      where: { questions: { some: eligibleQuestion } },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      take: 101,
      select: {
        id: true,
        slug: true,
        nameThai: true,
        nameEnglish: true,
        nameRussian: true,
        _count: { select: { questions: { where: eligibleQuestion } } },
      },
    });
    if (categories.length > 100) throw new Error('Eligible practice category limit exceeded');
    return practiceCategoriesResponseSchema.parse({
      categories: categories.map(({ _count, ...category }) => ({
        ...category,
        questionCount: _count.questions,
      })),
    });
  });
  app.register((practiceApp, _pluginOptions, done) => {
    const authenticatedUsers = new WeakMap<object, z.infer<typeof userSchema>>();
    const requestInstants = new WeakMap<object, Date>();
    practiceApp.removeContentTypeParser('application/json');
    practiceApp.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, parseDone) => {
      if (typeof body !== 'string') {
        parseDone(new BadRequestJsonError(), undefined);
        return;
      }
      try { parseDone(null, parseJsonWithUniqueTopLevelMembers(body)); }
      catch (error) { parseDone(error instanceof BadRequestJsonError ? error : new BadRequestJsonError(), undefined); }
    });
    practiceApp.addHook('onRequest', async (request, reply) => {
      const requestInstant = now();
      const user = await authenticatedUser(request.headers.authorization, requestInstant);
      if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
      authenticatedUsers.set(request, user);
      requestInstants.set(request, requestInstant);
    });
    practiceApp.post('/practice/next', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated practice user missing');
      const body = practiceNextRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      if (!user.selectedVehicleType) return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
      const vehicleType = user.selectedVehicleType;
      const categoryId = body.data?.categoryId;
      const result = await options.database.$transaction(async (tx) => {
        const selected = await selectPracticeQuestion(tx, vehicleType, randomOffset, categoryId);
        if (!selected) return null;
        const { question, snapshot } = selected;
        const presentation = await tx.questionPresentation.create({ data: {
          userId: user.id,
          questionId: question.id,
          conceptId: question.conceptId,
          createdAt: now(),
          snapshot,
        } });
        return presentationResponseSchema.parse({ presentationId: presentation.id, question: snapshot.question });
      }, { isolationLevel: 'RepeatableRead' });
      if (!result) return reply.code(404).send(errorSchema.parse({ error: 'No questions available' }));
      return result;
    });
    practiceApp.post('/practice/presentation', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated presentation request missing');
      const body = ownedDailyPresentationRequestSchema.safeParse(request.body);
      if (!body.success || !dailyPracticeQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const result = await getOwnedDailyPresentation(options.database, user.id, body.data.presentationId);
      if (!result) return reply.code(404).send(errorSchema.parse({ error: 'Presentation not found' }));
      return result;
    });
    practiceApp.post('/practice/daily', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      const requestInstant = requestInstants.get(request);
      if (!user || !requestInstant) throw new Error('Authenticated daily practice request missing');
      if (
        !dailyPracticeQuerySchema.safeParse(request.query).success
        || !dailyPracticeRequestSchema.safeParse(request.body).success
      ) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      const result = await assignDailyPresentation(options.database, user, requestInstant, randomOffset);
      if (result.kind === 'vehicle-required') {
        return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
      }
      if (result.kind === 'empty') {
        return reply.code(404).send(errorSchema.parse({ error: 'No questions available' }));
      }
      return result.response;
    });
    practiceApp.post('/practice/retry-mistake', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated practice user missing');
      const body = retryMistakeRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      if (!user.selectedVehicleType) return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
      const vehicleType = user.selectedVehicleType;
      const result = await options.database.$transaction(async (tx) => {
        const mistake = await tx.questionPresentation.findFirst({
          where: { id: body.data.presentationId, userId: user.id },
          select: {
            questionId: true,
            conceptId: true,
            snapshot: true,
            answer: { select: { selectedChoiceId: true, isCorrect: true } },
          },
        });
        const mistakeAnswer = mistake?.answer;
        if (!mistake || mistakeAnswer?.isCorrect !== false) return { kind: 'not-found' } as const;
        const mistakeSnapshot = parsePresentationSnapshot(mistake.snapshot);
        if (
          mistakeSnapshot.question.id !== mistake.questionId
          || !mistakeSnapshot.question.choices.some(({ id }) => id === mistakeAnswer.selectedChoiceId)
          || mistakeAnswer.isCorrect !== (mistakeAnswer.selectedChoiceId === mistakeSnapshot.correctChoiceId)
        ) throw new Error('Stored mistake is inconsistent with its presentation snapshot');
        if (mistake.conceptId === null) return { kind: 'no-concept' } as const;
        const eligibleQuestion: Prisma.QuestionWhereInput = {
          vehicleType,
          conceptId: mistake.conceptId,
          active: true,
          verificationStatus: 'VERIFIED',
        };
        const alternativeCount = await tx.question.count({
          where: { ...eligibleQuestion, id: { not: mistake.questionId } },
        });
        const inclusiveCount = alternativeCount > 0
          ? alternativeCount
          : await tx.question.count({ where: eligibleQuestion });
        const selection = selectRetryCandidateSet(alternativeCount, inclusiveCount, randomOffset);
        if (selection === null) return { kind: 'empty' } as const;
        const question = await tx.question.findFirst({
          where: {
            ...eligibleQuestion,
            ...(selection.excludeSource ? { id: { not: mistake.questionId } } : {}),
          },
          orderBy: { id: 'asc' },
          skip: selection.offset,
          include: { choices: { orderBy: { key: 'asc' } } },
        });
        if (!question) throw new Error('Retry candidate offset did not resolve');
        const snapshot = snapshotQuestion(question, { reviewedTeaching: true });
        const presentation = await tx.questionPresentation.create({ data: {
          userId: user.id,
          questionId: question.id,
          conceptId: question.conceptId,
          createdAt: now(),
          snapshot,
        } });
        return {
          kind: 'created',
          response: presentationResponseSchema.parse({ presentationId: presentation.id, question: snapshot.question }),
        } as const;
      }, { isolationLevel: 'RepeatableRead' });
      if (result.kind === 'not-found') return reply.code(404).send(errorSchema.parse({ error: 'Mistake not found' }));
      if (result.kind === 'no-concept') return reply.code(409).send(errorSchema.parse({ error: 'Mistake has no concept' }));
      if (result.kind === 'empty') return reply.code(404).send(errorSchema.parse({ error: 'No questions available' }));
      return result.response;
    });
    practiceApp.post('/practice/favorite', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated practice user missing');
      const body = favoriteRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      const result = await options.database.$transaction(async (transaction) => {
        const presentation = await transaction.questionPresentation.findFirst({
          where: { id: body.data.presentationId, userId: user.id },
          select: { id: true, questionId: true, snapshot: true },
        });
        if (!presentation) return null;
        parsePresentationSnapshot(presentation.snapshot);
        if (body.data.favorite) {
          const changedAt = now();
          await transaction.favorite.upsert({
            where: { userId_questionId: { userId: user.id, questionId: presentation.questionId } },
            create: {
              userId: user.id,
              questionId: presentation.questionId,
              presentationId: presentation.id,
              createdAt: changedAt,
              updatedAt: changedAt,
            },
            update: { presentationId: presentation.id, updatedAt: changedAt },
          });
        } else {
          await transaction.favorite.deleteMany({
            where: { userId: user.id, questionId: presentation.questionId },
          });
        }
        return favoriteResponseSchema.parse(body.data);
      });
      if (!result) return reply.code(404).send(errorSchema.parse({ error: 'Presentation not found' }));
      return result;
    });
    practiceApp.post('/practice/report', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated practice user missing');
      const body = questionReportRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));

      const response = (report: { id: string; presentationId: string; createdAt: Date }) => (
        questionReportResponseSchema.parse({
          reportId: report.id,
          presentationId: report.presentationId,
          createdAt: report.createdAt.toISOString(),
        })
      );
      const classifyExisting = (report: {
        id: string;
        userId: string;
        questionId: string;
        presentationId: string;
        details: string;
        createdAt: Date;
      }, questionId: string) => (
        report.userId === user.id
        && report.questionId === questionId
        && report.presentationId === body.data.presentationId
        && report.details === body.data.details
          ? { kind: 'reported', response: response(report) } as const
          : { kind: 'conflict' } as const
      );

      let validatedQuestionId: string | undefined;
      try {
        const result = await options.database.$transaction(async (transaction) => {
          const presentation = await transaction.questionPresentation.findFirst({
            where: { id: body.data.presentationId, userId: user.id },
            select: { id: true, questionId: true, snapshot: true },
          });
          if (!presentation) return { kind: 'not-found' } as const;
          const snapshot = parsePresentationSnapshot(presentation.snapshot);
          if (snapshot.question.id !== presentation.questionId) {
            throw new Error('Stored report presentation snapshot is inconsistent');
          }
          validatedQuestionId = presentation.questionId;
          const existing = await transaction.questionReport.findUnique({
            where: { presentationId: presentation.id },
          });
          if (existing) return classifyExisting(existing, presentation.questionId);
          const report = await transaction.questionReport.create({
            data: {
              userId: user.id,
              questionId: presentation.questionId,
              presentationId: presentation.id,
              details: body.data.details,
              createdAt: now(),
            },
          });
          return { kind: 'reported', response: response(report) } as const;
        });
        if (result.kind === 'not-found') {
          return reply.code(404).send(errorSchema.parse({ error: 'Presentation not found' }));
        }
        if (result.kind === 'conflict') {
          return reply.code(409).send(errorSchema.parse({ error: 'Report already submitted' }));
        }
        return result.response;
      } catch (error) {
        if (!isDuplicateQuestionReport(error)) throw error;
        const existing = await options.database.questionReport.findUnique({
          where: { presentationId: body.data.presentationId },
        });
        if (!existing || validatedQuestionId === undefined) throw error;
        const result = classifyExisting(existing, validatedQuestionId);
        if (result.kind === 'conflict') {
          return reply.code(409).send(errorSchema.parse({ error: 'Report already submitted' }));
        }
        return result.response;
      }
    });
    done();
  });
  app.register((examApp, _pluginOptions, done) => {
    const authenticatedRequests = new WeakMap<object, {
      user: z.infer<typeof userSchema>;
      startedAt: Date;
    }>();
    examApp.removeContentTypeParser('application/json');
    examApp.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, parseDone) => {
      if (typeof body !== 'string') {
        parseDone(new BadRequestJsonError(), undefined);
        return;
      }
      try { parseDone(null, parseJsonWithUniqueTopLevelMembers(body)); }
      catch (error) { parseDone(error instanceof BadRequestJsonError ? error : new BadRequestJsonError(), undefined); }
    });
    examApp.addHook('onRequest', async (request, reply) => {
      const startedAt = now();
      const user = await authenticatedUser(request.headers.authorization, startedAt);
      if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
      authenticatedRequests.set(request, { user, startedAt });
    });
    examApp.post('/exam/report', async (request, reply) => {
      const authenticated = authenticatedRequests.get(request);
      if (!authenticated) throw new Error('Authenticated exam user missing');
      if (!emptyQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const body = examQuestionReportRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      const { user } = authenticated;
      const response = (report: { id: string; examQuestionId: string; createdAt: Date }) => (
        examQuestionReportResponseSchema.parse({
          reportId: report.id,
          examQuestionId: report.examQuestionId,
          createdAt: report.createdAt.toISOString(),
        })
      );
      const classifyExisting = (report: {
        id: string;
        userId: string;
        questionId: string;
        examSessionId: string;
        examQuestionId: string;
        details: string;
        createdAt: Date;
      }, source: { questionId: string; examSessionId: string }) => (
        report.userId === user.id
        && report.questionId === source.questionId
        && report.examSessionId === source.examSessionId
        && report.examQuestionId === body.data.examQuestionId
        && report.details === body.data.details
          ? { kind: 'reported', response: response(report) } as const
          : { kind: 'conflict' } as const
      );

      let validatedSource: { questionId: string; examSessionId: string } | undefined;
      try {
        const result = await options.database.$transaction(async (transaction) => {
          const examQuestion = await transaction.examQuestion.findFirst({
            where: { id: body.data.examQuestionId, examSession: { userId: user.id } },
            select: { id: true, questionId: true, examSessionId: true, snapshot: true },
          });
          if (!examQuestion) return { kind: 'not-found' } as const;
          const snapshot = parsePresentationSnapshot(examQuestion.snapshot);
          if (snapshot.question.id !== examQuestion.questionId) {
            throw new Error('Stored exam report snapshot is inconsistent');
          }
          validatedSource = { questionId: examQuestion.questionId, examSessionId: examQuestion.examSessionId };
          const existing = await transaction.examQuestionReport.findUnique({
            where: { examQuestionId: examQuestion.id },
          });
          if (existing) return classifyExisting(existing, validatedSource);
          const report = await transaction.examQuestionReport.create({
            data: {
              userId: user.id,
              questionId: examQuestion.questionId,
              examSessionId: examQuestion.examSessionId,
              examQuestionId: examQuestion.id,
              details: body.data.details,
              createdAt: now(),
            },
          });
          return { kind: 'reported', response: response(report) } as const;
        });
        if (result.kind === 'not-found') {
          return reply.code(404).send(errorSchema.parse({ error: 'Exam question not found' }));
        }
        if (result.kind === 'conflict') {
          return reply.code(409).send(errorSchema.parse({ error: 'Report already submitted' }));
        }
        return result.response;
      } catch (error) {
        if (!isDuplicateExamQuestionReport(error)) throw error;
        const existing = await options.database.examQuestionReport.findUnique({
          where: { examQuestionId: body.data.examQuestionId },
        });
        if (!existing || validatedSource === undefined) throw error;
        const result = classifyExisting(existing, validatedSource);
        if (result.kind === 'conflict') {
          return reply.code(409).send(errorSchema.parse({ error: 'Report already submitted' }));
        }
        return result.response;
      }
    });
    examApp.get('/exam/history', async (request, reply) => {
      const authenticated = authenticatedRequests.get(request);
      if (!authenticated) throw new Error('Authenticated exam user missing');
      let query;
      try { query = parseExamHistoryQuery(request.query); }
      catch { return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' })); }
      const after = query.cursor === null ? {} : {
        OR: [
          { startedAt: { lt: new Date(query.cursor.startedAt) } },
          { startedAt: new Date(query.cursor.startedAt), id: { lt: query.cursor.examId } },
        ],
      };
      const exams = await options.database.examSession.findMany({
        where: { userId: authenticated.user.id, completedAt: { not: null }, ...after },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        select: {
          id: true,
          vehicleType: true,
          questionCount: true,
          passingScore: true,
          startedAt: true,
          expiresAt: true,
          completedAt: true,
          score: true,
          passed: true,
          questions: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              questionId: true,
              snapshot: true,
              selectedChoiceId: true,
              isCorrect: true,
              answeredAt: true,
            },
          },
        },
      });
      const hasMore = exams.length > query.limit;
      const page = exams.slice(0, query.limit).map(mapExamHistorySession);
      const last = page.at(-1);
      return examHistoryResponseSchema.parse({
        items: page.map(({ item }) => item),
        nextCursor: hasMore && last ? encodeExamHistoryCursor(last.cursor) : null,
      });
    });
    examApp.get('/exam/current', async (request, reply) => {
      const authenticated = authenticatedRequests.get(request);
      if (!authenticated) throw new Error('Authenticated exam user missing');
      if (!emptyQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const { user, startedAt: serverTime } = authenticated;
      const result = await options.database.$transaction(async (transaction) => {
        const active = await transaction.examSession.findMany({
          where: { userId: user.id, completedAt: null, expiresAt: { gt: serverTime } },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          take: 2,
          select: { id: true },
        });
        if (active.length > 1) return { kind: 'ambiguous' } as const;
        const exam = await transaction.examSession.findFirst({
          where: { userId: user.id, completedAt: null },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            vehicleType: true,
            questionCount: true,
            passingScore: true,
            startedAt: true,
            expiresAt: true,
            completedAt: true,
            score: true,
            passed: true,
            questions: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                position: true,
                questionId: true,
                snapshot: true,
                selectedChoiceId: true,
                isCorrect: true,
                answeredAt: true,
              },
            },
          },
        });
        return { kind: 'resolved', exam } as const;
      }, { isolationLevel: 'RepeatableRead' });
      if (result.kind === 'ambiguous') throw new Error('Multiple active exam sessions are inconsistent');
      const exam = result.exam;
      if (!exam) return reply.code(404).send(errorSchema.parse({ error: 'Exam not found' }));
      if (
        exam.completedAt !== null
        || exam.score !== null
        || exam.passed !== null
      ) throw new Error('Stored uncompleted exam tuple is inconsistent');
      if (
        exam.questionCount !== EXAM_QUESTION_COUNT
        || exam.passingScore !== EXAM_PASSING_SCORE
        || exam.expiresAt.getTime() - exam.startedAt.getTime() !== EXAM_DURATION_MS
        || exam.questions.length !== EXAM_QUESTION_COUNT
        || exam.questions.some((question, index) => question.position !== index + 1)
        || new Set(exam.questions.map(({ id }) => id)).size !== EXAM_QUESTION_COUNT
        || new Set(exam.questions.map(({ questionId }) => questionId)).size !== EXAM_QUESTION_COUNT
      ) throw new Error('Stored exam session configuration is inconsistent');

      let answeredCount = 0;
      const questions = exam.questions.map((question) => {
        const snapshot = parsePresentationSnapshot(question.snapshot);
        if (snapshot.question.id !== question.questionId) throw new Error('Stored exam snapshot is inconsistent');
        const tuple = [question.selectedChoiceId, question.isCorrect, question.answeredAt];
        const nullCount = tuple.filter((value) => value === null).length;
        if (nullCount === tuple.length) {
          return {
            examQuestionId: question.id,
            position: question.position,
            selectedChoiceId: null,
            answeredAt: null,
            question: snapshot.question,
          };
        }
        if (nullCount !== 0) throw new Error('Stored exam answer tuple is incomplete');
        const selectedChoiceId = question.selectedChoiceId;
        const isCorrect = question.isCorrect;
        const answeredAt = question.answeredAt;
        if (
          selectedChoiceId === null
          || isCorrect === null
          || answeredAt === null
          || !snapshot.question.choices.some(({ id }) => id === selectedChoiceId)
          || isCorrect !== (selectedChoiceId === snapshot.correctChoiceId)
          || answeredAt.getTime() < exam.startedAt.getTime()
          || answeredAt.getTime() >= exam.expiresAt.getTime()
        ) throw new Error('Stored exam answer is inconsistent');
        answeredCount++;
        return {
          examQuestionId: question.id,
          position: question.position,
          selectedChoiceId,
          answeredAt: answeredAt.toISOString(),
          question: snapshot.question,
        };
      });
      return currentExamResponseSchema.parse({
        examId: exam.id,
        vehicleType: exam.vehicleType,
        questionCount: exam.questionCount,
        passingScore: exam.passingScore,
        startedAt: exam.startedAt.toISOString(),
        expiresAt: exam.expiresAt.toISOString(),
        serverTime: serverTime.toISOString(),
        expired: serverTime.getTime() >= exam.expiresAt.getTime(),
        answeredCount,
        remainingCount: EXAM_QUESTION_COUNT - answeredCount,
        questions,
      });
    });
    examApp.post('/exam/start', async (request, reply) => {
      const authenticated = authenticatedRequests.get(request);
      if (!authenticated) throw new Error('Authenticated exam user missing');
      if (!emptyQuerySchema.safeParse(request.query).success || !examStartRequestSchema.safeParse(request.body).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const { user, startedAt } = authenticated;
      const vehicleType = user.selectedVehicleType;
      if (!vehicleType) {
        return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
      }
      const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
      const eligibleQuestion = {
        vehicleType,
        active: true,
        verificationStatus: 'VERIFIED',
      } as const;

      const startTransaction = () => options.database.$transaction(async (transaction) => {
        const active = await transaction.examSession.findFirst({
          where: { userId: user.id, completedAt: null, expiresAt: { gt: startedAt } },
          select: { id: true },
        });
        if (active) return { kind: 'active' } as const;

        const eligible = await transaction.question.findMany({
          where: eligibleQuestion,
          orderBy: { id: 'asc' },
          take: EXAM_ELIGIBLE_LIMIT + 1,
          select: { id: true },
        });
        if (eligible.length > EXAM_ELIGIBLE_LIMIT) throw new Error('Eligible exam question limit exceeded');
        if (eligible.length < EXAM_QUESTION_COUNT) return { kind: 'insufficient' } as const;

        const selectedIds = sampleExamQuestionIds(eligible.map(({ id }) => id), examRandomOffset);
        const selectedQuestions = await transaction.question.findMany({
          where: { ...eligibleQuestion, id: { in: selectedIds } },
          include: { choices: { orderBy: { key: 'asc' } } },
        });
        if (selectedQuestions.length !== EXAM_QUESTION_COUNT) throw new Error('Selected exam questions changed eligibility');
        const byId = new Map(selectedQuestions.map((question) => [question.id, question]));
        if (byId.size !== EXAM_QUESTION_COUNT) throw new Error('Selected exam questions are not unique');
        const snapshots = selectedIds.map((questionId) => {
          const question = byId.get(questionId);
          if (!question) throw new Error('Selected exam question is absent');
          const snapshot = snapshotQuestion(question);
          if (snapshot.question.id !== questionId) throw new Error('Selected exam snapshot is inconsistent');
          return { questionId, conceptId: question.conceptId, snapshot };
        });

        const exam = await transaction.examSession.create({
          data: {
            userId: user.id,
            vehicleType,
            questionCount: EXAM_QUESTION_COUNT,
            passingScore: EXAM_PASSING_SCORE,
            startedAt,
            expiresAt,
            questions: { create: snapshots.map(({ questionId, conceptId, snapshot }, index) => ({
              position: index + 1,
              questionId,
              conceptId,
              snapshot,
            })) },
          },
          include: { questions: { orderBy: { position: 'asc' } } },
        });
        if (exam.questions.length !== EXAM_QUESTION_COUNT) throw new Error('Exam question creation was incomplete');
        const response = examStartResponseSchema.parse({
          examId: exam.id,
          vehicleType: exam.vehicleType,
          questionCount: exam.questionCount,
          passingScore: exam.passingScore,
          startedAt: exam.startedAt.toISOString(),
          expiresAt: exam.expiresAt.toISOString(),
          questions: exam.questions.map((examQuestion) => {
            if (examQuestion.selectedChoiceId !== null || examQuestion.isCorrect !== null || examQuestion.answeredAt !== null) {
              throw new Error('New exam question has answer state');
            }
            const snapshot = parsePresentationSnapshot(examQuestion.snapshot);
            if (snapshot.question.id !== examQuestion.questionId) throw new Error('Stored exam snapshot is inconsistent');
            return { examQuestionId: examQuestion.id, position: examQuestion.position, question: snapshot.question };
          }),
        });
        return { kind: 'created', response } as const;
      }, { isolationLevel: 'Serializable' });

      const result = await retryExamStart(
        startTransaction,
        (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034',
      );
      if (result.kind === 'active') return reply.code(409).send(errorSchema.parse({ error: 'Exam already in progress' }));
      if (result.kind === 'insufficient') return reply.code(409).send(errorSchema.parse({ error: 'Not enough questions available' }));
      return result.response;
    });
    examApp.post('/exam/answer', async (request, reply) => {
      const authenticated = authenticatedRequests.get(request);
      if (!authenticated) throw new Error('Authenticated exam user missing');
      if (!emptyQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const body = examAnswerRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      const { user, startedAt: answeredAt } = authenticated;

      const result = await options.database.$transaction(async (transaction) => {
        const lockedSessions = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT session.id
          FROM "ExamSession" AS session
          INNER JOIN "ExamQuestion" AS question ON question."examSessionId" = session.id
          WHERE question.id = ${body.data.examQuestionId}::uuid
            AND session."userId" = ${user.id}::uuid
          FOR UPDATE OF session
        `);
        if (lockedSessions.length === 0) return { kind: 'not-found' } as const;
        if (lockedSessions.length !== 1 || lockedSessions[0]?.id === undefined) {
          throw new Error('Exam answer lock cardinality is inconsistent');
        }
        const lockedSessionId = lockedSessions[0].id;
        const examQuestion = await transaction.examQuestion.findFirst({
          where: {
            id: body.data.examQuestionId,
            examSessionId: lockedSessionId,
            examSession: { userId: user.id },
          },
          select: {
            id: true,
            examSessionId: true,
            questionId: true,
            conceptId: true,
            snapshot: true,
            selectedChoiceId: true,
            isCorrect: true,
            answeredAt: true,
            examSession: {
              select: {
                questionCount: true,
                passingScore: true,
                startedAt: true,
                expiresAt: true,
                completedAt: true,
                _count: { select: { questions: true } },
              },
            },
          },
        });
        if (!examQuestion) return { kind: 'not-found' } as const;
        if (examQuestion.examSession.completedAt !== null) return { kind: 'completed' } as const;
        if (examQuestion.examSession.expiresAt.getTime() <= answeredAt.getTime()) return { kind: 'expired' } as const;
        if (
          examQuestion.selectedChoiceId !== null
          || examQuestion.isCorrect !== null
          || examQuestion.answeredAt !== null
        ) return { kind: 'duplicate' } as const;
        if (
          examQuestion.examSession.questionCount !== EXAM_QUESTION_COUNT
          || examQuestion.examSession.passingScore !== EXAM_PASSING_SCORE
          || examQuestion.examSession.expiresAt.getTime() - examQuestion.examSession.startedAt.getTime() !== EXAM_DURATION_MS
          || examQuestion.examSession._count.questions !== EXAM_QUESTION_COUNT
        ) throw new Error('Stored exam session configuration is inconsistent');

        const snapshot = parsePresentationSnapshot(examQuestion.snapshot);
        if (snapshot.question.id !== examQuestion.questionId) throw new Error('Stored exam snapshot is inconsistent');
        if (!snapshot.question.choices.some(({ id }) => id === body.data.choiceId)) {
          return { kind: 'invalid-choice' } as const;
        }
        const updated = await transaction.examQuestion.updateMany({
          where: {
            id: examQuestion.id,
            selectedChoiceId: null,
            isCorrect: null,
            answeredAt: null,
          },
          data: {
            selectedChoiceId: body.data.choiceId,
            isCorrect: body.data.choiceId === snapshot.correctChoiceId,
            answeredAt,
          },
        });
        if (updated.count !== 1) {
          const current = await transaction.examQuestion.findUnique({
            where: { id: examQuestion.id },
            select: { selectedChoiceId: true, isCorrect: true, answeredAt: true },
          });
          if (
            current
            && current.selectedChoiceId !== null
            && current.isCorrect !== null
            && current.answeredAt !== null
          ) {
            return { kind: 'duplicate' } as const;
          }
          throw new Error('Exam answer update cardinality is inconsistent');
        }
        if (examQuestion.conceptId !== null) {
          const learningStateUpdates = await transaction.$executeRaw(Prisma.sql`
            INSERT INTO "ConceptLearningState" (
              "userId", "conceptId", "examAnswered", "examCorrect", "lastExamAt"
            ) VALUES (
              ${user.id}::uuid,
              ${examQuestion.conceptId}::uuid,
              1,
              ${body.data.choiceId === snapshot.correctChoiceId ? 1 : 0},
              ${answeredAt}
            )
            ON CONFLICT ("userId", "conceptId") DO UPDATE SET
              "examAnswered" = "ConceptLearningState"."examAnswered" + 1,
              "examCorrect" = "ConceptLearningState"."examCorrect" + EXCLUDED."examCorrect",
              "lastExamAt" = GREATEST("ConceptLearningState"."lastExamAt", EXCLUDED."lastExamAt")
          `);
          if (learningStateUpdates !== 1) throw new Error('Exam learning state update cardinality is inconsistent');
        }
        const answeredCount = await transaction.examQuestion.count({
          where: { examSessionId: examQuestion.examSessionId, answeredAt: { not: null } },
        });
        return {
          kind: 'answered',
          response: examAnswerResponseSchema.parse({
            examId: examQuestion.examSessionId,
            examQuestionId: examQuestion.id,
            selectedChoiceId: body.data.choiceId,
            answeredAt: answeredAt.toISOString(),
            answeredCount,
            remainingCount: EXAM_QUESTION_COUNT - answeredCount,
          }),
        } as const;
      });

      if (result.kind === 'not-found') return reply.code(404).send(errorSchema.parse({ error: 'Exam question not found' }));
      if (result.kind === 'completed') return reply.code(409).send(errorSchema.parse({ error: 'Exam already completed' }));
      if (result.kind === 'expired') return reply.code(409).send(errorSchema.parse({ error: 'Exam expired' }));
      if (result.kind === 'duplicate') return reply.code(409).send(errorSchema.parse({ error: 'Answer already submitted' }));
      if (result.kind === 'invalid-choice') return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      return result.response;
    });
    examApp.post('/exam/complete', async (request, reply) => {
      const authenticated = authenticatedRequests.get(request);
      if (!authenticated) throw new Error('Authenticated exam user missing');
      if (!emptyQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const body = examCompleteRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      const { user, startedAt: completedAt } = authenticated;

      const result = await options.database.$transaction(async (transaction) => {
        const lockedSessions = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT session.id
          FROM "ExamSession" AS session
          WHERE session.id = ${body.data.examId}::uuid
            AND session."userId" = ${user.id}::uuid
          FOR UPDATE OF session
        `);
        if (lockedSessions.length === 0) return { kind: 'not-found' } as const;
        if (lockedSessions.length !== 1 || lockedSessions[0]?.id !== body.data.examId) {
          throw new Error('Exam completion lock cardinality is inconsistent');
        }
        const exam = await transaction.examSession.findFirst({
          where: { id: body.data.examId, userId: user.id },
          select: {
            id: true,
            questionCount: true,
            passingScore: true,
            startedAt: true,
            expiresAt: true,
            completedAt: true,
            score: true,
            passed: true,
            questions: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                position: true,
                questionId: true,
                snapshot: true,
                selectedChoiceId: true,
                isCorrect: true,
                answeredAt: true,
              },
            },
          },
        });
        if (!exam) return { kind: 'not-found' } as const;
        if (
          exam.questionCount !== EXAM_QUESTION_COUNT
          || exam.passingScore !== EXAM_PASSING_SCORE
          || exam.expiresAt.getTime() - exam.startedAt.getTime() !== EXAM_DURATION_MS
          || exam.questions.length !== EXAM_QUESTION_COUNT
          || exam.questions.some((question, index) => question.position !== index + 1)
          || new Set(exam.questions.map(({ id }) => id)).size !== EXAM_QUESTION_COUNT
          || new Set(exam.questions.map(({ questionId }) => questionId)).size !== EXAM_QUESTION_COUNT
        ) throw new Error('Stored exam session configuration is inconsistent');

        const outcomes = exam.questions.map((question) => {
          const snapshot = parsePresentationSnapshot(question.snapshot);
          if (snapshot.question.id !== question.questionId) throw new Error('Stored exam snapshot is inconsistent');
          const tuple = [question.selectedChoiceId, question.isCorrect, question.answeredAt];
          const nullCount = tuple.filter((value) => value === null).length;
          if (nullCount === tuple.length) return null;
          if (nullCount !== 0) throw new Error('Stored exam answer tuple is incomplete');
          const selectedChoiceId = question.selectedChoiceId;
          const isCorrect = question.isCorrect;
          const answeredAt = question.answeredAt;
          if (
            selectedChoiceId === null
            || isCorrect === null
            || answeredAt === null
            || !snapshot.question.choices.some(({ id }) => id === selectedChoiceId)
            || isCorrect !== (selectedChoiceId === snapshot.correctChoiceId)
            || answeredAt.getTime() < exam.startedAt.getTime()
            || answeredAt.getTime() >= exam.expiresAt.getTime()
          ) throw new Error('Stored exam answer is inconsistent');
          return isCorrect;
        });
        const summary = summarizeExamOutcomes(outcomes);
        const completionTuple = [exam.completedAt, exam.score, exam.passed];
        const completionNullCount = completionTuple.filter((value) => value === null).length;
        if (completionNullCount !== 0 && completionNullCount !== completionTuple.length) {
          throw new Error('Stored exam completion tuple is incomplete');
        }

        const response = (persistedCompletedAt: Date, persistedScore: number, persistedPassed: boolean) => {
          if (persistedScore !== summary.score || persistedPassed !== summary.passed) {
            throw new Error('Stored exam completion result is inconsistent');
          }
          return examCompleteResponseSchema.parse({
            examId: exam.id,
            questionCount: exam.questionCount,
            answeredCount: summary.answeredCount,
            unansweredCount: summary.unansweredCount,
            score: persistedScore,
            passingScore: exam.passingScore,
            passed: persistedPassed,
            completedAt: persistedCompletedAt.toISOString(),
          });
        };

        if (completionNullCount === 0) {
          if (exam.completedAt === null || exam.score === null || exam.passed === null) {
            throw new Error('Stored exam completion tuple is inconsistent');
          }
          if (summary.unansweredCount > 0 && exam.completedAt.getTime() < exam.expiresAt.getTime()) {
            throw new Error('Stored exam was completed early with unanswered questions');
          }
          return { kind: 'completed', response: response(exam.completedAt, exam.score, exam.passed) } as const;
        }
        if (completedAt.getTime() < exam.expiresAt.getTime() && summary.unansweredCount > 0) {
          return { kind: 'incomplete' } as const;
        }

        const updated = await transaction.examSession.updateMany({
          where: {
            id: exam.id,
            userId: user.id,
            completedAt: null,
            score: null,
            passed: null,
          },
          data: { completedAt, score: summary.score, passed: summary.passed },
        });
        if (updated.count === 1) {
          return { kind: 'completed', response: response(completedAt, summary.score, summary.passed) } as const;
        }
        if (updated.count !== 0) throw new Error('Exam completion update cardinality is inconsistent');
        const current = await transaction.examSession.findUnique({
          where: { id: exam.id },
          select: { completedAt: true, score: true, passed: true },
        });
        if (!current || current.completedAt === null || current.score === null || current.passed === null) {
          throw new Error('Concurrent exam completion tuple is inconsistent');
        }
        return { kind: 'completed', response: response(current.completedAt, current.score, current.passed) } as const;
      });

      if (result.kind === 'not-found') return reply.code(404).send(errorSchema.parse({ error: 'Exam not found' }));
      if (result.kind === 'incomplete') return reply.code(409).send(errorSchema.parse({ error: 'Exam incomplete' }));
      return result.response;
    });
    examApp.get('/exam/:examId/review', async (request, reply) => {
      const authenticated = authenticatedRequests.get(request);
      if (!authenticated) throw new Error('Authenticated exam user missing');
      if (!emptyQuerySchema.safeParse(request.query).success) {
        return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      }
      const params = examReviewParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));

      const exam = await options.database.examSession.findFirst({
        where: { id: params.data.examId, userId: authenticated.user.id },
        select: {
          id: true,
          questionCount: true,
          passingScore: true,
          startedAt: true,
          expiresAt: true,
          completedAt: true,
          score: true,
          passed: true,
          questions: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              questionId: true,
              snapshot: true,
              selectedChoiceId: true,
              isCorrect: true,
              answeredAt: true,
            },
          },
        },
      });
      if (!exam) return reply.code(404).send(errorSchema.parse({ error: 'Exam not found' }));

      const completionTuple = [exam.completedAt, exam.score, exam.passed];
      const completionNullCount = completionTuple.filter((value) => value === null).length;
      if (completionNullCount === completionTuple.length) {
        return reply.code(409).send(errorSchema.parse({ error: 'Exam not completed' }));
      }
      if (completionNullCount !== 0 || exam.completedAt === null || exam.score === null || exam.passed === null) {
        throw new Error('Stored exam completion tuple is incomplete');
      }
      const persistedCompletedAt = exam.completedAt;
      if (
        exam.questionCount !== EXAM_QUESTION_COUNT
        || exam.passingScore !== EXAM_PASSING_SCORE
        || exam.expiresAt.getTime() - exam.startedAt.getTime() !== EXAM_DURATION_MS
        || exam.questions.length !== EXAM_QUESTION_COUNT
        || exam.questions.some((question, index) => question.position !== index + 1)
        || new Set(exam.questions.map(({ id }) => id)).size !== EXAM_QUESTION_COUNT
        || new Set(exam.questions.map(({ questionId }) => questionId)).size !== EXAM_QUESTION_COUNT
      ) throw new Error('Stored exam session configuration is inconsistent');

      const reviewed = exam.questions.map((question) => {
        const snapshot = parsePresentationSnapshot(question.snapshot);
        if (snapshot.question.id !== question.questionId) throw new Error('Stored exam snapshot is inconsistent');
        const tuple = [question.selectedChoiceId, question.isCorrect, question.answeredAt];
        const nullCount = tuple.filter((value) => value === null).length;
        if (nullCount === tuple.length) return { outcome: null, question, snapshot } as const;
        if (nullCount !== 0) throw new Error('Stored exam answer tuple is incomplete');
        const selectedChoiceId = question.selectedChoiceId;
        const isCorrect = question.isCorrect;
        const answeredAt = question.answeredAt;
        if (
          selectedChoiceId === null
          || isCorrect === null
          || answeredAt === null
          || !snapshot.question.choices.some(({ id }) => id === selectedChoiceId)
          || isCorrect !== (selectedChoiceId === snapshot.correctChoiceId)
          || answeredAt.getTime() < exam.startedAt.getTime()
          || answeredAt.getTime() >= exam.expiresAt.getTime()
          || answeredAt.getTime() > persistedCompletedAt.getTime()
        ) throw new Error('Stored exam answer is inconsistent');
        return { outcome: isCorrect, question, snapshot } as const;
      });
      const summary = summarizeExamOutcomes(reviewed.map(({ outcome }) => outcome));
      if (
        exam.score !== summary.score
        || exam.passed !== summary.passed
        || (summary.unansweredCount > 0 && persistedCompletedAt.getTime() < exam.expiresAt.getTime())
      ) throw new Error('Stored exam completion result is inconsistent');

      return examReviewResponseSchema.parse({
        examId: exam.id,
        questionCount: exam.questionCount,
        score: exam.score,
        passingScore: exam.passingScore,
        passed: exam.passed,
        completedAt: persistedCompletedAt.toISOString(),
        mistakes: reviewed.filter(({ outcome }) => outcome !== true).map(({ question, snapshot }) => ({
          examQuestionId: question.id,
          position: question.position,
          selectedChoiceId: question.selectedChoiceId,
          answeredAt: question.answeredAt?.toISOString() ?? null,
          correctChoiceId: snapshot.correctChoiceId,
          question: snapshot.question,
          explanationThai: snapshot.explanationThai,
          explanationEnglish: snapshot.explanationEnglish,
          explanationRussian: snapshot.explanationRussian,
          trapExplanationThai: snapshot.trapExplanationThai,
          trapExplanationEnglish: snapshot.trapExplanationEnglish,
          trapExplanationRussian: snapshot.trapExplanationRussian,
        })),
      });
    });
    done();
  });
  app.post('/practice/answer', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    const body = answerRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
    try {
      const result = await options.database.$transaction(async (tx) => {
        return submitPracticeAnswer(tx, user.id, body.data.presentationId, body.data.choiceId, now());
      });
      if ('error' in result) return reply.code(result.error === 'Bad Request' ? 400 : 404).send(errorSchema.parse(result));
      return result;
    } catch (error) {
      if (isDuplicateAnswer(error)) return reply.code(409).send(errorSchema.parse({ error: 'Answer already submitted' }));
      throw error;
    }
  });
  return app;
}
