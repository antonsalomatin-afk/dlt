import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { favoriteResponseSchema } from '../packages/database/src/favorite.ts';
import { parsePresentationSnapshot, snapshotQuestion } from '../packages/database/src/presentation.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `favorite_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
let clock = new Date('2026-09-16T12:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock, randomOffset: () => 0 });

const tokens = {
  alice: randomBytes(32).toString('base64url'),
  bob: randomBytes(32).toString('base64url'),
  expired: randomBytes(32).toString('base64url'),
};
const userIds = { alice: randomUUID(), bob: randomUUID(), expired: randomUUID() };
const categoryId = randomUUID();
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const session = (token: string, expiresAt = new Date(clock.getTime() + 60_000)) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(clock.getTime() - 1_000),
  expiresAt,
});
const favorite = (payload: unknown, token = tokens.alice) => app.inject({
  method: 'POST',
  url: '/practice/favorite',
  headers: { ...authorization(token), 'content-type': 'application/json' },
  payload: JSON.stringify(payload),
});
const favoriteRaw = (payload: string, authorizationHeader: string | undefined) => app.inject({
  method: 'POST',
  url: '/practice/favorite',
  headers: authorizationHeader === undefined
    ? { 'content-type': 'application/json' }
    : { authorization: authorizationHeader, 'content-type': 'application/json' },
  payload,
});

let firstQuestionId: string;
let firstPresentationId: string;
let secondPresentationId: string;
let bobPresentationId: string;
let concurrentQuestionId: string;
let concurrentPresentationId: string;

