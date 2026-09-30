import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { parsePresentationSnapshot, presentationResponseSchema, snapshotQuestion } from '../packages/database/src/presentation.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `retry_mistake_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-30T08:00:00.000Z');
const ids = {
  category: randomUUID(), otherCategory: randomUUID(),
  concept: randomUUID(), onlyConcept: randomUUID(), emptyConcept: randomUUID(), otherConcept: randomUUID(), corruptConcept: randomUUID(),
  owner: randomUUID(), foreign: randomUUID(), noVehicle: randomUUID(),
};
const tokens = {
  owner: randomBytes(32).toString('base64url'),
  foreign: randomBytes(32).toString('base64url'),
  noVehicle: randomBytes(32).toString('base64url'),
};
const questionIds = {
  source: '10000000-0000-4000-8000-000000000001',
  firstAlternative: '20000000-0000-4000-8000-000000000001',
  secondAlternative: '30000000-0000-4000-8000-000000000001',
  motorcycle: '40000000-0000-4000-8000-000000000001',
  inactive: '50000000-0000-4000-8000-000000000001',
  draft: '60000000-0000-4000-8000-000000000001',
  otherConcept: '70000000-0000-4000-8000-000000000001',
  only: '80000000-0000-4000-8000-000000000001',
  immutableSource: '90000000-0000-4000-8000-000000000001',
  ungrouped: 'a0000000-0000-4000-8000-000000000001',
  corrupt: 'b0000000-0000-4000-8000-000000000001',
  empty: 'c0000000-0000-4000-8000-000000000001',
};
let injectedOffset: unknown = 0;
const randomCounts: number[] = [];
const app = createApi({
  database,
  botToken: 'synthetic',
  now: () => now,
  randomOffset: (count) => { randomCounts.push(count); return injectedOffset; },
});
const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const retry = (presentationId: string, token = tokens.owner) => app.inject({
  method: 'POST', url: '/practice/retry-mistake', headers: auth(token), payload: JSON.stringify({ presentationId }),
});

