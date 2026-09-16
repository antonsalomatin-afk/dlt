import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { parsePresentationSnapshot, presentationResponseSchema } from '../packages/database/src/presentation.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `practice_random_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-16T14:00:00.000Z');
const token = randomBytes(32).toString('base64url');
const userId = randomUUID();
const categoryIds = { selected: randomUUID(), other: randomUUID() };
const questionIds = {
  motorcycle: '00000000-0000-4000-8000-000000000001',
  inactive: '00000000-0000-4000-8000-000000000002',
  draft: '00000000-0000-4000-8000-000000000003',
  rejected: '00000000-0000-4000-8000-000000000004',
  first: '10000000-0000-4000-8000-000000000001',
  middle: '20000000-0000-4000-8000-000000000001',
  last: '30000000-0000-4000-8000-000000000001',
  other: '40000000-0000-4000-8000-000000000001',
};
let injectedOffset: unknown = 0;
const eligibleCounts: number[] = [];
const app = createApi({
  database,
  botToken: 'synthetic',
  now: () => now,
  randomOffset: (eligibleCount) => {
    eligibleCounts.push(eligibleCount);
    return injectedOffset;
  },
});
const headers = { authorization: `Bearer ${token}` };
const next = (categoryId?: string) => app.inject({
  method: 'POST',
  url: '/practice/next',
  headers,
  payload: categoryId === undefined ? {} : { categoryId },
});

async function createQuestion(input: {
  id: string;
  categoryId: string;
  vehicleType?: 'CAR' | 'MOTORCYCLE';
  active?: boolean;
  verificationStatus?: 'DRAFT' | 'VERIFIED' | 'REJECTED';
  withChoices?: boolean;
}) {
  const label = Object.entries(questionIds).find(([, id]) => id === input.id)?.[0] ?? input.id;
  return database.question.create({
    data: {
      id: input.id,
      categoryId: input.categoryId,
      vehicleType: input.vehicleType ?? 'CAR',
      active: input.active ?? true,
      verificationStatus: input.verificationStatus ?? 'VERIFIED',
      sourceType: 'ORIGINAL',
      textEnglish: `${label} wording`,
      textExamEnglish: `${label} exam wording`,
      explanationEnglish: `${label} explanation`,
      trapExplanationEnglish: `${label} trap`,
      sourceReference: `${label} private source`,
      imageReference: `${label} private image`,
      ...(input.withChoices === false ? {} : {
        choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
          key,
          textEnglish: `${label} choice ${key}`,
          isCorrect: key === 'A',
        })) },
      }),
    },
    include: { choices: true },
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
  await database.category.createMany({ data: [
    { id: categoryIds.selected, slug: 'random-selected', nameThai: 'selected', nameEnglish: 'selected', nameRussian: 'selected' },
    { id: categoryIds.other, slug: 'random-other', nameThai: 'other', nameEnglish: 'other', nameRussian: 'other' },
  ] });
  await database.user.create({ data: {
    id: userId,
    telegramUserId: BigInt(`0x${randomBytes(6).toString('hex')}`),
    selectedVehicleType: 'CAR',
    sessions: { create: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      createdAt: new Date(now.getTime() - 1_000),
      expiresAt: new Date(now.getTime() + 60_000),
    } },
  } });
  await createQuestion({ id: questionIds.motorcycle, categoryId: categoryIds.selected, vehicleType: 'MOTORCYCLE', withChoices: false });
  await createQuestion({ id: questionIds.inactive, categoryId: categoryIds.selected, active: false, withChoices: false });
  await createQuestion({ id: questionIds.draft, categoryId: categoryIds.selected, verificationStatus: 'DRAFT', withChoices: false });
  await createQuestion({ id: questionIds.rejected, categoryId: categoryIds.selected, verificationStatus: 'REJECTED', withChoices: false });
  await createQuestion({ id: questionIds.first, categoryId: categoryIds.selected });
  await createQuestion({ id: questionIds.middle, categoryId: categoryIds.selected });
  await createQuestion({ id: questionIds.last, categoryId: categoryIds.selected });
  await createQuestion({ id: questionIds.other, categoryId: categoryIds.other });
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

