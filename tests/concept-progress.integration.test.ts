import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import {
  conceptProgressResponseSchema,
  parseConceptProgressCursor,
} from '../packages/database/src/concept-progress.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: databaseUrl });
const databaseName = `concept_progress_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const db = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-29T14:00:00.000Z');
const app = createApi({ database: db, botToken: 'synthetic', now: () => now });
const ownerId = randomUUID();
const foreignId = randomUUID();
const emptyId = randomUUID();
const ownerToken = randomBytes(32).toString('base64url');
const foreignToken = randomBytes(32).toString('base64url');
const emptyToken = randomBytes(32).toString('base64url');
const conceptIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
] as const;
const activity = {
  tied: new Date('2026-09-29T09:00:00.000Z'),
  exam: new Date('2026-09-29T10:00:00.000Z'),
  practice: new Date('2026-09-29T11:00:00.000Z'),
  mixedPractice: new Date('2026-09-29T08:00:00.000Z'),
  mixedExam: new Date('2026-09-29T12:00:00.000Z'),
};
const expectedOrder = [conceptIds[4], conceptIds[3], conceptIds[2], conceptIds[1], conceptIds[0]];

const session = (token: string) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(now.getTime() - 1000),
  expiresAt: new Date(now.getTime() + 60_000),
});
const request = (path = '/me/concept-progress', authorization: string | null = `Bearer ${ownerToken}`) => app.inject({
  method: 'GET', url: path, headers: authorization === null ? {} : { authorization },
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true,
  });
  await db.user.createMany({ data: [
    { id: ownerId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`) },
    { id: foreignId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`) },
    { id: emptyId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`) },
  ] });
  await db.session.createMany({ data: [
    { userId: ownerId, ...session(ownerToken) },
    { userId: foreignId, ...session(foreignToken) },
    { userId: emptyId, ...session(emptyToken) },
  ] });
  await db.concept.createMany({ data: conceptIds.map((id, index) => ({
    id,
    slug: `concept-${index + 1}`,
    nameThai: `แนวคิด ${index + 1}`,
    nameEnglish: `Concept ${index + 1}`,
    nameRussian: `Концепция ${index + 1}`,
  })) });
  await db.conceptLearningState.createMany({ data: [
    { userId: ownerId, conceptId: conceptIds[0], practiceAnswered: 1, practiceCorrect: 1, lastPracticeAt: activity.tied },
    { userId: ownerId, conceptId: conceptIds[1], examAnswered: 2, examCorrect: 1, lastExamAt: activity.tied },
    { userId: ownerId, conceptId: conceptIds[2], examAnswered: 3, examCorrect: 2, lastExamAt: activity.exam },
    { userId: ownerId, conceptId: conceptIds[3], practiceAnswered: 3, practiceCorrect: 1, lastPracticeAt: activity.practice },
    {
      userId: ownerId, conceptId: conceptIds[4], practiceAnswered: 2, practiceCorrect: 1,
      examAnswered: 1, examCorrect: 0, lastPracticeAt: activity.mixedPractice, lastExamAt: activity.mixedExam,
    },
    { userId: foreignId, conceptId: conceptIds[4], practiceAnswered: 9, practiceCorrect: 9, lastPracticeAt: new Date('2026-09-29T13:00:00.000Z') },
  ] });
  await db.concept.update({ where: { id: conceptIds[3] }, data: {
    slug: 'current-practice-name', nameThai: 'ชื่อปัจจุบัน', nameEnglish: 'Current practice name', nameRussian: 'Текущее имя',
  } });
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('GET /me/concept-progress', () => {
  it('authenticates before query parsing and keeps every matched response private', async () => {
    for (const authorization of [null, 'Bearer invalid', `Bearer ${randomBytes(32).toString('base64url')}`]) {
      const response = await request('/me/concept-progress?limit=01&unknown=true', authorization);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    await db.session.updateMany({ where: { userId: ownerId }, data: { expiresAt: now } });
    expect((await request('/me/concept-progress?limit=01')).json()).toEqual({ error: 'Unauthorized' });
    await db.session.updateMany({ where: { userId: ownerId }, data: { expiresAt: new Date(now.getTime() + 60_000) } });
  });

  it('rejects malformed queries and cursors with the stable no-store response', async () => {
    for (const query of [
      '?limit=', '?limit=0', '?limit=01', '?limit=%2B1', '?limit=-1', '?limit=1.0', '?limit=51',
      '?limit=1&limit=2', '?cursor=', '?cursor=abc%3D', `?cursor=${'a'.repeat(513)}`,
      `?cursor=${Buffer.from('{').toString('base64url')}`, '?unknown=true',
    ]) {
      const response = await request(`/me/concept-progress${query}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('returns an exact empty response for a learner without state', async () => {
    const response = await request('/me/concept-progress', `Bearer ${emptyToken}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns isolated current labels and exact practice, exam, mixed, and rounded facts without mutation', async () => {
    const before = await db.conceptLearningState.findMany({ where: { userId: ownerId }, orderBy: { conceptId: 'asc' } });
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = conceptProgressResponseSchema.parse(response.json());
    expect(body.items.map(({ conceptId }) => conceptId)).toEqual(expectedOrder);
    expect(body.nextCursor).toBeNull();
    expect(body.items.find(({ conceptId }) => conceptId === conceptIds[3])).toMatchObject({
      slug: 'current-practice-name', nameThai: 'ชื่อปัจจุบัน', nameEnglish: 'Current practice name', nameRussian: 'Текущее имя',
      practice: { answered: 3, correct: 1, incorrect: 2, lastAnsweredAt: activity.practice.toISOString() },
      exam: { answered: 0, correct: 0, incorrect: 0, lastAnsweredAt: null },
      total: { answered: 3, correct: 1, incorrect: 2, accuracyPercent: 33 },
      lastActivityAt: activity.practice.toISOString(),
    });
    expect(body.items.find(({ conceptId }) => conceptId === conceptIds[2])).toMatchObject({
      practice: { answered: 0, correct: 0, incorrect: 0, lastAnsweredAt: null },
      exam: { answered: 3, correct: 2, incorrect: 1, lastAnsweredAt: activity.exam.toISOString() },
      total: { answered: 3, correct: 2, incorrect: 1, accuracyPercent: 67 },
    });
    expect(body.items[0]).toMatchObject({
      practice: { answered: 2, correct: 1, incorrect: 1, lastAnsweredAt: activity.mixedPractice.toISOString() },
      exam: { answered: 1, correct: 0, incorrect: 1, lastAnsweredAt: activity.mixedExam.toISOString() },
      total: { answered: 3, correct: 1, incorrect: 2, accuracyPercent: 33 },
      lastActivityAt: activity.mixedExam.toISOString(),
    });
    expect(response.body).not.toContain(ownerId);
    expect(response.body).not.toContain(foreignId);
    expect(response.body).not.toContain('userId');
    expect(response.body).not.toContain('mastery');
    expect(await db.conceptLearningState.findMany({ where: { userId: ownerId }, orderBy: { conceptId: 'asc' } })).toEqual(before);
  });

  it('traverses tied ordering in exactly two pages without duplicates or omissions', async () => {
    const firstResponse = await request('/me/concept-progress?limit=3');
    expect(firstResponse.statusCode).toBe(200);
    const first = conceptProgressResponseSchema.parse(firstResponse.json());
    expect(first.items.map(({ conceptId }) => conceptId)).toEqual(expectedOrder.slice(0, 3));
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error('Missing concept progress cursor');
    expect(parseConceptProgressCursor(first.nextCursor)).toEqual({
      v: 1, lastActivityAt: activity.exam.toISOString(), conceptId: conceptIds[2],
    });
    const secondResponse = await request(`/me/concept-progress?limit=3&cursor=${first.nextCursor}`);
    expect(secondResponse.statusCode).toBe(200);
    const second = conceptProgressResponseSchema.parse(secondResponse.json());
    expect(second.items.map(({ conceptId }) => conceptId)).toEqual(expectedOrder.slice(3));
    expect(second.nextCursor).toBeNull();
    const returned = [...first.items, ...second.items].map(({ conceptId }) => conceptId);
    expect(returned).toEqual(expectedOrder);
    expect(new Set(returned).size).toBe(returned.length);
  });

  it('fails closed for corrupt stored counts and restores the database constraint', async () => {
    await db.$executeRawUnsafe('ALTER TABLE "ConceptLearningState" DROP CONSTRAINT "ConceptLearningState_practice_counts_valid"');
    try {
      await db.conceptLearningState.update({
        where: { userId_conceptId: { userId: ownerId, conceptId: conceptIds[3] } },
        data: { practiceCorrect: 4 },
      });
      const response = await request();
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await db.conceptLearningState.update({
        where: { userId_conceptId: { userId: ownerId, conceptId: conceptIds[3] } },
        data: { practiceCorrect: 1 },
      });
      await db.$executeRawUnsafe(`
        ALTER TABLE "ConceptLearningState"
        ADD CONSTRAINT "ConceptLearningState_practice_counts_valid" CHECK (
          "practiceAnswered" >= 0
          AND "practiceCorrect" >= 0
          AND "practiceCorrect" <= "practiceAnswered"
        )
      `);
    }
    expect((await request()).statusCode).toBe(200);
  });
});