async function createQuestion(input: {
  id: string;
  conceptId: string | null;
  categoryId?: string;
  vehicleType?: 'CAR' | 'MOTORCYCLE';
  active?: boolean;
  verificationStatus?: 'DRAFT' | 'VERIFIED' | 'REJECTED';
}) {
  const label = Object.entries(questionIds).find(([, id]) => id === input.id)?.[0] ?? input.id;
  return database.question.create({
    data: {
      id: input.id,
      conceptId: input.conceptId,
      categoryId: input.categoryId ?? ids.category,
      vehicleType: input.vehicleType ?? 'CAR',
      active: input.active ?? true,
      verificationStatus: input.verificationStatus ?? 'VERIFIED',
      sourceType: 'ORIGINAL',
      textEnglish: `${label} wording`,
      explanationEnglish: `${label} private explanation`,
      sourceReference: `${label} private source`,
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key, textEnglish: `${label} ${key}`, isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

async function createPresentation(input: {
  userId?: string;
  questionId: string;
  conceptId?: string | null;
  outcome?: 'incorrect' | 'correct' | 'unanswered';
}) {
  const question = await database.question.findUniqueOrThrow({
    where: { id: input.questionId }, include: { choices: { orderBy: { key: 'asc' } } },
  });
  const snapshot = snapshotQuestion(question);
  const presentation = await database.questionPresentation.create({ data: {
    userId: input.userId ?? ids.owner,
    questionId: question.id,
    conceptId: input.conceptId === undefined ? question.conceptId : input.conceptId,
    createdAt: new Date(now.getTime() - 60_000),
    snapshot,
  } });
  if (input.outcome && input.outcome !== 'unanswered') {
    const correctChoiceId = snapshot.correctChoiceId;
    const incorrectChoiceId = snapshot.question.choices.find(({ id }) => id !== correctChoiceId)?.id;
    if (!incorrectChoiceId) throw new Error('Expected an incorrect choice');
    await database.answerAttempt.create({ data: {
      presentationId: presentation.id,
      selectedChoiceId: input.outcome === 'correct' ? correctChoiceId : incorrectChoiceId,
      isCorrect: input.outcome === 'correct',
      submittedAt: new Date(now.getTime() - 30_000),
    } });
  }
  return presentation;
}

let mistakeId: string;
let foreignMistakeId: string;
let unansweredId: string;
let correctId: string;
let noConceptId: string;
let onlyMistakeId: string;
let immutableMistakeId: string;
let corruptMistakeId: string;
let emptyMistakeId: string;
let inconsistentMistakeId: string;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true },
  );
  await database.category.createMany({ data: [
    { id: ids.category, slug: 'retry-main', nameThai: 'main', nameEnglish: 'main', nameRussian: 'main' },
    { id: ids.otherCategory, slug: 'retry-other', nameThai: 'other', nameEnglish: 'other', nameRussian: 'other' },
  ] });
  await database.concept.createMany({ data: [
    { id: ids.concept, slug: 'retry-concept', nameThai: 'retry', nameEnglish: 'retry', nameRussian: 'retry' },
    { id: ids.onlyConcept, slug: 'only-concept', nameThai: 'only', nameEnglish: 'only', nameRussian: 'only' },
    { id: ids.emptyConcept, slug: 'empty-concept', nameThai: 'empty', nameEnglish: 'empty', nameRussian: 'empty' },
    { id: ids.otherConcept, slug: 'other-concept', nameThai: 'other', nameEnglish: 'other', nameRussian: 'other' },
    { id: ids.corruptConcept, slug: 'corrupt-concept', nameThai: 'corrupt', nameEnglish: 'corrupt', nameRussian: 'corrupt' },
  ] });
  for (const [name, id] of Object.entries({ owner: ids.owner, foreign: ids.foreign, noVehicle: ids.noVehicle })) {
    const token = tokens[name as keyof typeof tokens];
    await database.user.create({ data: {
      id,
      telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`),
      selectedVehicleType: name === 'noVehicle' ? null : 'CAR',
      sessions: { create: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        createdAt: new Date(now.getTime() - 1_000), expiresAt: new Date(now.getTime() + 60_000),
      } },
    } });
  }
  await createQuestion({ id: questionIds.source, conceptId: ids.concept });
  await createQuestion({ id: questionIds.firstAlternative, conceptId: ids.concept });
  await createQuestion({ id: questionIds.secondAlternative, conceptId: ids.concept, categoryId: ids.otherCategory });
  await createQuestion({ id: questionIds.motorcycle, conceptId: ids.concept, vehicleType: 'MOTORCYCLE' });
  await createQuestion({ id: questionIds.inactive, conceptId: ids.concept, active: false });
  await createQuestion({ id: questionIds.draft, conceptId: ids.concept, verificationStatus: 'DRAFT' });
  await createQuestion({ id: questionIds.otherConcept, conceptId: ids.otherConcept });
  await createQuestion({ id: questionIds.only, conceptId: ids.onlyConcept });
  await createQuestion({ id: questionIds.immutableSource, conceptId: ids.concept });
  await createQuestion({ id: questionIds.ungrouped, conceptId: null });
  await createQuestion({ id: questionIds.corrupt, conceptId: ids.corruptConcept });
  await createQuestion({ id: questionIds.empty, conceptId: ids.emptyConcept });

  mistakeId = (await createPresentation({ questionId: questionIds.source, outcome: 'incorrect' })).id;
  inconsistentMistakeId = (await createPresentation({ questionId: questionIds.source, outcome: 'incorrect' })).id;
  foreignMistakeId = (await createPresentation({ userId: ids.foreign, questionId: questionIds.source, outcome: 'incorrect' })).id;
  unansweredId = (await createPresentation({ questionId: questionIds.source, outcome: 'unanswered' })).id;
  correctId = (await createPresentation({ questionId: questionIds.source, outcome: 'correct' })).id;
  noConceptId = (await createPresentation({ questionId: questionIds.ungrouped, outcome: 'incorrect' })).id;
  onlyMistakeId = (await createPresentation({ questionId: questionIds.only, outcome: 'incorrect' })).id;
  immutableMistakeId = (await createPresentation({ questionId: questionIds.immutableSource, outcome: 'incorrect' })).id;
  corruptMistakeId = (await createPresentation({ questionId: questionIds.corrupt, outcome: 'incorrect' })).id;
  emptyMistakeId = (await createPresentation({ questionId: questionIds.empty, outcome: 'incorrect' })).id;
  const inconsistent = await database.questionPresentation.findUniqueOrThrow({ where: { id: inconsistentMistakeId } });
  const inconsistentSnapshot = parsePresentationSnapshot(inconsistent.snapshot);
  await database.answerAttempt.update({
    where: { presentationId: inconsistentMistakeId },
    data: { selectedChoiceId: inconsistentSnapshot.correctChoiceId },
  });
  await database.question.update({ where: { id: questionIds.immutableSource }, data: { conceptId: ids.otherConcept } });
  await database.questionChoice.deleteMany({ where: { questionId: questionIds.corrupt } });
  await database.question.update({ where: { id: questionIds.empty }, data: { active: false } });
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

it('authenticates before body parsing, parses before vehicle lookup, and always disables caching', async () => {
  const unauthorized = await app.inject({
    method: 'POST', url: '/practice/retry-mistake', headers: { 'content-type': 'application/json' }, payload: '{',
  });
  expect(unauthorized.statusCode).toBe(401);
  expect(unauthorized.json()).toEqual({ error: 'Unauthorized' });
  expect(unauthorized.headers['cache-control']).toBe('no-store');

  const malformed = await app.inject({
    method: 'POST', url: '/practice/retry-mistake', headers: auth(tokens.noVehicle), payload: '{',
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json()).toEqual({ error: 'Bad Request' });
  expect(malformed.headers['cache-control']).toBe('no-store');
  const noVehicle = await retry(mistakeId, tokens.noVehicle);
  expect(noVehicle.statusCode).toBe(409);
  expect(noVehicle.json()).toEqual({ error: 'Vehicle selection required' });
  expect(noVehicle.headers['cache-control']).toBe('no-store');
});

it('rejects malformed and duplicate-member bodies without writes', async () => {
  const before = await database.questionPresentation.count({ where: { userId: ids.owner } });
  const invalidBodies = [
    '{}', 'null', '[]', `{"presentationId":"${mistakeId}","extra":true}`,
    '{"presentationId":"bad"}',
    `{"presentationId":"${mistakeId}","presentationId":"${mistakeId}"}`,
  ];
  for (const payload of invalidBodies) {
    const response = await app.inject({ method: 'POST', url: '/practice/retry-mistake', headers: auth(tokens.owner), payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Bad Request' });
    expect(response.headers['cache-control']).toBe('no-store');
  }
  const wrongType = await app.inject({
    method: 'POST', url: '/practice/retry-mistake', headers: { authorization: `Bearer ${tokens.owner}`, 'content-type': 'text/plain' }, payload: '{}',
  });
  expect(wrongType.statusCode).toBe(400);
  expect(wrongType.json()).toEqual({ error: 'Bad Request' });
  expect(await database.questionPresentation.count({ where: { userId: ids.owner } })).toBe(before);
});

it('hides missing, foreign, unanswered, correct, and non-practice identities uniformly', async () => {
  for (const presentationId of [randomUUID(), foreignMistakeId, unansweredId, correctId]) {
    const response = await retry(presentationId);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Mistake not found' });
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('reports an owned incorrect presentation without immutable concept attribution', async () => {
  const response = await retry(noConceptId);
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: 'Mistake has no concept' });
  expect(response.headers['cache-control']).toBe('no-store');
});

it('selects each alternative deterministically, excludes source and ignores category', async () => {
  const selected = [];
  for (const [offset, expected] of [questionIds.firstAlternative, questionIds.secondAlternative].entries()) {
    injectedOffset = offset;
    const before = await database.questionPresentation.count({ where: { userId: ids.owner } });
    const response = await retry(mistakeId);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = presentationResponseSchema.parse(response.json());
    expect(body.question.id).toBe(expected);
    expect(randomCounts.at(-1)).toBe(2);
    expect(await database.questionPresentation.count({ where: { userId: ids.owner } })).toBe(before + 1);
    selected.push(body.presentationId);
  }
  const rows = await database.questionPresentation.findMany({
    where: { id: { in: selected } }, orderBy: { questionId: 'asc' },
    select: { questionId: true, conceptId: true, answer: true },
  });
  expect(rows).toEqual([
    { questionId: questionIds.firstAlternative, conceptId: ids.concept, answer: null },
    { questionId: questionIds.secondAlternative, conceptId: ids.concept, answer: null },
  ]);
});

it('uses the source question only as the sole eligible fallback', async () => {
  injectedOffset = 0;
  const response = await retry(onlyMistakeId);
  expect(response.statusCode).toBe(200);
  const body = presentationResponseSchema.parse(response.json());
  expect(body.question.id).toBe(questionIds.only);
  expect(randomCounts.at(-1)).toBe(1);
});

it('returns the normal empty-bank response without calling randomness or writing', async () => {
  const calls = randomCounts.length;
  const before = await database.questionPresentation.count({ where: { userId: ids.owner } });
  const response = await retry(emptyMistakeId);
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'No questions available' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(randomCounts).toHaveLength(calls);
  expect(await database.questionPresentation.count({ where: { userId: ids.owner } })).toBe(before);
});

it('uses immutable presentation attribution after the source question is regrouped', async () => {
  injectedOffset = 1;
  const response = await retry(immutableMistakeId);
  expect(response.statusCode).toBe(200);
  const body = presentationResponseSchema.parse(response.json());
  expect(body.question.id).toBe(questionIds.firstAlternative);
  expect(randomCounts.at(-1)).toBe(3);
  const stored = await database.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
  expect(stored.conceptId).toBe(ids.concept);
  expect(stored.conceptId).not.toBe(ids.otherConcept);
});

it('returns only the accepted pre-answer DTO and leaves history, attempts and counters unchanged', async () => {
  injectedOffset = 0;
  const oldPresentations = await database.questionPresentation.findMany({
    where: { id: { in: [mistakeId, unansweredId, correctId] } }, orderBy: { id: 'asc' },
  });
  const attempts = await database.answerAttempt.findMany({ orderBy: { id: 'asc' } });
  const learningStates = await database.conceptLearningState.findMany({ orderBy: [{ userId: 'asc' }, { conceptId: 'asc' }] });
  const response = await retry(mistakeId);
  expect(response.statusCode).toBe(200);
  const raw: unknown = response.json();
  const body = presentationResponseSchema.parse(raw);
  expect(Object.keys(raw as Record<string, unknown>).sort()).toEqual(['presentationId', 'question']);
  expect(response.body).not.toContain('conceptId');
  expect(response.body).not.toContain('correctChoiceId');
  expect(response.body).not.toContain('explanation');
  expect(response.body).not.toContain('source');
  const created = await database.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
  expect(await database.answerAttempt.count({ where: { presentationId: created.id } })).toBe(0);
  expect(parsePresentationSnapshot(created.snapshot).question).toEqual(body.question);
  expect(await database.answerAttempt.findMany({ orderBy: { id: 'asc' } })).toEqual(attempts);
  expect(await database.conceptLearningState.findMany({ orderBy: [{ userId: 'asc' }, { conceptId: 'asc' }] })).toEqual(learningStates);
  expect(await database.questionPresentation.findMany({
    where: { id: { in: [mistakeId, unansweredId, correctId] } }, orderBy: { id: 'asc' },
  })).toEqual(oldPresentations);
});

it('does not change ordinary practice selection', async () => {
  injectedOffset = 0;
  const next = () => app.inject({ method: 'POST', url: '/practice/next', headers: auth(tokens.owner), payload: '{}' });
  const before = presentationResponseSchema.parse((await next()).json());
  expect(before.question.id).toBe(questionIds.source);
  expect((await retry(mistakeId)).statusCode).toBe(200);
  const after = presentationResponseSchema.parse((await next()).json());
  expect(after.question.id).toBe(questionIds.source);
});

it('rolls back invalid randomness and inconsistent selected content', async () => {
  const before = await database.questionPresentation.count({ where: { userId: ids.owner } });
  for (const invalid of [-1, 2, 0.5, Number.NaN, null, undefined]) {
    injectedOffset = invalid;
    const response = await retry(mistakeId);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal Server Error' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await database.questionPresentation.count({ where: { userId: ids.owner } })).toBe(before);
  }
  injectedOffset = 0;
  const corrupt = await retry(corruptMistakeId);
  expect(corrupt.statusCode).toBe(500);
  expect(corrupt.json()).toEqual({ error: 'Internal Server Error' });
  expect(await database.questionPresentation.count({ where: { userId: ids.owner } })).toBe(before);
});

it('fails closed on an inconsistent stored mistake without writing', async () => {
  injectedOffset = 0;
  const before = await database.questionPresentation.count({ where: { userId: ids.owner } });
  const response = await retry(inconsistentMistakeId);
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: 'Internal Server Error' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(await database.questionPresentation.count({ where: { userId: ids.owner } })).toBe(before);
});

it('creates exactly one unanswered presentation per concurrent successful request', async () => {
  injectedOffset = 0;
  const before = await database.questionPresentation.count({ where: { userId: ids.owner } });
  const responses = await Promise.all([retry(mistakeId), retry(mistakeId)]);
  expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
  const bodies = responses.map((response) => presentationResponseSchema.parse(response.json()));
  expect(new Set(bodies.map(({ presentationId }) => presentationId)).size).toBe(2);
  expect(await database.questionPresentation.count({ where: { userId: ids.owner } })).toBe(before + 2);
  expect(await database.answerAttempt.count({ where: { presentationId: { in: bodies.map(({ presentationId }) => presentationId) } } })).toBe(0);
});
