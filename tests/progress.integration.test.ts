import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { progressResponseSchema } from '../packages/database/src/progress.ts';
import { conceptProgressResponseSchema } from '../packages/database/src/concept-progress.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `progress_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-17T06:30:00.000Z');
const app = createApi({ database, botToken: 'synthetic', now: () => now });

const tokens = {
  owner: randomBytes(32).toString('base64url'),
  empty: randomBytes(32).toString('base64url'),
  foreign: randomBytes(32).toString('base64url'),
  expired: randomBytes(32).toString('base64url'),
  revoked: randomBytes(32).toString('base64url'),
};
const userIds = {
  owner: randomUUID(),
  empty: randomUUID(),
  foreign: randomUUID(),
  expired: randomUUID(),
  revoked: randomUUID(),
};
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const progress = (token: string, query = '') => app.inject({
  method: 'GET', url: `/me/progress${query}`, headers: authorization(token),
});
const conceptProgress = (token: string, query = '') => app.inject({
  method: 'GET', url: `/me/progress/concepts${query}`, headers: authorization(token),
});
const conceptIds = { stopping: randomUUID(), visibility: randomUUID(), unused: randomUUID() };
const session = (token: string, expiresAt = new Date(now.getTime() + 60_000)) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(now.getTime() - 1_000),
  expiresAt,
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true },
  );

  const users = [
    { id: userIds.owner, token: tokens.owner, telegramUserId: 97_000n, vehicle: 'CAR' as const },
    { id: userIds.empty, token: tokens.empty, telegramUserId: 97_001n, vehicle: null },
    { id: userIds.foreign, token: tokens.foreign, telegramUserId: 97_002n, vehicle: 'MOTORCYCLE' as const },
    { id: userIds.expired, token: tokens.expired, telegramUserId: 97_003n, vehicle: null, expiresAt: now },
    { id: userIds.revoked, token: tokens.revoked, telegramUserId: 97_004n, vehicle: null },
  ];
  for (const user of users) {
    await database.user.create({ data: {
      id: user.id,
      telegramUserId: user.telegramUserId,
      selectedVehicleType: user.vehicle,
      sessions: { create: session(user.token, user.expiresAt) },
    } });
  }
  await database.session.deleteMany({ where: { userId: userIds.revoked } });

  const [rules, signs] = await Promise.all([
    database.category.create({ data: {
      slug: 'progress-rules', nameThai: 'กฎ', nameEnglish: 'Rules', nameRussian: 'Правила',
    } }),
    database.category.create({ data: {
      slug: 'progress-signs', nameThai: 'ป้าย', nameEnglish: 'Signs', nameRussian: 'Знаки',
    } }),
  ]);
  await database.concept.createMany({ data: [
    { id: conceptIds.stopping, slug: 'progress-stopping', nameThai: 'การหยุด', nameEnglish: 'Stopping', nameRussian: 'Остановка' },
    { id: conceptIds.visibility, slug: 'progress-visibility', nameThai: 'ทัศนวิสัย', nameEnglish: 'Visibility', nameRussian: 'Видимость' },
    { id: conceptIds.unused, slug: 'progress-unused', nameThai: 'ไม่ได้ใช้', nameEnglish: 'Unused', nameRussian: 'Не используется' },
  ] });
  const [repeatedQuestion, motorcycleQuestion, inactiveQuestion, draftQuestion] = await Promise.all([
    database.question.create({ data: {
      categoryId: rules.id, conceptId: conceptIds.stopping, vehicleType: 'CAR', textEnglish: 'Repeated', sourceType: 'ORIGINAL',
      active: true, verificationStatus: 'VERIFIED',
    } }),
    database.question.create({ data: {
      categoryId: signs.id, conceptId: conceptIds.visibility, vehicleType: 'MOTORCYCLE', textEnglish: 'Motorcycle', sourceType: 'ORIGINAL',
      active: true, verificationStatus: 'VERIFIED',
    } }),
    database.question.create({ data: {
      categoryId: signs.id, vehicleType: 'CAR', textEnglish: 'Inactive', sourceType: 'ORIGINAL',
      active: false, verificationStatus: 'VERIFIED',
    } }),
    database.question.create({ data: {
      categoryId: rules.id, vehicleType: 'MOTORCYCLE', textEnglish: 'Draft', sourceType: 'ORIGINAL',
      active: true, verificationStatus: 'DRAFT',
    } }),
  ]);

  const addAttempt = async (questionId: string, isCorrect: boolean, userId = userIds.owner) => {
    const presentation = await database.questionPresentation.create({ data: {
      userId, questionId, snapshot: {},
    } });
    await database.answerAttempt.create({ data: {
      presentationId: presentation.id, selectedChoiceId: randomUUID(), isCorrect,
    } });
  };
  await addAttempt(repeatedQuestion.id, true);
  await addAttempt(repeatedQuestion.id, false);
  await addAttempt(repeatedQuestion.id, false);
  await addAttempt(motorcycleQuestion.id, true);
  await addAttempt(motorcycleQuestion.id, false);
  await addAttempt(inactiveQuestion.id, false);
  await addAttempt(draftQuestion.id, false);
  await addAttempt(repeatedQuestion.id, true, userIds.foreign);
  await database.questionPresentation.create({ data: {
    userId: userIds.owner, questionId: repeatedQuestion.id, snapshot: {},
  } });
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('GET /me/progress', () => {
  it('authenticates before strict empty-query validation with uniform no-store errors', async () => {
    const unknownToken = randomBytes(32).toString('base64url');
    for (const headers of [
      {},
      { authorization: 'Bearer invalid' },
      authorization(unknownToken),
      authorization(tokens.expired),
      authorization(tokens.revoked),
    ]) {
      const response = await app.inject({
        method: 'GET', url: '/me/progress?unknown=1&unknown=2', headers,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }

    for (const query of ['?unknown=1', '?unknown=1&unknown=2']) {
      const response = await progress(tokens.owner, query);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('returns strict empty progress for an authenticated learner without attempts', async () => {
    const response = await progress(tokens.empty);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      answered: 0, correct: 0, incorrect: 0, accuracyPercent: null,
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('counts every owned submitted outcome across questions, vehicles, categories and content states', async () => {
    const response = await progress(tokens.owner);
    expect(response.statusCode).toBe(200);
    const body = progressResponseSchema.parse(response.json());
    expect(body).toEqual({ answered: 7, correct: 2, incorrect: 5, accuracyPercent: 29 });
    expect(Object.keys(body)).toEqual(['answered', 'correct', 'incorrect', 'accuracyPercent']);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await database.answerAttempt.count()).toBe(8);
    expect(await database.questionPresentation.count({ where: { userId: userIds.owner } })).toBe(8);
  });
});

describe('GET /me/progress/concepts', () => {
  it('authenticates before strict empty-query validation with uniform no-store errors', async () => {
    for (const headers of [{}, { authorization: 'Bearer invalid' }, authorization(tokens.expired), authorization(tokens.revoked)]) {
      const response = await app.inject({ method: 'GET', url: '/me/progress/concepts?unknown=1', headers });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const response = await conceptProgress(tokens.owner, '?unknown=1');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Bad Request' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns an empty strict breakdown for a learner without attempts', async () => {
    const response = await conceptProgress(tokens.empty);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(conceptProgressResponseSchema.parse(response.json())).toEqual({
      concepts: [],
      unassigned: { answered: 0, correct: 0, incorrect: 0, accuracyPercent: null },
      total: { answered: 0, correct: 0, incorrect: 0, accuracyPercent: null },
    });
  });

  it('groups only owned submitted outcomes by concept, weakest first, and reconciles with the lifetime summary', async () => {
    const response = await conceptProgress(tokens.owner);
    expect(response.statusCode).toBe(200);
    const body = conceptProgressResponseSchema.parse(response.json());
    expect(body.concepts).toEqual([
      { conceptId: conceptIds.stopping, slug: 'progress-stopping', nameThai: 'การหยุด', nameEnglish: 'Stopping', nameRussian: 'Остановка', answered: 3, correct: 1, incorrect: 2, accuracyPercent: 33 },
      { conceptId: conceptIds.visibility, slug: 'progress-visibility', nameThai: 'ทัศนวิสัย', nameEnglish: 'Visibility', nameRussian: 'Видимость', answered: 2, correct: 1, incorrect: 1, accuracyPercent: 50 },
    ]);
    expect(body.unassigned).toEqual({ answered: 2, correct: 0, incorrect: 2, accuracyPercent: 0 });
    const lifetime = progressResponseSchema.parse((await progress(tokens.owner)).json());
    expect(body.total).toEqual(lifetime);
    expect(JSON.stringify(body)).not.toContain('progress-unused');
    const foreign = conceptProgressResponseSchema.parse((await conceptProgress(tokens.foreign)).json());
    expect(foreign.concepts.map((item) => [item.slug, item.answered, item.correct])).toEqual([['progress-stopping', 1, 1]]);
    expect(foreign.unassigned.answered).toBe(0);
  });
});
