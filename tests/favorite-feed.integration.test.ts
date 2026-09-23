import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { favoriteFeedResponseSchema, parseFavoriteCursor } from '../packages/database/src/favorite-feed.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `favorite_feed_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
let clock = new Date('2026-09-16T12:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock, randomOffset: () => 0 });
const categoryId = randomUUID();
const tokens = {
  owner: randomBytes(32).toString('base64url'),
  foreign: randomBytes(32).toString('base64url'),
  empty: randomBytes(32).toString('base64url'),
  expired: randomBytes(32).toString('base64url'),
  replacement: randomBytes(32).toString('base64url'),
};
const userIds = {
  owner: randomUUID(), foreign: randomUUID(), empty: randomUUID(),
  expired: randomUUID(), replacement: randomUUID(),
};
const favoriteIds = [
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004',
] as const;
const presentationIds = [
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000003',
  '60000000-0000-4000-8000-000000000004',
] as const;
const expectedOrder = [presentationIds[3], presentationIds[2], presentationIds[1], presentationIds[0]];
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const feed = (path = '/me/favorites', token = tokens.owner) => app.inject({
  method: 'GET', url: path, headers: authorization(token),
});
const setFavorite = (presentationId: string, favorite: boolean, token = tokens.replacement) => app.inject({
  method: 'POST', url: '/practice/favorite',
  headers: { ...authorization(token), 'content-type': 'application/json' },
  payload: JSON.stringify({ presentationId, favorite }),
});
const session = (token: string, expiresAt = new Date(clock.getTime() + 86_400_000)) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(clock.getTime() - 1_000),
  expiresAt,
});

