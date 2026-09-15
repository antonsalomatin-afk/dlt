import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { historyResponseSchema, parseHistoryCursor } from '../packages/database/src/history.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `history_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const db = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-15T12:00:00.000Z');
const app = createApi({ database: db, botToken: 'synthetic', now: () => now });
const categoryId = randomUUID();
const userId = randomUUID();
const foreignUserId = randomUUID();
const emptyUserId = randomUUID();
const token = randomBytes(32).toString('base64url');
const foreignToken = randomBytes(32).toString('base64url');
const emptyToken = randomBytes(32).toString('base64url');
const headers = { authorization: `Bearer ${token}` };
const presentationIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
] as const;
const attemptIds = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
] as const;
const expectedPresentationOrder = [presentationIds[3], presentationIds[2], presentationIds[1], presentationIds[0]];
let questionId = '';
let correctChoiceId = '';
let wrongChoiceId = '';

const session = (rawToken: string) => ({
  tokenHash: createHash('sha256').update(rawToken).digest('hex'),
  createdAt: new Date(now.getTime() - 1000),
  expiresAt: new Date(now.getTime() + 60_000),
});
const history = (path = '/me/history', authorization = headers.authorization) => app.inject({
  method: 'GET', url: path, headers: { authorization },
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true,
  });
  await db.category.create({ data: {
    id: categoryId, slug: categoryId, nameThai: 'test', nameEnglish: 'test', nameRussian: 'test',
  } });
  const question = await db.question.create({
    data: {
      categoryId, vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL',
      textThai: 'คำถามเดิม', textExamEnglish: 'Original exam wording', textEnglish: 'Original wording',
      textRussian: 'Исходный вопрос', explanationThai: 'คำอธิบาย', explanationEnglish: 'Original explanation',
      explanationRussian: 'Объяснение', trapExplanationThai: 'กับดัก', trapExplanationEnglish: 'Original trap',
      trapExplanationRussian: 'Ловушка', sourceReference: 'Hidden source', imageReference: 'Hidden image',
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key, textThai: `ไทย ${key}`, textEnglish: `Original choice ${key}`, textRussian: `Вариант ${key}`,
        isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
  questionId = question.id;
  const snapshot = snapshotQuestion(question);
  correctChoiceId = snapshot.correctChoiceId;
  const wrongChoice = snapshot.question.choices.find((choice) => choice.id !== correctChoiceId);
  if (!wrongChoice) throw new Error('Missing wrong test choice');
  wrongChoiceId = wrongChoice.id;
  await db.user.create({ data: {
    id: userId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`),
    sessions: { create: session(token) },
  } });
  await db.user.create({ data: {
    id: foreignUserId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`),
    sessions: { create: session(foreignToken) },
  } });
  await db.user.create({ data: {
    id: emptyUserId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`),
    sessions: { create: session(emptyToken) },
  } });
  const submittedAt = [
    new Date('2026-09-15T08:00:00.000Z'),
    new Date('2026-09-15T09:00:00.000Z'),
    new Date('2026-09-15T09:00:00.000Z'),
    new Date('2026-09-15T10:00:00.000Z'),
  ];
  for (const [index, presentationId] of presentationIds.entries()) {
    const attemptId = attemptIds[index];
    const submitted = submittedAt[index];
    if (!attemptId || !submitted) throw new Error('Incomplete history test fixture');
    const selectedChoiceId = index === 0 ? wrongChoiceId : correctChoiceId;
    await db.questionPresentation.create({ data: {
      id: presentationId, userId, questionId, createdAt: new Date(submitted.getTime()), snapshot,
      answer: { create: {
        id: attemptId, selectedChoiceId, isCorrect: selectedChoiceId === correctChoiceId,
        submittedAt: submitted,
      } },
    } });
  }
  await db.questionPresentation.create({ data: { userId, questionId, snapshot } });
  await db.questionPresentation.create({ data: {
    userId: foreignUserId, questionId, snapshot,
    answer: { create: { selectedChoiceId: correctChoiceId, isCorrect: true, submittedAt: new Date('2026-09-15T11:00:00.000Z') } },
  } });
  await db.question.update({ where: { id: questionId }, data: {
    textEnglish: 'Edited source wording', explanationEnglish: 'Edited source explanation', sourceReference: 'Edited hidden source',
  } });
  await db.questionChoice.update({ where: { id: wrongChoiceId }, data: { textEnglish: 'Edited source choice' } });
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

it('authenticates before strict query parsing and preserves the uniform unauthorized response', async () => {
  for (const authorization of [undefined, 'Bearer invalid', `Bearer ${randomBytes(32).toString('base64url')}`]) {
    const response = await app.inject({
      method: 'GET', url: '/me/history?limit=01&extra=true',
      headers: authorization === undefined ? {} : { authorization },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });
    expect(response.headers['cache-control']).toBe('no-store');
  }
  await db.session.updateMany({ where: { userId }, data: { expiresAt: now } });
  expect((await history('/me/history?limit=01')).json()).toEqual({ error: 'Unauthorized' });
  await db.session.updateMany({ where: { userId }, data: { expiresAt: new Date(now.getTime() + 60_000) } });
  await db.session.deleteMany({ where: { userId: foreignUserId } });
  const revoked = await history('/me/history?limit=01', `Bearer ${foreignToken}`);
  expect(revoked.statusCode).toBe(401);
  expect(revoked.json()).toEqual({ error: 'Unauthorized' });
});

it('rejects malformed and duplicate query values with the stable bad-request response', async () => {
  const malformed = [
    '?limit=', '?limit=0', '?limit=01', '?limit=%2B1', '?limit=-1', '?limit=1.0', '?limit=51',
    '?limit=1&limit=2', '?cursor=', '?cursor=abc%3D', `?cursor=${'a'.repeat(513)}`,
    `?cursor=${Buffer.from('{', 'utf8').toString('base64url')}`, '?unknown=true',
  ];
  for (const query of malformed) {
    const response = await history(`/me/history${query}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Bad Request' });
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('returns a strict empty envelope for an authenticated user without submissions', async () => {
  const response = await history('/me/history', `Bearer ${emptyToken}`);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ items: [], nextCursor: null });
  expect(response.headers['cache-control']).toBe('no-store');
});

it('returns only owned submitted snapshots in deterministic order after source edits', async () => {
  const response = await history();
  expect(response.statusCode).toBe(200);
  const body = historyResponseSchema.parse(response.json());
  expect(body.items.map((item) => item.presentationId)).toEqual(expectedPresentationOrder);
  expect(body.nextCursor).toBeNull();
  expect(body.items).toHaveLength(4);
  expect(body.items[0]?.question.textEnglish).toBe('Original wording');
  expect(body.items[0]?.question.choices.map((choice) => choice.textEnglish)).toEqual([
    'Original choice A', 'Original choice B', 'Original choice C', 'Original choice D',
  ]);
  expect(body.items[0]).toMatchObject({
    correctChoiceId, selectedChoiceId: correctChoiceId, isCorrect: true,
    explanationThai: 'คำอธิบาย', explanationEnglish: 'Original explanation', explanationRussian: 'Объяснение',
    trapExplanationThai: 'กับดัก', trapExplanationEnglish: 'Original trap', trapExplanationRussian: 'Ловушка',
  });
  expect(body.items.at(-1)).toMatchObject({ selectedChoiceId: wrongChoiceId, isCorrect: false });
  expect(response.body).not.toContain('Edited source');
  expect(response.body).not.toContain(foreignUserId);
  expect(response.body).not.toContain('userId');
  expect(response.body).not.toContain('attemptId');
  expect(response.body).not.toContain('Hidden source');
  expect(response.body).not.toContain('Hidden image');
});

it('paginates both unchanged-data pages without duplicates using the ordering tuple', async () => {
  const firstResponse = await history('/me/history?limit=2');
  expect(firstResponse.statusCode).toBe(200);
  const first = historyResponseSchema.parse(firstResponse.json());
  expect(first.items.map((item) => item.presentationId)).toEqual(expectedPresentationOrder.slice(0, 2));
  expect(first.nextCursor).not.toBeNull();
  if (first.nextCursor === null) throw new Error('Missing next cursor');
  expect(parseHistoryCursor(first.nextCursor)).toEqual({
    v: 1, submittedAt: '2026-09-15T09:00:00.000Z', attemptId: attemptIds[2],
  });
  const secondResponse = await history(`/me/history?limit=2&cursor=${first.nextCursor}`);
  expect(secondResponse.statusCode).toBe(200);
  const second = historyResponseSchema.parse(secondResponse.json());
  expect(second.items.map((item) => item.presentationId)).toEqual(expectedPresentationOrder.slice(2));
  expect(second.nextCursor).toBeNull();
  const returned = [...first.items, ...second.items].map((item) => item.presentationId);
  expect(returned).toEqual(expectedPresentationOrder);
  expect(new Set(returned).size).toBe(returned.length);
});

it('fails the whole request with the stable internal-error response for corrupt stored history', async () => {
  const assertInternalError = async () => {
    const response = await history('/me/history?limit=50');
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal Server Error' });
    expect(response.headers['cache-control']).toBe('no-store');
  };
  const corruptPresentation = await db.questionPresentation.create({ data: {
    userId, questionId, snapshot: { version: 999 },
    answer: { create: { selectedChoiceId: correctChoiceId, isCorrect: true, submittedAt: new Date('2026-09-15T11:30:00.000Z') } },
  } });
  await assertInternalError();
  await db.questionPresentation.delete({ where: { id: corruptPresentation.id } });

  await db.answerAttempt.update({ where: { id: attemptIds[3] }, data: { selectedChoiceId: randomUUID() } });
  await assertInternalError();
  await db.answerAttempt.update({ where: { id: attemptIds[3] }, data: { selectedChoiceId: correctChoiceId } });

  await db.answerAttempt.update({ where: { id: attemptIds[3] }, data: { isCorrect: false } });
  await assertInternalError();
  await db.answerAttempt.update({ where: { id: attemptIds[3] }, data: { isCorrect: true } });
  expect((await history('/me/history?limit=50')).statusCode).toBe(200);
});
