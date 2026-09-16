import { createHash, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '../../../packages/database/src/index.ts';
import { parsePresentationSnapshot, practiceNextRequestSchema, presentationResponseSchema, snapshotQuestion } from '../../../packages/database/src/presentation.ts';
import { answerRequestSchema, answerResponseSchema, isDuplicateAnswer } from '../../../packages/database/src/answer.ts';
import { encodeHistoryCursor, historyResponseSchema, mistakesResponseSchema, parseHistoryQuery } from '../../../packages/database/src/history.ts';
import { practiceCategoriesResponseSchema } from '../../../packages/database/src/practice-categories.ts';
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
const errorSchema = z.strictObject({ error: z.enum(['Unauthorized', 'Bad Request', 'Internal Server Error', 'Vehicle selection required', 'No questions available', 'Presentation not found', 'Answer already submitted']) });
const userSelect = { id: true, username: true, firstName: true, selectedVehicleType: true } as const;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const lifetimeMs = 24 * 60 * 60 * 1000;

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

/** Caller owns the database connection. Credentials are never logged. */
export function createApi(options: { database: PrismaClient; botToken: string; now?: () => Date }) {
  if (!options.botToken.trim()) throw new Error('BOT_TOKEN is required');
  const app = Fastify({ logger: false, bodyLimit: 100000 });
  const now = options.now ?? (() => new Date());
  app.addHook('onRequest', async (request, reply) => {
    if (['/me/history', '/me/mistakes', '/practice/categories', '/practice/next', '/practice/answer'].includes(request.routeOptions.url ?? '')) reply.header('Cache-Control', 'no-store');
  });
  async function authenticatedUser(header: unknown) {
    const authorization = bearerSchema.safeParse(header);
    if (!authorization.success) return null;
    const session = await options.database.session.findUnique({ where: { tokenHash: digest(authorization.data.slice(7)) }, select: { expiresAt: true, user: { select: userSelect } } });
    if (!session || now().getTime() >= session.expiresAt.getTime()) return null;
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
  app.post('/practice/next', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    const body = practiceNextRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
    if (!user.selectedVehicleType) return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
    const vehicleType = user.selectedVehicleType;
    const categoryId = body.data?.categoryId;
    const categoryFilter = categoryId === undefined ? {} : { categoryId };
    const result = await options.database.$transaction(async (tx) => {
      // Repeatable read also covers Prisma's separate relation query: wording and choices
      // come from one MVCC view even when an editor commits between those reads.
      const question = await tx.question.findFirst({
        where: { vehicleType, active: true, verificationStatus: 'VERIFIED', ...categoryFilter },
        orderBy: { id: 'asc' }, include: { choices: { orderBy: { key: 'asc' } } },
      });
      if (!question) return null;
      const snapshot = snapshotQuestion(question);
      const presentation = await tx.questionPresentation.create({ data: { userId: user.id, questionId: question.id, createdAt: now(), snapshot } });
      return presentationResponseSchema.parse({ presentationId: presentation.id, question: snapshot.question });
    }, { isolationLevel: 'RepeatableRead' });
    if (!result) return reply.code(404).send(errorSchema.parse({ error: 'No questions available' }));
    return result;
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
