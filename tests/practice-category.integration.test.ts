import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { parsePresentationSnapshot, presentationResponseSchema } from '../packages/database/src/presentation.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `practice_category_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-16T12:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic', now: () => now });

const tokens = {
  car: randomBytes(32).toString('base64url'),
  noVehicle: randomBytes(32).toString('base64url'),
  expired: randomBytes(32).toString('base64url'),
};
const userIds = {
  car: randomUUID(),
  noVehicle: randomUUID(),
  expired: randomUUID(),
};
const categoryIds = {
  selected: randomUUID(),
  other: randomUUID(),
  motorcycle: randomUUID(),
  ineligible: randomUUID(),
};
const questionIds = {
  other: '00000000-0000-4000-8000-000000000001',
  selected: '10000000-0000-4000-8000-000000000001',
};
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const session = (token: string, expiresAt = new Date(now.getTime() + 60_000)) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(now.getTime() - 1_000),
  expiresAt,
});
const nextWithoutBody = (token = tokens.car) => app.inject({
  method: 'POST', url: '/practice/next', headers: authorization(token),
});
const nextWithBody = (payload: unknown, token = tokens.car) => app.inject({
  method: 'POST',
  url: '/practice/next',
  headers: { ...authorization(token), 'content-type': 'application/json' },
  payload: JSON.stringify(payload),
});
const nextWithRawBody = (payload: string, authorizationHeader: string | undefined) => app.inject({
  method: 'POST',
  url: '/practice/next',
  headers: authorizationHeader === undefined
    ? { 'content-type': 'application/json' }
    : { authorization: authorizationHeader, 'content-type': 'application/json' },
  payload,
});

