import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { createApi } from '../apps/api/src/index.ts';
import { parseCandidateBatch } from '../tools/content/candidates.ts';
import { mapCandidateQuestion } from '../tools/content/candidate-import.ts';
import { parsePresentationSnapshot, presentationResponseSchema, snapshotQuestion } from '../packages/database/src/presentation.ts';
import { answerResponseSchema } from '../packages/database/src/answer.ts';
import { validateTeachingInputs } from '../packages/database/src/teaching.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `teaching_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const db = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-10-24T12:00:00.000Z');
const app = createApi({ database: db, botToken: 'synthetic', now: () => now, randomOffset: () => 0 });
const categoryId = randomUUID();
const conceptId = randomUUID();
const userId = randomUUID();
const token = randomBytes(32).toString('base64url');
const headers = { authorization: `Bearer ${token}` };
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as unknown;
const inputs = validateTeachingInputs({
  pack: read('content/imports/launch-20261023-bilingual-teaching.json'), review: read('.agent/reviews/TASK-084-content-review-01.json'),
  car: read('content/imports/launch-20261016-car-candidates.json'), motorcycle: read('content/imports/launch-20261016-motorcycle-candidates.json'),
  stems: read('content/imports/launch-20261021-russian-stems.json'),
});
const batch = parseCandidateBatch(inputs.car);
const original = batch.questions[0]!;
const entry = inputs.pack.entries.find(({ batchId, externalId }) => batchId === batch.batchId && externalId === original.externalId)!;
const mapped = mapCandidateQuestion(batch, original, categoryId, conceptId);

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true });
  await db.category.create({ data: { id: categoryId, slug: categoryId, nameEnglish: 'test', nameThai: 'test', nameRussian: 'test' } });
  await db.concept.create({ data: { id: conceptId, slug: conceptId, nameEnglish: 'test', nameThai: 'test', nameRussian: 'test' } });
  await db.user.create({ data: {
    id: userId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`), selectedVehicleType: 'CAR',
    sessions: { create: { tokenHash: createHash('sha256').update(token).digest('hex'), createdAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 3600000) } },
  } });
  await db.question.create({ data: {
    ...mapped.question, active: true, verificationStatus: 'VERIFIED', textRussian: entry.textRussian,
    choices: { create: mapped.choices.map(({ id, key, textThai, textEnglish, textRussian, isCorrect }) => ({ id, key, textThai, textEnglish, textRussian, isCorrect })) },
  } });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

it('persists only new enrichment, preserves historical snapshots/bank rows and maintains HTTP secrecy and answer accounting', async () => {
  const sourceBefore = await db.question.findUniqueOrThrow({ where: { id: mapped.question.id }, include: { choices: { orderBy: { key: 'asc' } } } });
  const legacySnapshot = snapshotQuestion(sourceBefore);
  const legacy = await db.questionPresentation.create({ data: { userId, questionId: sourceBefore.id, conceptId, snapshot: legacySnapshot } });
  const response = await app.inject({ method: 'POST', url: '/practice/next', headers });
  expect(response.statusCode).toBe(200);
  const dto = presentationResponseSchema.parse(response.json());
  const stored = await db.questionPresentation.findUniqueOrThrow({ where: { id: dto.presentationId } });
  const snapshot = parsePresentationSnapshot(stored.snapshot);
  expect(snapshot.teaching?.statute?.section).toBe('33');
  expect(snapshot.explanationRussian).toBe(entry.explanationRussian);
  expect(snapshot.question).toEqual(dto.question);
  expect(snapshot.question.choices.map(({ textRussian }) => textRussian)).toEqual(entry.choices.map(({ textRussian }) => textRussian));
  for (const hidden of ['teaching', 'correctChoiceId', 'explanation', 'whyOthersWrong', 'guidanceCitation', 'safetyReason', 'statute']) expect(response.body).not.toContain(hidden);
  expect(await db.question.findUniqueOrThrow({ where: { id: sourceBefore.id }, include: { choices: { orderBy: { key: 'asc' } } } })).toEqual(sourceBefore);
  expect((await db.questionPresentation.findUniqueOrThrow({ where: { id: legacy.id } })).snapshot).toEqual(legacy.snapshot);

  const wrongChoiceId = snapshot.question.choices.find(({ id }) => id !== snapshot.correctChoiceId)!.id;
  const answer = await app.inject({ method: 'POST', url: '/practice/answer', headers, payload: { presentationId: dto.presentationId, choiceId: wrongChoiceId } });
  expect(answer.statusCode).toBe(200);
  expect(answerResponseSchema.parse(answer.json())).toMatchObject({ isCorrect: false, explanationRussian: entry.explanationRussian });
  expect(answer.body).not.toContain('teaching');
  expect(await db.conceptLearningState.findUniqueOrThrow({ where: { userId_conceptId: { userId, conceptId } } }))
    .toMatchObject({ practiceAnswered: 1, practiceCorrect: 0 });
  const retry = await app.inject({ method: 'POST', url: '/practice/retry-mistake', headers, payload: { presentationId: dto.presentationId } });
  expect(retry.statusCode).toBe(200);
  const retryDto = presentationResponseSchema.parse(retry.json());
  const retryRow = await db.questionPresentation.findUniqueOrThrow({ where: { id: retryDto.presentationId } });
  expect(parsePresentationSnapshot(retryRow.snapshot).teaching).toEqual(snapshot.teaching);
  const daily = await app.inject({ method: 'POST', url: '/practice/daily', headers });
  expect(daily.statusCode).toBe(200);
  const dailyBody: unknown = daily.json();
  const { dailyPracticeResponseSchema } = await import('../packages/database/src/daily-practice.ts');
  const dailyDto = dailyPracticeResponseSchema.parse(dailyBody);
  const dailyRow = await db.questionPresentation.findUniqueOrThrow({ where: { id: dailyDto.presentationId } });
  expect(parsePresentationSnapshot(dailyRow.snapshot).teaching).toEqual(snapshot.teaching);
  expect(daily.body).not.toContain('teaching');
  // Editing the bank later cannot change either saved presentation or its returned feedback.
  await db.question.update({ where: { id: sourceBefore.id }, data: { textEnglish: 'Later source drift' } });
  expect((await db.questionPresentation.findUniqueOrThrow({ where: { id: stored.id } })).snapshot).toEqual(stored.snapshot);
  const drifted = await app.inject({ method: 'POST', url: '/practice/next', headers });
  expect(drifted.statusCode).toBe(200);
  const driftedDto = presentationResponseSchema.parse(drifted.json());
  const driftedRow = await db.questionPresentation.findUniqueOrThrow({ where: { id: driftedDto.presentationId } });
  expect(parsePresentationSnapshot(driftedRow.snapshot).teaching).toBeUndefined();
  await db.question.update({ where: { id: sourceBefore.id }, data: { textEnglish: sourceBefore.textEnglish } });
});
