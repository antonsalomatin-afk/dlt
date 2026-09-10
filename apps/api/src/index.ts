import { createHash, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '../../../packages/database/src/index.ts';
import { presentationResponseSchema, snapshotQuestion } from '../../../packages/database/src/presentation.ts';
import { InvalidInitDataError, validateInitData } from '../../../packages/telegram/src/index.ts';

export const userSchema = z.strictObject({
  id: z.uuid(), username: z.string().nullable(), firstName: z.string().nullable(),
  selectedVehicleType: z.enum(['CAR', 'MOTORCYCLE']).nullable(),
});
export const loginSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), expiresAt: z.iso.datetime(), user: userSchema });
const bodySchema = z.strictObject({ initData: z.string().min(1).max(16384).refine((value) => Buffer.byteLength(value, 'utf8') <= 16384) });
const bearerSchema = z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/u);
const vehicleSchema = z.strictObject({ vehicleType: z.enum(['CAR', 'MOTORCYCLE']) });
const errorSchema = z.strictObject({ error: z.enum(['Unauthorized', 'Bad Request', 'Internal Server Error', 'Vehicle selection required', 'No questions available']) });
const userSelect = { id: true, username: true, firstName: true, selectedVehicleType: true } as const;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const lifetimeMs = 24 * 60 * 60 * 1000;

/** Caller owns the database connection. Credentials are never logged. */
export function createApi(options: { database: PrismaClient; botToken: string; now?: () => Date }) {
  if (!options.botToken.trim()) throw new Error('BOT_TOKEN is required');
  const app = Fastify({ logger: false, bodyLimit: 100000 });
  const now = options.now ?? (() => new Date());
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url === '/practice/next') reply.header('Cache-Control', 'no-store');
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
  app.post('/practice/next', async (request, reply) => {
    const user = await authenticatedUser(request.headers.authorization);
    if (!user) return reply.code(401).send(errorSchema.parse({ error: 'Unauthorized' }));
    if (!z.strictObject({}).optional().safeParse(request.body).success) return reply.code(400).send(errorSchema.parse({ error: 'Bad Request' }));
    if (!user.selectedVehicleType) return reply.code(409).send(errorSchema.parse({ error: 'Vehicle selection required' }));
    const vehicleType = user.selectedVehicleType;
    const result = await options.database.$transaction(async (tx) => {
      // Repeatable read also covers Prisma's separate relation query: wording and choices
      // come from one MVCC view even when an editor commits between those reads.
      const question = await tx.question.findFirst({
        where: { vehicleType, active: true, verificationStatus: 'VERIFIED' },
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
  return app;
}
