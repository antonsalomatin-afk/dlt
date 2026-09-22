import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { presentationResponseSchema } from '../packages/database/src/presentation.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
const databaseName = `practice_concept_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-22T12:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic', now: () => now, randomOffset: () => 0 });
let databaseCreated = false;

const token = randomBytes(32).toString('base64url');
const userId = randomUUID();
const categoryIds = { rules: randomUUID(), signs: randomUUID() };
const conceptIds = {
  stopping: randomUUID(),
  visibility: randomUUID(),
  motorcycleOnly: randomUUID(),
  ineligible: randomUUID(),
  empty: randomUUID(),
};
const questionIds = {
  stopping: '10000000-0000-4000-8000-000000000001',
  visibility: '20000000-0000-4000-8000-000000000001',
  ungrouped: '30000000-0000-4000-8000-000000000001',
};

const next = (payload: unknown) => app.inject({
  method: 'POST', url: '/practice/next',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  payload: JSON.stringify(payload),
});
const nextWithoutBody = () => app.inject({
  method: 'POST', url: '/practice/next', headers: { authorization: `Bearer ${token}` },
});

async function createQuestion(input: {
  id?: string;
  conceptId?: string;
  categoryId: string;
  vehicleType: 'CAR' | 'MOTORCYCLE';
  active?: boolean;
  verificationStatus?: 'DRAFT' | 'VERIFIED' | 'REJECTED';
  textEnglish: string;
}) {
  return database.question.create({ data: {
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.conceptId === undefined ? {} : { conceptId: input.conceptId }),
    categoryId: input.categoryId,
    vehicleType: input.vehicleType,
    active: input.active ?? true,
    verificationStatus: input.verificationStatus ?? 'VERIFIED',
    sourceType: 'ORIGINAL',
    textEnglish: input.textEnglish,
    explanationEnglish: `${input.textEnglish} explanation`,
    trapExplanationEnglish: `${input.textEnglish} trap`,
    sourceReference: `${input.textEnglish} source`,
    imageReference: `${input.textEnglish} image`,
    choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
      key, textEnglish: `${input.textEnglish} choice ${key}`, isCorrect: key === 'A',
    })) },
  } });
}

async function presentationCount() {
  return database.questionPresentation.count({ where: { userId } });
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', timeout: 120_000, windowsHide: true },
  );
  await database.user.create({ data: {
    id: userId, telegramUserId: 91_000n, selectedVehicleType: 'CAR',
    sessions: { create: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      createdAt: new Date(now.getTime() - 1_000), expiresAt: new Date(now.getTime() + 60_000),
    } },
  } });
  await database.category.createMany({ data: [
    { id: categoryIds.rules, slug: 'concept-rules', nameThai: 'กฎ', nameEnglish: 'Rules', nameRussian: 'Правила' },
    { id: categoryIds.signs, slug: 'concept-signs', nameThai: 'ป้าย', nameEnglish: 'Signs', nameRussian: 'Знаки' },
  ] });
  await database.concept.createMany({ data: [
    { id: conceptIds.stopping, slug: 'concept-stopping', nameThai: 'การหยุด', nameEnglish: 'Stopping', nameRussian: 'Остановка' },
    { id: conceptIds.visibility, slug: 'concept-visibility', nameThai: 'ทัศนวิสัย', nameEnglish: 'Visibility', nameRussian: 'Видимость' },
    { id: conceptIds.motorcycleOnly, slug: 'concept-motorcycle', nameThai: 'มอไซค์', nameEnglish: 'Motorcycle only', nameRussian: 'Мотоцикл' },
    { id: conceptIds.ineligible, slug: 'concept-ineligible', nameThai: 'ไม่พร้อม', nameEnglish: 'Ineligible', nameRussian: 'Недоступно' },
    { id: conceptIds.empty, slug: 'concept-empty', nameThai: 'ว่าง', nameEnglish: 'Empty', nameRussian: 'Пусто' },
  ] });

  await createQuestion({ id: questionIds.stopping, conceptId: conceptIds.stopping, categoryId: categoryIds.rules, vehicleType: 'CAR', textEnglish: 'Stopping rule' });
  await createQuestion({ id: questionIds.visibility, conceptId: conceptIds.visibility, categoryId: categoryIds.signs, vehicleType: 'CAR', textEnglish: 'Visibility rule' });
  await createQuestion({ id: questionIds.ungrouped, categoryId: categoryIds.rules, vehicleType: 'CAR', textEnglish: 'Ungrouped rule' });
  await createQuestion({ conceptId: conceptIds.motorcycleOnly, categoryId: categoryIds.rules, vehicleType: 'MOTORCYCLE', textEnglish: 'Motorcycle rule' });
  await createQuestion({ conceptId: conceptIds.ineligible, categoryId: categoryIds.rules, vehicleType: 'CAR', active: false, textEnglish: 'Inactive rule' });
  await createQuestion({ conceptId: conceptIds.ineligible, categoryId: categoryIds.rules, vehicleType: 'CAR', verificationStatus: 'DRAFT', textEnglish: 'Draft rule' });
  await createQuestion({ conceptId: conceptIds.ineligible, categoryId: categoryIds.rules, vehicleType: 'CAR', verificationStatus: 'REJECTED', textEnglish: 'Rejected rule' });
}, 150_000);

afterAll(async () => {
  await app.close();
  try {
    await database.$disconnect();
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally { await admin.end(); }
});

describe('POST /practice/next concept selector', () => {
  it('rejects malformed, extra and combined selectors without creating presentations', async () => {
    const before = await presentationCount();
    for (const payload of [
      { conceptId: null },
      { conceptId: 'not-a-uuid' },
      { conceptId: [conceptIds.stopping, conceptIds.stopping] },
      { conceptId: conceptIds.stopping, unknown: true },
      { conceptId: conceptIds.stopping, categoryId: categoryIds.rules },
    ]) {
      const response = await next(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const duplicate = await app.inject({
      method: 'POST', url: '/practice/next',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: `{"conceptId":"${conceptIds.stopping}","conceptId":"${conceptIds.visibility}"}`,
    });
    expect(duplicate.statusCode).toBe(400);
    expect(await presentationCount()).toBe(before);
  });

  it('keeps invalid credentials unauthorized whatever the concept selector', async () => {
    const before = await presentationCount();
    for (const headers of [{ 'content-type': 'application/json' }, { authorization: 'Bearer invalid', 'content-type': 'application/json' }]) {
      const response = await app.inject({
        method: 'POST', url: '/practice/next', headers, payload: JSON.stringify({ conceptId: conceptIds.stopping }),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
    }
    expect(await presentationCount()).toBe(before);
  });

  it('delivers the accepted safe snapshot for one requested concept', async () => {
    const before = await presentationCount();
    const response = await next({ conceptId: conceptIds.stopping });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = presentationResponseSchema.parse(response.json());
    expect(body.question.id).toBe(questionIds.stopping);
    expect(body.question.textEnglish).toBe('Stopping rule');
    expect(await presentationCount()).toBe(before + 1);
    const raw = JSON.stringify(response.json());
    for (const hidden of ['isCorrect', 'correctChoiceId', 'explanation', 'trap', 'source', 'image', 'conceptId']) {
      expect(raw).not.toContain(hidden);
    }
    const stored = await database.questionPresentation.findFirstOrThrow({
      where: { userId, questionId: questionIds.stopping }, orderBy: { createdAt: 'desc' },
    });
    expect(stored.id).toBe(body.presentationId);

    const other = await next({ conceptId: conceptIds.visibility });
    expect(other.statusCode).toBe(200);
    expect(presentationResponseSchema.parse(other.json()).question.id).toBe(questionIds.visibility);
  });

  it('returns the uniform private 404 for concepts with nothing eligible for this learner', async () => {
    const before = await presentationCount();
    for (const conceptId of [
      conceptIds.motorcycleOnly,
      conceptIds.ineligible,
      conceptIds.empty,
      randomUUID(),
    ]) {
      const response = await next({ conceptId });
      expect(response.statusCode, conceptId).toBe(404);
      expect(response.json()).toEqual({ error: 'No questions available' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await presentationCount()).toBe(before);
  });

  it('leaves unfiltered and category-filtered delivery unchanged', async () => {
    const unfiltered = await nextWithoutBody();
    expect(unfiltered.statusCode).toBe(200);
    expect(presentationResponseSchema.parse(unfiltered.json()).question.id).toBe(questionIds.stopping);

    const empty = await next({});
    expect(empty.statusCode).toBe(200);
    expect(presentationResponseSchema.parse(empty.json()).question.id).toBe(questionIds.stopping);

    const byCategory = await next({ categoryId: categoryIds.signs });
    expect(byCategory.statusCode).toBe(200);
    expect(presentationResponseSchema.parse(byCategory.json()).question.id).toBe(questionIds.visibility);
  });

  it('serves an immutable concept snapshot after the source question changes', async () => {
    const response = await next({ conceptId: conceptIds.stopping });
    const body = presentationResponseSchema.parse(response.json());
    await database.question.update({ where: { id: questionIds.stopping }, data: { textEnglish: 'Edited stopping rule' } });
    const stored = await database.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
    expect(JSON.stringify(stored.snapshot)).toContain('Stopping rule');
    expect(JSON.stringify(stored.snapshot)).not.toContain('Edited stopping rule');
    await database.question.update({ where: { id: questionIds.stopping }, data: { textEnglish: 'Stopping rule' } });
  });
});