async function createQuestion(textEnglish: string) {
  return database.question.create({
    data: {
      categoryId, vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL', legalCitation: 'Synthetic development citation, not legal guidance',
      textThai: `ไทย ${textEnglish}`, textExamEnglish: `Exam ${textEnglish}`,
      textEnglish, textRussian: `Русский ${textEnglish}`,
      explanationEnglish: `Hidden explanation ${textEnglish}`,
      sourceReference: `Hidden source ${textEnglish}`, imageReference: `Hidden image ${textEnglish}`,
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key, textThai: `ไทย ${key}`, textEnglish: `${textEnglish} choice ${key}`,
        textRussian: `Вариант ${key}`, isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

async function createUser(id: string, token: string, telegramUserId: bigint, expiresAt?: Date) {
  await database.user.create({ data: {
    id, telegramUserId, sessions: { create: session(token, expiresAt) },
  } });
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true },
  );
  await database.category.create({
    data: { id: categoryId, slug: 'favorite-feed-test', nameThai: 'test', nameEnglish: 'test', nameRussian: 'test' },
  });
  await Promise.all([
    createUser(userIds.owner, tokens.owner, 93_001n),
    createUser(userIds.foreign, tokens.foreign, 93_002n),
    createUser(userIds.empty, tokens.empty, 93_003n),
    createUser(userIds.expired, tokens.expired, 93_004n, clock),
    createUser(userIds.replacement, tokens.replacement, 93_005n),
  ]);

  const updatedAt = [
    new Date('2026-09-16T08:00:00.000Z'),
    new Date('2026-09-16T09:00:00.000Z'),
    new Date('2026-09-16T09:00:00.000Z'),
    new Date('2026-09-16T10:00:00.000Z'),
  ];
  for (const [index, presentationId] of presentationIds.entries()) {
    const question = await createQuestion(`Original question ${index + 1}`);
    const presentation = await database.questionPresentation.create({ data: {
      id: presentationId, userId: userIds.owner, questionId: question.id, snapshot: snapshotQuestion(question),
    } });
    const favoriteId = favoriteIds[index];
    const changedAt = updatedAt[index];
    if (!favoriteId || !changedAt) throw new Error('Incomplete favorite feed fixture');
    await database.favorite.create({ data: {
      id: favoriteId, userId: userIds.owner, questionId: question.id,
      presentationId: presentation.id, createdAt: changedAt, updatedAt: changedAt,
    } });
    if (index === 0) {
      const firstChoice = question.choices[0];
      if (!firstChoice) throw new Error('Missing first question choice');
      await database.question.update({ where: { id: question.id }, data: { textEnglish: 'Edited current question' } });
      await database.questionChoice.update({ where: { id: firstChoice.id }, data: { textEnglish: 'Edited current choice' } });
    }
  }

  const foreignQuestion = await createQuestion('Foreign question');
  const foreignPresentation = await database.questionPresentation.create({ data: {
    userId: userIds.foreign, questionId: foreignQuestion.id, snapshot: { version: 999 },
  } });
  await database.favorite.create({ data: {
    userId: userIds.foreign, questionId: foreignQuestion.id, presentationId: foreignPresentation.id,
    updatedAt: new Date('2026-09-16T11:00:00.000Z'),
  } });
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

it('authenticates before strict query parsing and preserves uniform unauthorized responses', async () => {
  for (const token of [undefined, 'invalid', randomBytes(32).toString('base64url'), tokens.expired]) {
    const response = await app.inject({
      method: 'GET', url: '/me/favorites?limit=01&unknown=true',
      headers: token === undefined ? {} : authorization(token),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('rejects unknown, duplicate, signed, fractional, padded, malformed, and out-of-range queries', async () => {
  const malformed = [
    '?limit=', '?limit=0', '?limit=01', '?limit=%2B1', '?limit=-1', '?limit=1.0', '?limit=51',
    '?limit=1&limit=2', '?cursor=', '?cursor=abc%3D', `?cursor=${'a'.repeat(513)}`,
    `?cursor=${Buffer.from('{', 'utf8').toString('base64url')}`, '?unknown=true',
  ];
  for (const query of malformed) {
    const response = await feed(`/me/favorites${query}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Bad Request' });
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('returns an empty strict no-store envelope without mutating favorites', async () => {
  const before = await database.favorite.findMany({ orderBy: { id: 'asc' } });
  const response = await feed('/me/favorites', tokens.empty);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ items: [], nextCursor: null });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(await database.favorite.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
});

it('returns only owned immutable safe snapshots in deterministic recency order', async () => {
  const response = await feed();
  expect(response.statusCode).toBe(200);
  const body = favoriteFeedResponseSchema.parse(response.json());
  expect(body.items.map((item) => item.presentationId)).toEqual(expectedOrder);
  expect(body.nextCursor).toBeNull();
  const oldest = body.items.at(-1);
  expect(oldest?.question.textEnglish).toBe('Original question 1');
  expect(oldest?.question.choices[0]?.textEnglish).toBe('Original question 1 choice A');
  expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
  expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(['favoritedAt', 'presentationId', 'question']);
  expect(Object.keys(body.items[0]?.question ?? {}).sort()).toEqual([
    'choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai',
  ]);
  expect(Object.keys(body.items[0]?.question.choices[0] ?? {}).sort()).toEqual([
    'id', 'key', 'textEnglish', 'textRussian', 'textThai',
  ]);
  for (const hidden of [
    userIds.owner, userIds.foreign, 'Edited current', 'correctChoiceId', 'isCorrect',
    'explanation', 'sourceReference', 'imageReference', 'favoriteId', 'questionId', 'userId',
  ]) expect(response.body).not.toContain(hidden);
});

it('paginates tied timestamps across two pages without gaps or duplicates', async () => {
  const firstResponse = await feed('/me/favorites?limit=2');
  expect(firstResponse.statusCode).toBe(200);
  const first = favoriteFeedResponseSchema.parse(firstResponse.json());
  expect(first.items.map((item) => item.presentationId)).toEqual(expectedOrder.slice(0, 2));
  if (first.nextCursor === null) throw new Error('Missing next cursor');
  expect(parseFavoriteCursor(first.nextCursor)).toEqual({
    v: 1, updatedAt: '2026-09-16T09:00:00.000Z', favoriteId: favoriteIds[2],
  });
  const secondResponse = await feed(`/me/favorites?limit=2&cursor=${first.nextCursor}`);
  expect(secondResponse.statusCode).toBe(200);
  const second = favoriteFeedResponseSchema.parse(secondResponse.json());
  expect(second.items.map((item) => item.presentationId)).toEqual(expectedOrder.slice(2));
  expect(second.nextCursor).toBeNull();
  const returned = [...first.items, ...second.items].map((item) => item.presentationId);
  expect(returned).toEqual(expectedOrder);
  expect(new Set(returned).size).toBe(returned.length);
});

it('moves a replacement anchor to newest with its snapshot and excludes it after unfavorite', async () => {
  const olderQuestion = await createQuestion('Replacement old snapshot');
  const newerQuestion = await createQuestion('Other favorite');
  const oldSnapshot = snapshotQuestion(olderQuestion);
  const [oldPresentation, otherPresentation] = await Promise.all([
    database.questionPresentation.create({ data: {
      userId: userIds.replacement, questionId: olderQuestion.id, snapshot: oldSnapshot,
    } }),
    database.questionPresentation.create({ data: {
      userId: userIds.replacement, questionId: newerQuestion.id, snapshot: snapshotQuestion(newerQuestion),
    } }),
  ]);
  await database.favorite.create({ data: {
    userId: userIds.replacement, questionId: olderQuestion.id, presentationId: oldPresentation.id,
    updatedAt: new Date('2026-09-16T08:00:00.000Z'),
  } });
  await database.favorite.create({ data: {
    userId: userIds.replacement, questionId: newerQuestion.id, presentationId: otherPresentation.id,
    updatedAt: new Date('2026-09-16T09:00:00.000Z'),
  } });
  await database.question.update({ where: { id: olderQuestion.id }, data: { textEnglish: 'Replacement new snapshot' } });
  const updatedQuestion = await database.question.findUniqueOrThrow({
    where: { id: olderQuestion.id }, include: { choices: { orderBy: { key: 'asc' } } },
  });
  const newPresentation = await database.questionPresentation.create({ data: {
    userId: userIds.replacement, questionId: olderQuestion.id, snapshot: snapshotQuestion(updatedQuestion),
  } });

  clock = new Date('2026-09-16T12:30:00.000Z');
  expect((await setFavorite(newPresentation.id, true)).statusCode).toBe(200);
  const beforeRead = await database.favorite.findMany({ where: { userId: userIds.replacement }, orderBy: { id: 'asc' } });
  const replaced = favoriteFeedResponseSchema.parse((await feed('/me/favorites', tokens.replacement)).json());
  expect(replaced.items.map((item) => item.presentationId)).toEqual([newPresentation.id, otherPresentation.id]);
  expect(replaced.items[0]).toMatchObject({
    favoritedAt: clock.toISOString(), question: { textEnglish: 'Replacement new snapshot' },
  });
  expect(await database.favorite.findMany({ where: { userId: userIds.replacement }, orderBy: { id: 'asc' } })).toEqual(beforeRead);

  expect((await setFavorite(newPresentation.id, false)).statusCode).toBe(200);
  const afterRemoval = favoriteFeedResponseSchema.parse((await feed('/me/favorites', tokens.replacement)).json());
  expect(afterRemoval.items.map((item) => item.presentationId)).toEqual([otherPresentation.id]);
});

it('fails the whole request for corrupt snapshots, snapshot IDs, and anchor relationships', async () => {
  const corruptUserId = randomUUID();
  const corruptToken = randomBytes(32).toString('base64url');
  await createUser(corruptUserId, corruptToken, 93_006n);
  const firstQuestion = await createQuestion('Corrupt first');
  const secondQuestion = await createQuestion('Corrupt second');

  const assertInternalError = async () => {
    const response = await feed('/me/favorites?limit=50', corruptToken);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal Server Error' });
    expect(response.headers['cache-control']).toBe('no-store');
  };

  const unsupported = await database.questionPresentation.create({ data: {
    userId: corruptUserId, questionId: firstQuestion.id, snapshot: { version: 999 },
  } });
  const unsupportedFavorite = await database.favorite.create({ data: {
    userId: corruptUserId, questionId: firstQuestion.id, presentationId: unsupported.id,
  } });
  await assertInternalError();
  await database.favorite.delete({ where: { id: unsupportedFavorite.id } });
  await database.questionPresentation.delete({ where: { id: unsupported.id } });

  const mismatchedSnapshot = await database.questionPresentation.create({ data: {
    userId: corruptUserId, questionId: firstQuestion.id, snapshot: snapshotQuestion(secondQuestion),
  } });
  const mismatchedFavorite = await database.favorite.create({ data: {
    userId: corruptUserId, questionId: firstQuestion.id, presentationId: mismatchedSnapshot.id,
  } });
  await assertInternalError();
  await database.favorite.delete({ where: { id: mismatchedFavorite.id } });
  await database.questionPresentation.delete({ where: { id: mismatchedSnapshot.id } });

  const foreignPresentation = await database.questionPresentation.create({ data: {
    userId: userIds.foreign, questionId: firstQuestion.id, snapshot: snapshotQuestion(firstQuestion),
  } });
  const corruptFavoriteId = randomUUID();
  const raw = new pg.Client({ connectionString: isolatedUrl.toString() });
  await raw.connect();
  try {
    await raw.query('ALTER TABLE "Favorite" DISABLE TRIGGER ALL');
    try {
      await raw.query(
        'INSERT INTO "Favorite" ("id", "userId", "questionId", "presentationId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $5)',
        [corruptFavoriteId, corruptUserId, firstQuestion.id, foreignPresentation.id, clock],
      );
    } finally {
      await raw.query('ALTER TABLE "Favorite" ENABLE TRIGGER ALL');
    }
    await assertInternalError();
  } finally {
    await raw.query('DELETE FROM "Favorite" WHERE "id" = $1', [corruptFavoriteId]);
    await raw.end();
  }
  await database.questionPresentation.delete({ where: { id: foreignPresentation.id } });
  expect((await feed('/me/favorites', corruptToken)).json()).toEqual({ items: [], nextCursor: null });
});
