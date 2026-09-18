import { createHash, randomBytes, randomInt } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../../../packages/database/src/index.ts';
import { parsePresentationSnapshot, practiceNextRequestSchema, presentationResponseSchema, snapshotQuestion } from '../../../packages/database/src/presentation.ts';
import { answerRequestSchema, answerResponseSchema, isDuplicateAnswer } from '../../../packages/database/src/answer.ts';
import { encodeHistoryCursor, historyResponseSchema, mistakesResponseSchema, parseHistoryQuery } from '../../../packages/database/src/history.ts';
import { practiceCategoriesResponseSchema } from '../../../packages/database/src/practice-categories.ts';
import { favoriteRequestSchema, favoriteResponseSchema } from '../../../packages/database/src/favorite.ts';
import { encodeFavoriteCursor, favoriteFeedResponseSchema, parseFavoriteFeedQuery } from '../../../packages/database/src/favorite-feed.ts';
import { buildProgressSummary } from '../../../packages/database/src/progress.ts';
import {
  EXAM_DURATION_MS,
  EXAM_ELIGIBLE_LIMIT,
  EXAM_PASSING_SCORE,
  EXAM_QUESTION_COUNT,
  examAnswerRequestSchema,
  examAnswerResponseSchema,
  retryExamStart,
  examStartRequestSchema,
  examStartResponseSchema,
  sampleExamQuestionIds,
  type ExamRandomOffset,
} from '../../../packages/database/src/exam.ts';
import { InvalidInitDataError, validateInitData } from '../../../packages/telegram/src/index.ts';

export const userSchema = z.strictObject({
  id: z.uuid(), username: z.string().nullable(), firstName: z.string().nullable(),
  selectedVehicleType: z.enum(['CAR', 'MOTORCYCLE']).nullable(),
});
export const loginSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), expiresAt: z.iso.datetime(), user: userSchema });
const bodySchema = z.strictObject({ initData: z.string().min(1).max(16384).refine((value) => Buffer.byteLength(value, 'utf8') <= 16384) });
const bearerSchema = z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/u);
const vehicleSchema = z.strictObject({ vehicleType: z.enum(['CAR', 'MOTORCYCLE']) });
const emptyQuerySchema = z.strictObject({});
const errorSchema = z.strictObject({ error: z.enum(['Unauthorized', 'Bad Request', 'Internal Server Error', 'Vehicle selection required', 'No questions available', 'Presentation not found', 'Exam question not found', 'Answer already submitted', 'Not enough questions available', 'Exam already in progress', 'Exam already completed', 'Exam expired']) });
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

type RandomOffset = (eligibleCount: number) => unknown;

function checkedRandomOffset(randomOffset: RandomOffset, eligibleCount: number) {
  const offset = randomOffset(eligibleCount);
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset >= eligibleCount) {
    throw new Error('Random offset is outside the eligible question range');
  }
  return offset;
}

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
    if (['/me/history', '/me/mistakes', '/me/favorites', '/me/progress', '/practice/categories', '/practice/next', '/practice/answer', '/practice/favorite', '/exam/start', '/exam/answer'].includes(request.routeOptions.url ?? '')) reply.header('Cache-Control', 'no-store');
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
      const user = await authenticatedUser(request.headers.authorization);
      if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
      authenticatedUsers.set(request, user);
    });
    practiceApp.post('/practice/next', async (request, reply) => {
      const user = authenticatedUsers.get(request);
      if (!user) throw new Error('Authenticated practice user missing');
      const body = practiceNextRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
      if (!user.selectedVehicleType) return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
      const vehicleType = user.selectedVehicleType;
      const categoryId = body.data?.categoryId;
      const eligibleQuestion: Prisma.QuestionWhereInput = {
        vehicleType,
        active: true,
        verificationStatus: 'VERIFIED',
        ...(categoryId === undefined ? {} : { categoryId }),
      };
      const result = await options.database.$transaction(async (tx) => {
        const eligibleCount = await tx.question.count({ where: eligibleQuestion });
        if (eligibleCount === 0) return null;
        const offset = checkedRandomOffset(randomOffset, eligibleCount);
        // Repeatable read covers the count, offset lookup and Prisma's separate relation
        // query so selection, wording and choices all come from one MVCC view.
        const question = await tx.question.findFirst({
          where: eligibleQuestion,
          orderBy: { id: 'asc' },
          skip: offset,
          include: { choices: { orderBy: { key: 'asc' } } },
        });
        if (!question) throw new Error('Eligible question offset did not resolve');
        const snapshot = snapshotQuestion(question);
        const presentation = await tx.questionPresentation.create({ data: { userId: user.id, questionId: question.id, createdAt: now(), snapshot } });
        return presentationResponseSchema.parse({ presentationId: presentation.id, question: snapshot.question });
      }, { isolationLevel: 'RepeatableRead' });
      if (!result) return reply.code(404).send(errorSchema.parse({ error: 'No questions available' }));
      return result;
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
          return { questionId, snapshot };
        });

        const exam = await transaction.examSession.create({
          data: {
            userId: user.id,
            vehicleType,
            questionCount: EXAM_QUESTION_COUNT,
            passingScore: EXAM_PASSING_SCORE,
            startedAt,
            expiresAt,
            questions: { create: snapshots.map(({ questionId, snapshot }, index) => ({
              position: index + 1,
              questionId,
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
        const examQuestion = await transaction.examQuestion.findFirst({
          where: { id: body.data.examQuestionId, examSession: { userId: user.id } },
          select: {
            id: true,
            examSessionId: true,
            questionId: true,
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
    done();
  });
  app.post('/practice/answer', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    const body = answerRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
    try {
      const result = await options.database.$transaction(async (tx) => {
        const presentation = await tx.questionPresentation.findFirst({ where: { id: body.data.presentationId, userId: user.id } });
        if (!presentation) return { error: 'Presentation not found' } as const;
        const snapshot = parsePresentationSnapshot(presentation.snapshot);
        if (!snapshot.question.choices.some((choice) => choice.id === body.data.choiceId)) return { error: 'Bad Request' } as const;
        const answer = await tx.answerAttempt.create({ data: {
          presentationId: presentation.id, selectedChoiceId: body.data.choiceId,
          isCorrect: body.data.choiceId === snapshot.correctChoiceId, submittedAt: now(),
        } });
        return answerResponseSchema.parse({
          presentationId: presentation.id, selectedChoiceId: answer.selectedChoiceId, isCorrect: answer.isCorrect,
          correctChoiceId: snapshot.correctChoiceId,
          explanationThai: snapshot.explanationThai, explanationEnglish: snapshot.explanationEnglish, explanationRussian: snapshot.explanationRussian,
          trapExplanationThai: snapshot.trapExplanationThai, trapExplanationEnglish: snapshot.trapExplanationEnglish, trapExplanationRussian: snapshot.trapExplanationRussian,
        });
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
