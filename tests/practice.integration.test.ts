import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { parsePresentationSnapshot, presentationResponseSchema } from '../packages/database/src/presentation.ts';
import { createApi } from '../apps/api/src/index.ts';
import { answerResponseSchema } from '../packages/database/src/answer.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `practice_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const db = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-10T12:00:00Z');
const app = createApi({ database: db, botToken: 'synthetic', now: () => now });
const categoryId = randomUUID();
const userId = randomUUID();
const token = randomBytes(32).toString('base64url');
const headers = { authorization: `Bearer ${token}` };
const questions: string[] = [];
const next = () => app.inject({ method: 'POST', url: '/practice/next', headers });
beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true });
  await db.category.create({ data: { id: categoryId, slug: categoryId, nameThai: 'test', nameEnglish: 'test', nameRussian: 'test' } });
  await db.user.create({ data: { id: userId, telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`), sessions: { create: { tokenHash: createHash('sha256').update(token).digest('hex'), createdAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 1000) } } } });
});
afterAll(async () => {
  await app.close();
  try {
    await db.user.deleteMany({ where: { id: userId } });
    await db.question.deleteMany({ where: { id: { in: questions } } });
    await db.category.deleteMany({ where: { id: categoryId } });
  } finally {
    await db.$disconnect();
    await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  }
});
it('authenticates, filters, validates, and preserves exactly the presented snapshot', async () => {
  expect((await app.inject({ method: 'POST', url: '/practice/next' })).statusCode).toBe(401);
  await db.session.updateMany({ where: { userId }, data: { expiresAt: now } });
  expect((await next()).statusCode).toBe(401);
  await db.session.updateMany({ where: { userId }, data: { expiresAt: new Date(now.getTime() + 1000) } });
  expect((await next()).json()).toEqual({ error: 'Vehicle selection required' });
  for (const payload of [{ extra: true }, [], 'null', '{']) {
    const response = await app.inject({ method: 'POST', url: '/practice/next', headers: { ...headers, 'content-type': 'application/json' }, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Bad Request' });
    expect(response.headers['cache-control']).toBe('no-store');
  }
  await db.user.update({ where: { id: userId }, data: { selectedVehicleType: 'CAR' } });
  // Other integration files create transient active questions; run this suite on its own
  // database (see README) so an empty-bank assertion never modifies someone else's data.
  for (const state of [
    { vehicleType: 'MOTORCYCLE', active: true, verificationStatus: 'VERIFIED' },
    { vehicleType: 'CAR', active: false, verificationStatus: 'VERIFIED' },
    { vehicleType: 'CAR', active: true, verificationStatus: 'DRAFT' },
  ] as const) {
    const question = await db.question.create({ data: { ...state, categoryId, textEnglish: 'Excluded', sourceType: 'ORIGINAL' } });
    questions.push(question.id);
  }
  expect((await next()).statusCode).toBe(404);
  expect((await next()).json()).toEqual({ error: 'No questions available' });
  expect(await db.questionPresentation.count({ where: { userId } })).toBe(0);
  const question = await db.question.create({ data: {
    categoryId, vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL',
    textEnglish: 'Original wording', textExamEnglish: 'Exam wording', explanationEnglish: 'Secret explanation', trapExplanationEnglish: 'Secret trap', sourceReference: 'Secret source', imageReference: 'Secret image',
    choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({ key, textEnglish: `Choice ${key}`, isCorrect: key === 'A' })) },
  }, include: { choices: true } });
  questions.push(question.id);
  const response = await app.inject({ method: 'POST', url: '/practice/next', headers, payload: {} });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const body = presentationResponseSchema.parse(response.json());
  expect(Object.keys(body.question).sort()).toEqual(['choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai']);
  expect(body.question.textThai).toBeNull();
  for (const choice of body.question.choices) expect(Object.keys(choice).sort()).toEqual(['id', 'key', 'textEnglish', 'textRussian', 'textThai']);
  expect(response.body).not.toContain('Secret');
  const row = await db.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
  expect(row).toMatchObject({ userId, questionId: question.id, createdAt: now });
  const snapshot = parsePresentationSnapshot(row.snapshot);
  expect(snapshot.question).toEqual(body.question);
  expect(snapshot.correctChoiceId).toBe(question.choices.find((choice) => choice.isCorrect)?.id);
  expect(snapshot.explanationEnglish).toBe('Secret explanation');
  const submit = (payload: unknown, authorization = headers.authorization) => app.inject({ method: 'POST', url: '/practice/answer', headers: { authorization, 'content-type': 'application/json' }, payload: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  const validAnswer = { presentationId: row.id, choiceId: snapshot.correctChoiceId };
  const assertError = async (payload: unknown, status: number, error: string, authorization = headers.authorization) => {
    const response = await submit(payload, authorization);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error });
    expect(response.headers['cache-control']).toBe('no-store');
  };
  await assertError(validAnswer, 401, 'Unauthorized', 'Bearer invalid');
  await db.session.updateMany({ where: { userId }, data: { expiresAt: now } });
  await assertError(validAnswer, 401, 'Unauthorized');
  await db.session.updateMany({ where: { userId }, data: { expiresAt: new Date(now.getTime() + 1000) } });
  for (const payload of [{}, [], null, '{', { ...validAnswer, extra: true }, { ...validAnswer, choiceId: 'bad' }, { ...validAnswer, presentationId: 'bad' }, { ...validAnswer, choiceId: randomUUID() }]) await assertError(payload, 400, 'Bad Request');
  await assertError({ ...validAnswer, presentationId: randomUUID() }, 404, 'Presentation not found');
  const foreign = await db.user.create({ data: { telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`) } });
  try {
    const presentation = await db.questionPresentation.create({ data: { userId: foreign.id, questionId: question.id, snapshot } });
    await assertError({ ...validAnswer, presentationId: presentation.id }, 404, 'Presentation not found');
    expect(await db.answerAttempt.count({ where: { presentationId: presentation.id } })).toBe(0);
  } finally { await db.user.delete({ where: { id: foreign.id } }); }
  const corrupt = await db.questionPresentation.create({ data: { userId, questionId: question.id, snapshot: { version: 999 } } });
  await assertError({ ...validAnswer, presentationId: corrupt.id }, 500, 'Internal Server Error');
  expect(await db.answerAttempt.count()).toBe(0);
  await db.questionPresentation.delete({ where: { id: corrupt.id } });
  const incorrectPresentation = await db.questionPresentation.create({ data: { userId, questionId: question.id, snapshot } });
  const wrongChoice = snapshot.question.choices.find((choice) => choice.id !== snapshot.correctChoiceId);
  if (!wrongChoice) throw new Error('Missing test choice');
  const wrongResponse = await submit({ presentationId: incorrectPresentation.id, choiceId: wrongChoice.id });
  expect(wrongResponse.statusCode).toBe(200);
  expect(answerResponseSchema.parse(wrongResponse.json())).toMatchObject({ isCorrect: false, correctChoiceId: snapshot.correctChoiceId });
  await db.question.update({ where: { id: question.id }, data: { textEnglish: 'Edited', explanationEnglish: 'Edited explanation', choices: { updateMany: { where: {}, data: { isCorrect: false } } } } });
  expect(parsePresentationSnapshot((await db.questionPresentation.findUniqueOrThrow({ where: { id: row.id } })).snapshot)).toEqual(snapshot);
  const concurrent = await Promise.all([submit(validAnswer), submit({ ...validAnswer, choiceId: wrongChoice.id })]);
  expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  const success = concurrent.find((response) => response.statusCode === 200);
  if (!success) throw new Error('Missing success');
  const result = answerResponseSchema.parse(success.json());
  expect(result).toEqual({
    presentationId: row.id, selectedChoiceId: result.selectedChoiceId, correctChoiceId: snapshot.correctChoiceId,
    isCorrect: result.selectedChoiceId === snapshot.correctChoiceId,
    explanationThai: null, explanationEnglish: 'Secret explanation', explanationRussian: null,
    trapExplanationThai: null, trapExplanationEnglish: 'Secret trap', trapExplanationRussian: null,
  });
  expect(success.headers['cache-control']).toBe('no-store');
  expect(concurrent.find((response) => response.statusCode === 409)?.json()).toEqual({ error: 'Answer already submitted' });
  const saved = await db.answerAttempt.findUniqueOrThrow({ where: { presentationId: row.id } });
  expect(saved).toMatchObject({ presentationId: row.id, selectedChoiceId: result.selectedChoiceId, isCorrect: result.isCorrect, submittedAt: now });
  expect(await db.answerAttempt.count({ where: { presentationId: row.id } })).toBe(1);
  await assertError(validAnswer, 409, 'Answer already submitted');
  await assertError({ ...validAnswer, choiceId: randomUUID() }, 400, 'Bad Request');
  expect(await db.answerAttempt.findUniqueOrThrow({ where: { presentationId: row.id } })).toEqual(saved);
  // A separate correct answer ensures both score branches are covered regardless of the race winner.
  const correctPresentation = await db.questionPresentation.create({ data: { userId, questionId: question.id, snapshot } });
  expect(answerResponseSchema.parse((await submit({ ...validAnswer, presentationId: correctPresentation.id })).json()).isCorrect).toBe(true);
  const malformed = await next();
  expect(malformed.statusCode).toBe(500);
  expect(malformed.json()).toEqual({ error: 'Internal Server Error' });
  expect(await db.questionPresentation.count({ where: { userId } })).toBe(3);
});