async function createQuestion(textEnglish: string) {
  return database.question.create({
    data: {
      categoryId,
      vehicleType: 'CAR',
      active: true,
      verificationStatus: 'VERIFIED',
      sourceType: 'ORIGINAL',
      textEnglish,
      explanationEnglish: `${textEnglish} explanation`,
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key,
        textEnglish: `${textEnglish} choice ${key}`,
        isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true },
  );
  for (const user of [
    { id: userIds.alice, token: tokens.alice, telegramUserId: 92_001n },
    { id: userIds.bob, token: tokens.bob, telegramUserId: 92_002n },
    { id: userIds.expired, token: tokens.expired, telegramUserId: 92_003n },
  ]) {
    await database.user.create({ data: {
      id: user.id,
      telegramUserId: user.telegramUserId,
      sessions: { create: session(user.token, user.id === userIds.expired ? clock : undefined) },
    } });
  }
  await database.category.create({
    data: { id: categoryId, slug: 'favorite-test', nameThai: 'test', nameEnglish: 'test', nameRussian: 'test' },
  });
  const firstQuestion = await createQuestion('First question');
  firstQuestionId = firstQuestion.id;
  const firstSnapshot = snapshotQuestion(firstQuestion);
  const [firstPresentation, secondPresentation, bobPresentation] = await Promise.all([
    database.questionPresentation.create({ data: { userId: userIds.alice, questionId: firstQuestion.id, snapshot: firstSnapshot } }),
    database.questionPresentation.create({ data: { userId: userIds.alice, questionId: firstQuestion.id, snapshot: firstSnapshot } }),
    database.questionPresentation.create({ data: { userId: userIds.bob, questionId: firstQuestion.id, snapshot: firstSnapshot } }),
  ]);
  firstPresentationId = firstPresentation.id;
  secondPresentationId = secondPresentation.id;
  bobPresentationId = bobPresentation.id;

  const concurrentQuestion = await createQuestion('Concurrent question');
  concurrentQuestionId = concurrentQuestion.id;
  concurrentPresentationId = (await database.questionPresentation.create({
    data: { userId: userIds.alice, questionId: concurrentQuestion.id, snapshot: snapshotQuestion(concurrentQuestion) },
  })).id;
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('POST /practice/favorite', () => {
  it('authenticates before parsing and strictly validates the JSON body without writes', async () => {
    for (const authorizationHeader of [
      undefined,
      'Bearer invalid',
      `Bearer ${randomBytes(32).toString('base64url')}`,
      `Bearer ${tokens.expired}`,
    ]) {
      const response = await favoriteRaw('{', authorizationHeader);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }

    const valid = { presentationId: firstPresentationId, favorite: true };
    const malformedBodies = [
      '{',
      'null',
      '[]',
      '{}',
      JSON.stringify({ presentationId: firstPresentationId, favorite: null }),
      JSON.stringify({ presentationId: firstPresentationId, favorite: 'true' }),
      JSON.stringify({ presentationId: 'not-a-uuid', favorite: true }),
      JSON.stringify({ ...valid, extra: true }),
      `{"presentationId":"${firstPresentationId}","favorite":true,"favorite":false}`,
      `{"presentationId":"${firstPresentationId}","presentationId":"${randomUUID()}","favorite":true}`,
    ];
    for (const payload of malformedBodies) {
      const response = await favoriteRaw(payload, `Bearer ${tokens.alice}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await database.favorite.count()).toBe(0);
  });

  it('creates once, repeats idempotently, and moves the anchor to a newer owned presentation', async () => {
    const first = await favorite({ presentationId: firstPresentationId, favorite: true });
    expect(first.statusCode).toBe(200);
    expect(favoriteBoundary(first)).toEqual({ presentationId: firstPresentationId, favorite: true });
    const created = await database.favorite.findUniqueOrThrow({
      where: { userId_questionId: { userId: userIds.alice, questionId: firstQuestionId } },
    });
    expect(created).toMatchObject({
      userId: userIds.alice,
      questionId: firstQuestionId,
      presentationId: firstPresentationId,
      createdAt: clock,
      updatedAt: clock,
    });

    clock = new Date(clock.getTime() + 1_000);
    const repeated = await favorite({ presentationId: firstPresentationId, favorite: true });
    expect(repeated.statusCode).toBe(200);
    const afterRepeat = await database.favorite.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterRepeat.createdAt).toEqual(created.createdAt);
    expect(afterRepeat.updatedAt).toEqual(clock);
    expect(await database.favorite.count({ where: { userId: userIds.alice, questionId: firstQuestionId } })).toBe(1);

    clock = new Date(clock.getTime() + 1_000);
    const moved = await favorite({ presentationId: secondPresentationId, favorite: true });
    expect(moved.statusCode).toBe(200);
    expect(favoriteBoundary(moved)).toEqual({ presentationId: secondPresentationId, favorite: true });
    expect(await database.favorite.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      id: created.id,
      presentationId: secondPresentationId,
      createdAt: created.createdAt,
      updatedAt: clock,
    });
  });

  it('unfavorites idempotently whether the row is present or absent', async () => {
    for (const presentationId of [secondPresentationId, firstPresentationId]) {
      const response = await favorite({ presentationId, favorite: false });
      expect(response.statusCode).toBe(200);
      expect(favoriteBoundary(response)).toEqual({ presentationId, favorite: false });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(await database.favorite.count({ where: { userId: userIds.alice, questionId: firstQuestionId } })).toBe(0);
    }
  });

  it('keeps one row under concurrent favorite requests', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => favorite({
      presentationId: concurrentPresentationId,
      favorite: true,
    })));
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(await database.favorite.count({
      where: { userId: userIds.alice, questionId: concurrentQuestionId },
    })).toBe(1);
  });

  it('allows two users to favorite the same question independently', async () => {
    const [alice, bob] = await Promise.all([
      favorite({ presentationId: firstPresentationId, favorite: true }, tokens.alice),
      favorite({ presentationId: bobPresentationId, favorite: true }, tokens.bob),
    ]);
    expect(alice.statusCode).toBe(200);
    expect(bob.statusCode).toBe(200);
    const rows = await database.favorite.findMany({
      where: { questionId: firstQuestionId },
      orderBy: { userId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map(({ userId, presentationId }) => ({ userId, presentationId }))).toEqual(expect.arrayContaining([
      { userId: userIds.alice, presentationId: firstPresentationId },
      { userId: userIds.bob, presentationId: bobPresentationId },
    ]));
  });

  it('gives unknown and foreign presentations the same private response and makes no change', async () => {
    const before = await database.favorite.findMany({ orderBy: { id: 'asc' } });
    for (const presentationId of [bobPresentationId, randomUUID()]) {
      const response = await favorite({ presentationId, favorite: true }, tokens.alice);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Presentation not found' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain(presentationId);
    }
    expect(await database.favorite.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('validates the snapshot before either mutation and rolls back on corrupt data', async () => {
    const existing = await database.favorite.findUniqueOrThrow({
      where: { userId_questionId: { userId: userIds.alice, questionId: firstQuestionId } },
    });
    const corrupt = await database.questionPresentation.create({
      data: { userId: userIds.alice, questionId: firstQuestionId, snapshot: { version: 999 } },
    });
    for (const requestedFavorite of [true, false]) {
      const response = await favorite({ presentationId: corrupt.id, favorite: requestedFavorite });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(await database.favorite.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing);
    }
    await database.questionPresentation.delete({ where: { id: corrupt.id } });
  });

  it('enforces uniqueness and reference integrity while cascading user deletion', async () => {
    const aliceFavorite = await database.favorite.findUniqueOrThrow({
      where: { userId_questionId: { userId: userIds.alice, questionId: firstQuestionId } },
    });
    await expect(database.favorite.create({ data: {
      userId: userIds.alice,
      questionId: firstQuestionId,
      presentationId: secondPresentationId,
    } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(database.questionPresentation.delete({
      where: { id: aliceFavorite.presentationId },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.favorite.create({ data: {
      userId: userIds.bob,
      questionId: concurrentQuestionId,
      presentationId: concurrentPresentationId,
    } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.favorite.create({ data: {
      userId: userIds.bob,
      questionId: concurrentQuestionId,
      presentationId: bobPresentationId,
    } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.question.delete({ where: { id: firstQuestionId } })).rejects.toMatchObject({ code: 'P2003' });

    const concurrentPresentation = await database.questionPresentation.findUniqueOrThrow({
      where: { id: concurrentPresentationId },
    });
    const matchingBobPresentation = await database.questionPresentation.create({ data: {
      userId: userIds.bob,
      questionId: concurrentQuestionId,
      snapshot: parsePresentationSnapshot(concurrentPresentation.snapshot),
    } });
    const matchingFavorite = await database.favorite.create({ data: {
      userId: userIds.bob,
      questionId: concurrentQuestionId,
      presentationId: matchingBobPresentation.id,
    } });
    expect(matchingFavorite).toMatchObject({
      userId: userIds.bob,
      questionId: concurrentQuestionId,
      presentationId: matchingBobPresentation.id,
    });
    await database.favorite.delete({ where: { id: matchingFavorite.id } });
    await database.questionPresentation.delete({ where: { id: matchingBobPresentation.id } });

    const cascadeUserId = randomUUID();
    const cascadeToken = randomBytes(32).toString('base64url');
    await database.user.create({ data: {
      id: cascadeUserId,
      telegramUserId: 92_004n,
      sessions: { create: session(cascadeToken) },
    } });
    const sourcePresentation = await database.questionPresentation.findUniqueOrThrow({
      where: { id: firstPresentationId },
    });
    const cascadePresentation = await database.questionPresentation.create({ data: {
      userId: cascadeUserId,
      questionId: sourcePresentation.questionId,
      snapshot: parsePresentationSnapshot(sourcePresentation.snapshot),
    } });
    const response = await favorite({ presentationId: cascadePresentation.id, favorite: true }, cascadeToken);
    expect(response.statusCode).toBe(200);
    expect(await database.favorite.count({ where: { userId: cascadeUserId } })).toBe(1);
    await database.user.delete({ where: { id: cascadeUserId } });
    expect(await database.favorite.count({ where: { userId: cascadeUserId } })).toBe(0);
    expect(await database.questionPresentation.count({ where: { id: cascadePresentation.id } })).toBe(0);
    expect(await database.question.count({ where: { id: firstQuestionId } })).toBe(1);
  });
});

function favoriteBoundary(response: { json(): unknown; headers: Record<string, string | string[] | number | undefined>; body: string }) {
  const parsed = favoriteResponseSchema.parse(response.json());
  expect(Object.keys(parsed).sort()).toEqual(['favorite', 'presentationId']);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).not.toContain('userId');
  expect(response.body).not.toContain('questionId');
  expect(response.body).not.toContain('snapshot');
  expect(response.body).not.toContain('correct');
  expect(response.body).not.toContain('createdAt');
  expect(response.body).not.toContain('updatedAt');
  return parsed;
}