it('selects controlled first, middle, and last offsets from the exact eligible scope', async () => {
  const expectedIds = [questionIds.first, questionIds.middle, questionIds.last];
  const presentationIds: string[] = [];
  for (const [offset, expectedId] of expectedIds.entries()) {
    injectedOffset = offset;
    const response = await next(categoryIds.selected);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = presentationResponseSchema.parse(response.json());
    expect(body.question.id).toBe(expectedId);
    presentationIds.push(body.presentationId);
  }
  expect(eligibleCounts).toEqual([3, 3, 3]);
  expect(await database.questionPresentation.findMany({
    where: { id: { in: presentationIds } },
    orderBy: { questionId: 'asc' },
    select: { questionId: true },
  })).toEqual(expectedIds.map((questionId) => ({ questionId })));
});

it('keeps category, vehicle, active, and verification filters in count and offset selection', async () => {
  injectedOffset = 0;
  const firstUnfiltered = presentationResponseSchema.parse((await next()).json());
  expect(firstUnfiltered.question.id).toBe(questionIds.first);
  expect(eligibleCounts.at(-1)).toBe(4);

  injectedOffset = 3;
  const lastUnfiltered = presentationResponseSchema.parse((await next()).json());
  expect(lastUnfiltered.question.id).toBe(questionIds.other);
  expect(eligibleCounts.at(-1)).toBe(4);

  injectedOffset = 0;
  const otherCategory = presentationResponseSchema.parse((await next(categoryIds.other)).json());
  expect(otherCategory.question.id).toBe(questionIds.other);
  expect(eligibleCounts.at(-1)).toBe(1);
});

it('does not call randomness for an empty scope', async () => {
  const callCount = eligibleCounts.length;
  const presentationCount = await database.questionPresentation.count({ where: { userId } });
  const response = await next(randomUUID());
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'No questions available' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(eligibleCounts).toHaveLength(callCount);
  expect(await database.questionPresentation.count({ where: { userId } })).toBe(presentationCount);
});

it('sanitizes every invalid injected offset shape without storing a presentation', async () => {
  for (const invalidOffset of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 3]) {
    injectedOffset = invalidOffset;
    const presentationCount = await database.questionPresentation.count({ where: { userId } });
    const response = await next(categoryIds.selected);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal Server Error' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(eligibleCounts.at(-1)).toBe(3);
    expect(await database.questionPresentation.count({ where: { userId } })).toBe(presentationCount);
  }
});

it('preserves the exact private response and immutable snapshot boundaries', async () => {
  injectedOffset = 1;
  const response = await next(categoryIds.selected);
  expect(response.statusCode).toBe(200);
  const body = presentationResponseSchema.parse(response.json());
  expect(body.question.id).toBe(questionIds.middle);
  expect(Object.keys(response.json()).sort()).toEqual(['presentationId', 'question']);
  expect(Object.keys(body.question).sort()).toEqual([
    'choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai',
  ]);
  for (const choice of body.question.choices) {
    expect(Object.keys(choice).sort()).toEqual(['id', 'key', 'textEnglish', 'textRussian', 'textThai']);
  }
  for (const privateField of ['correctChoiceId', 'isCorrect', 'explanation', 'source', 'image']) {
    expect(response.body).not.toContain(privateField);
  }

  const original = await database.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
  const snapshot = parsePresentationSnapshot(original.snapshot);
  const oldCorrectChoice = snapshot.question.choices.find((choice) => choice.id === snapshot.correctChoiceId);
  const newCorrectChoice = snapshot.question.choices.find((choice) => choice.id !== snapshot.correctChoiceId);
  if (!oldCorrectChoice || !newCorrectChoice) throw new Error('Missing snapshot choices');
  await database.$transaction(async (transaction) => {
    await transaction.question.update({ where: { id: questionIds.middle }, data: {
      textEnglish: 'Edited source wording',
      explanationEnglish: 'Edited source explanation',
      trapExplanationEnglish: 'Edited source trap',
    } });
    await transaction.questionChoice.update({ where: { id: oldCorrectChoice.id }, data: { isCorrect: false } });
    await transaction.questionChoice.update({ where: { id: newCorrectChoice.id }, data: { isCorrect: true } });
  });
  const stored = await database.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
  expect(parsePresentationSnapshot(stored.snapshot)).toEqual(snapshot);
  expect(snapshot.question).toEqual(body.question);
  expect(snapshot.explanationEnglish).toBe('middle explanation');
});