async function createQuestion(input: {
  id?: string;
  categoryId: string;
  vehicleType: 'CAR' | 'MOTORCYCLE';
  active?: boolean;
  verificationStatus?: 'DRAFT' | 'VERIFIED' | 'REJECTED';
  textEnglish: string;
  withChoices?: boolean;
}) {
  return database.question.create({
    data: {
      ...(input.id === undefined ? {} : { id: input.id }),
      categoryId: input.categoryId,
      vehicleType: input.vehicleType,
      active: input.active ?? true,
      verificationStatus: input.verificationStatus ?? 'VERIFIED',
      sourceType: 'ORIGINAL',
      textEnglish: input.textEnglish,
      textExamEnglish: `${input.textEnglish} exam`,
      explanationEnglish: `${input.textEnglish} explanation`,
      trapExplanationEnglish: `${input.textEnglish} trap`,
      sourceReference: `${input.textEnglish} source`,
      imageReference: `${input.textEnglish} image`,
      ...(input.withChoices === false ? {} : { choices: {
        create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
          key,
          textEnglish: `${input.textEnglish} choice ${key}`,
          isCorrect: key === 'A',
        })),
      } }),
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
  const users = [
    { id: userIds.car, token: tokens.car, telegramUserId: 91_001n, selectedVehicleType: 'CAR' as const },
    { id: userIds.noVehicle, token: tokens.noVehicle, telegramUserId: 91_002n, selectedVehicleType: null },
    { id: userIds.expired, token: tokens.expired, telegramUserId: 91_003n, selectedVehicleType: 'CAR' as const },
  ];
  for (const user of users) {
    await database.user.create({ data: {
      id: user.id,
      telegramUserId: user.telegramUserId,
      selectedVehicleType: user.selectedVehicleType,
      sessions: { create: session(user.token, user.id === userIds.expired ? now : undefined) },
    } });
  }
  await database.category.createMany({ data: [
    { id: categoryIds.selected, slug: 'selected', nameThai: 'selected', nameEnglish: 'selected', nameRussian: 'selected' },
    { id: categoryIds.other, slug: 'other', nameThai: 'other', nameEnglish: 'other', nameRussian: 'other' },
    { id: categoryIds.motorcycle, slug: 'motorcycle', nameThai: 'motorcycle', nameEnglish: 'motorcycle', nameRussian: 'motorcycle' },
    { id: categoryIds.ineligible, slug: 'ineligible', nameThai: 'ineligible', nameEnglish: 'ineligible', nameRussian: 'ineligible' },
  ] });
  await createQuestion({
    id: questionIds.other,
    categoryId: categoryIds.other,
    vehicleType: 'CAR',
    textEnglish: 'Other category',
  });
  await createQuestion({
    id: questionIds.selected,
    categoryId: categoryIds.selected,
    vehicleType: 'CAR',
    textEnglish: 'Selected category',
  });
  await createQuestion({
    categoryId: categoryIds.motorcycle,
    vehicleType: 'MOTORCYCLE',
    textEnglish: 'Motorcycle only',
    withChoices: false,
  });
  for (const state of [
    { active: false, verificationStatus: 'VERIFIED' as const },
    { active: true, verificationStatus: 'DRAFT' as const },
    { active: true, verificationStatus: 'REJECTED' as const },
  ]) await createQuestion({
    categoryId: categoryIds.ineligible,
    vehicleType: 'CAR',
    textEnglish: `Ineligible ${state.verificationStatus} ${String(state.active)}`,
    withChoices: false,
    ...state,
  });
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('POST /practice/next category selector', () => {
  it('preserves authentication, body, and vehicle validation precedence without writes', async () => {
    const malformedSelector = { categoryId: null, extra: true };
    for (const request of [
      app.inject({ method: 'POST', url: '/practice/next', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(malformedSelector) }),
      nextWithBody(malformedSelector, randomBytes(32).toString('base64url')),
      nextWithBody(malformedSelector, tokens.expired),
    ]) {
      const response = await request;
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }

    const malformedWithoutVehicle = await nextWithBody(malformedSelector, tokens.noVehicle);
    expect(malformedWithoutVehicle.statusCode).toBe(400);
    expect(malformedWithoutVehicle.json()).toEqual({ error: 'Bad Request' });

    const validWithoutVehicle = await nextWithBody({ categoryId: categoryIds.selected }, tokens.noVehicle);
    expect(validWithoutVehicle.statusCode).toBe(409);
    expect(validWithoutVehicle.json()).toEqual({ error: 'Vehicle selection required' });
    expect(await database.questionPresentation.count()).toBe(0);
  });

  it('authenticates before parsing malformed JSON and rejects it for authenticated users', async () => {
    const unknownToken = randomBytes(32).toString('base64url');
    for (const authorizationHeader of [
      undefined,
      'Bearer invalid',
      `Bearer ${unknownToken}`,
      `Bearer ${tokens.expired}`,
    ]) {
      const response = await nextWithRawBody('{', authorizationHeader);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }

    const authenticated = await nextWithRawBody('{', `Bearer ${tokens.car}`);
    expect(authenticated.statusCode).toBe(400);
    expect(authenticated.json()).toEqual({ error: 'Bad Request' });
    expect(authenticated.headers['cache-control']).toBe('no-store');
    expect(await database.questionPresentation.count()).toBe(0);
  });

  it('rejects duplicate raw JSON object members before either selector can win', async () => {
    const before = await database.questionPresentation.count();
    const response = await nextWithRawBody(
      `{"categoryId":"${categoryIds.selected}","categoryId":"${categoryIds.other}"}`,
      `Bearer ${tokens.car}`,
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Bad Request' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await database.questionPresentation.count()).toBe(before);
  });

  it('strictly rejects malformed and extra selectors without creating presentations', async () => {
    const invalidBodies: unknown[] = [
      null,
      [],
      { categoryId: null },
      { categoryId: 'not-a-uuid' },
      { categoryId: [categoryIds.selected, categoryIds.selected] },
      { unknown: true },
      { categoryId: categoryIds.selected, unknown: true },
    ];
    for (const payload of invalidBodies) {
      const before = await database.questionPresentation.count();
      const response = await nextWithBody(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(await database.questionPresentation.count()).toBe(before);
    }
  });

  it('filters by category at the saved-vehicle eligibility boundary with uniform private 404s', async () => {
    const selectedResponse = await nextWithBody({ categoryId: categoryIds.selected });
    expect(selectedResponse.statusCode).toBe(200);
    const selected = presentationResponseSchema.parse(selectedResponse.json());
    expect(selected.question.id).toBe(questionIds.selected);
    expect(selectedResponse.headers['cache-control']).toBe('no-store');

    const otherResponse = await nextWithBody({ categoryId: categoryIds.other });
    expect(otherResponse.statusCode).toBe(200);
    expect(presentationResponseSchema.parse(otherResponse.json()).question.id).toBe(questionIds.other);

    const failureCount = await database.questionPresentation.count();
    for (const categoryId of [categoryIds.motorcycle, categoryIds.ineligible, randomUUID()]) {
      const response = await nextWithBody({ categoryId });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'No questions available' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain(categoryId);
      expect(await database.questionPresentation.count()).toBe(failureCount);
    }
  });

  it('keeps absent and empty bodies unfiltered with the exact safe response boundary', async () => {
    for (const response of [await nextWithoutBody(), await nextWithBody({})]) {
      expect(response.statusCode).toBe(200);
      const body = presentationResponseSchema.parse(response.json());
      expect(body.question.id).toBe(questionIds.other);
      expect(Object.keys(response.json()).sort()).toEqual(['presentationId', 'question']);
      expect(Object.keys(body.question).sort()).toEqual([
        'choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai',
      ]);
      for (const choice of body.question.choices) {
        expect(Object.keys(choice).sort()).toEqual(['id', 'key', 'textEnglish', 'textRussian', 'textThai']);
      }
      expect(response.body).not.toContain('correctChoiceId');
      expect(response.body).not.toContain('isCorrect');
      expect(response.body).not.toContain('explanation');
      expect(response.body).not.toContain('source');
      expect(response.body).not.toContain('image');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('persists an immutable filtered snapshot after source question and choice edits', async () => {
    const response = await nextWithBody({ categoryId: categoryIds.selected });
    expect(response.statusCode).toBe(200);
    const body = presentationResponseSchema.parse(response.json());
    const presentation = await database.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
    const snapshot = parsePresentationSnapshot(presentation.snapshot);
    const replacement = snapshot.question.choices.find((choice) => choice.id !== snapshot.correctChoiceId);
    if (!replacement) throw new Error('Missing replacement choice');

    await database.$transaction(async (transaction) => {
      await transaction.question.update({ where: { id: questionIds.selected }, data: {
        textEnglish: 'Edited source wording',
        explanationEnglish: 'Edited source explanation',
        trapExplanationEnglish: 'Edited source trap',
        sourceReference: 'Edited source reference',
        imageReference: 'Edited image reference',
      } });
      await transaction.questionChoice.update({
        where: { id: snapshot.correctChoiceId },
        data: { isCorrect: false, textEnglish: 'Edited old correct choice' },
      });
      await transaction.questionChoice.update({
        where: { id: replacement.id },
        data: { isCorrect: true, textEnglish: 'Edited new correct choice' },
      });
    });

    const stored = await database.questionPresentation.findUniqueOrThrow({ where: { id: body.presentationId } });
    expect(parsePresentationSnapshot(stored.snapshot)).toEqual(snapshot);
    expect(snapshot.question).toEqual(body.question);
    expect(snapshot.question.textEnglish).toBe('Selected category');
    expect(snapshot.explanationEnglish).toBe('Selected category explanation');
    expect(snapshot.correctChoiceId).not.toBe(replacement.id);
  });
});
