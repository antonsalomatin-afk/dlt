import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import {
  dailyPracticeResponseSchema,
  isDailyPresentationUniqueConflict,
} from '../packages/database/src/daily-practice.ts';
import { answerResponseSchema } from '../packages/database/src/answer.ts';
import { parsePresentationSnapshot, snapshotQuestion } from '../packages/database/src/presentation.ts';

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: sourceUrl });
const databaseName = `daily_practice_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const conceptId = randomUUID();
const questionIds = {
  motorcycle: '00000000-0000-4000-8000-000000000001',
  inactive: '00000000-0000-4000-8000-000000000002',
  draft: '00000000-0000-4000-8000-000000000003',
  rejected: '00000000-0000-4000-8000-000000000004',
  first: '10000000-0000-4000-8000-000000000001',
  middle: '20000000-0000-4000-8000-000000000001',
  last: '30000000-0000-4000-8000-000000000001',
  corrupt: '40000000-0000-4000-8000-000000000001',
};
const learners = {
  primary: { id: randomUUID(), token: randomBytes(32).toString('base64url') },
  second: { id: randomUUID(), token: randomBytes(32).toString('base64url') },
  noVehicle: { id: randomUUID(), token: randomBytes(32).toString('base64url') },
  expiring: { id: randomUUID(), token: randomBytes(32).toString('base64url') },
};
let requestInstant = new Date('2026-10-02T16:59:59.999Z');
let nowCalls = 0;
let injectedOffset: unknown = 0;
const eligibleCounts: number[] = [];
const app = createApi({
  database,
  botToken: 'synthetic',
  now: () => { nowCalls++; return requestInstant; },
  randomOffset: (eligibleCount) => { eligibleCounts.push(eligibleCount); return injectedOffset; },
});

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

function daily(token: string | undefined, options: { payload?: unknown; raw?: string; query?: string } = {}) {
  const headers: Record<string, string> = token === undefined ? {} : authorization(token);
  const hasPayload = 'payload' in options || options.raw !== undefined;
  if (hasPayload) headers['content-type'] = 'application/json';
  return app.inject({
    method: 'POST',
    url: `/practice/daily${options.query ?? ''}`,
    headers,
    ...(options.raw !== undefined
      ? { payload: options.raw }
      : 'payload' in options ? { payload: JSON.stringify(options.payload) } : {}),
  });
}

async function createQuestion(input: {
  id: string;
  vehicleType?: 'CAR' | 'MOTORCYCLE';
  active?: boolean;
  verificationStatus?: 'DRAFT' | 'VERIFIED' | 'REJECTED';
  choiceCount?: number;
}) {
  const label = Object.entries(questionIds).find(([, id]) => id === input.id)?.[0] ?? input.id;
  return database.question.create({
    data: {
      id: input.id,
      categoryId,
      conceptId,
      vehicleType: input.vehicleType ?? 'CAR',
      active: input.active ?? true,
      verificationStatus: input.verificationStatus ?? 'VERIFIED',
      sourceType: 'ORIGINAL',
      sourceReference: `PRIVATE SOURCE ${label}`,
      reviewer: `PRIVATE REVIEWER ${label}`,
      reviewedAt: new Date('2026-09-01T00:00:00.000Z'),
      textEnglish: `${label} wording`,
      textExamEnglish: `${label} exam wording`,
      explanationEnglish: `PRIVATE EXPLANATION ${label}`,
      trapExplanationEnglish: `PRIVATE TRAP ${label}`,
      choices: { create: (['A', 'B', 'C', 'D'] as const).slice(0, input.choiceCount ?? 4).map((key) => ({
        key,
        textEnglish: `${label} choice ${key}`,
        isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const migration = spawnSync(process.execPath, [
    'node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy',
  ], {
    env: { ...process.env, DATABASE_URL: isolatedUrl.toString() },
    timeout: 120_000,
    stdio: 'pipe',
    windowsHide: true,
  });
  if (migration.status !== 0 || migration.error) throw new Error('Isolated daily practice migration failed');
  await database.category.create({ data: {
    id: categoryId,
    slug: 'daily-practice',
    nameThai: 'รายวัน',
    nameEnglish: 'Daily practice',
    nameRussian: 'Ежедневная практика',
  } });
  await database.concept.create({ data: {
    id: conceptId,
    slug: 'daily-concept',
    nameThai: 'แนวคิด',
    nameEnglish: 'Daily concept',
    nameRussian: 'Ежедневная тема',
  } });
  for (const [index, learner] of Object.values(learners).entries()) {
    await database.user.create({ data: {
      id: learner.id,
      telegramUserId: BigInt(600_000 + index),
      selectedVehicleType: learner === learners.noVehicle ? null : 'CAR',
      sessions: { create: {
        tokenHash: createHash('sha256').update(learner.token).digest('hex'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: learner === learners.expiring
          ? new Date('2026-10-02T17:00:00.000Z')
          : new Date('2030-01-01T00:00:00.000Z'),
      } },
    } });
  }
  await createQuestion({ id: questionIds.motorcycle, vehicleType: 'MOTORCYCLE' });
  await createQuestion({ id: questionIds.inactive, active: false });
  await createQuestion({ id: questionIds.draft, verificationStatus: 'DRAFT' });
  await createQuestion({ id: questionIds.rejected, verificationStatus: 'REJECTED' });
  await createQuestion({ id: questionIds.first });
  await createQuestion({ id: questionIds.middle });
  await createQuestion({ id: questionIds.last });
  await createQuestion({ id: questionIds.corrupt, active: false, choiceCount: 3 });
}, 150_000);

beforeEach(async () => {
  await database.answerAttempt.deleteMany();
  await database.questionPresentation.deleteMany();
  await database.conceptLearningState.deleteMany();
  await database.user.update({ where: { id: learners.primary.id }, data: { selectedVehicleType: 'CAR' } });
  await database.user.update({ where: { id: learners.second.id }, data: { selectedVehicleType: 'CAR' } });
  await database.user.update({ where: { id: learners.noVehicle.id }, data: { selectedVehicleType: null } });
  await database.question.updateMany({
    where: { id: { in: [questionIds.first, questionIds.middle, questionIds.last] } },
    data: { active: true, verificationStatus: 'VERIFIED' },
  });
  await database.question.update({
    where: { id: questionIds.motorcycle },
    data: { active: true, verificationStatus: 'VERIFIED' },
  });
  await database.question.update({
    where: { id: questionIds.middle },
    data: { vehicleType: 'CAR', textEnglish: 'middle wording', textExamEnglish: 'middle exam wording' },
  });
  await database.question.update({
    where: { id: questionIds.corrupt },
    data: { active: false, verificationStatus: 'VERIFIED' },
  });
  requestInstant = new Date('2026-10-02T16:59:59.999Z');
  nowCalls = 0;
  injectedOffset = 0;
  eligibleCounts.length = 0;
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('POST /practice/daily', () => {
  it('classifies the real PostgreSQL learner/day unique violation precisely', async () => {
    const source = await database.question.findUniqueOrThrow({
      where: { id: questionIds.first },
      include: { choices: { orderBy: { key: 'asc' } } },
    });
    const data = {
      userId: learners.primary.id,
      questionId: source.id,
      conceptId,
      dailyDate: new Date('2026-10-01T00:00:00.000Z'),
      snapshot: snapshotQuestion(source),
    };
    const outcomes = await Promise.allSettled([
      database.questionPresentation.create({ data }),
      database.questionPresentation.create({ data }),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status !== 'rejected') throw new Error('Missing daily unique conflict');
    expect(isDailyPresentationUniqueConflict(rejected.reason)).toBe(true);
  });

  it('authenticates before strict query/body parsing and applies vehicle precedence after replay lookup', async () => {
    const malformed = { raw: '{', query: '?unknown=1' };
    for (const token of [undefined, 'invalid', randomBytes(32).toString('base64url')]) {
      const response = await daily(token, malformed);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    requestInstant = new Date('2026-10-02T17:00:00.000Z');
    expect((await daily(learners.expiring.token, malformed)).statusCode).toBe(401);

    for (const options of [
      { raw: '{' },
      { raw: 'null' },
      { raw: '[]' },
      { raw: '{"unknown":true}' },
      { raw: '{"unknown":true,"unknown":false}' },
      { query: '?unknown=1' },
      { query: '?unknown=1&unknown=2' },
    ]) {
      const response = await daily(learners.noVehicle.token, options);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
    }
    const missingVehicle = await daily(learners.noVehicle.token);
    expect(missingVehicle.statusCode).toBe(409);
    expect(missingVehicle.json()).toEqual({ error: 'Vehicle selection required' });
    expect(await database.questionPresentation.count()).toBe(0);

    requestInstant = new Date('2026-10-03T12:00:00.000Z');
    const callsBefore = nowCalls;
    const first = await daily(learners.primary.token);
    expect(first.statusCode).toBe(200);
    expect(nowCalls - callsBefore).toBe(1);
    const replay = await daily(learners.primary.token, { payload: {} });
    expect(replay.json()).toEqual(first.json());
    expect(await database.questionPresentation.count()).toBe(1);
  });

  it('uses the exact eligible scope and validates every random boundary before writing', async () => {
    const expectedIds = [questionIds.first, questionIds.middle, questionIds.last];
    for (const [offset, questionId] of expectedIds.entries()) {
      requestInstant = new Date(`2026-10-0${3 + offset}T12:00:00.000Z`);
      injectedOffset = offset;
      const response = await daily(learners.primary.token, { payload: {} });
      expect(response.statusCode).toBe(200);
      expect(dailyPracticeResponseSchema.parse(response.json()).question.id).toBe(questionId);
    }
    expect(eligibleCounts).toEqual([3, 3, 3]);

    requestInstant = new Date('2026-10-06T12:00:00.000Z');
    for (const invalid of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 3]) {
      injectedOffset = invalid;
      const before = await database.questionPresentation.count();
      const response = await daily(learners.primary.token);
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
      expect(await database.questionPresentation.count()).toBe(before);
    }

    await database.user.update({ where: { id: learners.primary.id }, data: { selectedVehicleType: 'MOTORCYCLE' } });
    await database.question.update({ where: { id: questionIds.motorcycle }, data: { active: false } });
    requestInstant = new Date('2026-10-07T12:00:00.000Z');
    const emptyBefore = await database.questionPresentation.count();
    const empty = await daily(learners.primary.token);
    expect(empty.statusCode).toBe(404);
    expect(empty.json()).toEqual({ error: 'No questions available' });
    expect(await database.questionPresentation.count()).toBe(emptyBefore);

    await database.user.update({ where: { id: learners.primary.id }, data: { selectedVehicleType: 'CAR' } });
    await database.question.updateMany({
      where: { id: { in: [questionIds.first, questionIds.middle, questionIds.last] } },
      data: { active: false },
    });
    await database.question.update({ where: { id: questionIds.corrupt }, data: { active: true } });
    requestInstant = new Date('2026-10-08T12:00:00.000Z');
    injectedOffset = 0;
    const corruptBefore = await database.questionPresentation.count();
    const corrupt = await daily(learners.primary.token);
    expect(corrupt.statusCode).toBe(500);
    expect(corrupt.json()).toEqual({ error: 'Internal Server Error' });
    expect(await database.questionPresentation.count()).toBe(corruptBefore);
  });

  it('replays the immutable snapshot across source and vehicle changes and reflects the real answer transition', async () => {
    requestInstant = new Date('2026-10-09T12:00:00.000Z');
    injectedOffset = 1;
    const firstResponse = await daily(learners.primary.token);
    expect(firstResponse.statusCode).toBe(200);
    const first = dailyPracticeResponseSchema.parse(firstResponse.json());
    expect(first).toMatchObject({ day: '2026-10-09', answered: false, question: { id: questionIds.middle } });
    const stored = await database.questionPresentation.findUniqueOrThrow({ where: { id: first.presentationId } });
    expect(stored).toMatchObject({
      userId: learners.primary.id,
      questionId: questionIds.middle,
      conceptId,
      createdAt: requestInstant,
      dailyDate: new Date('2026-10-09T00:00:00.000Z'),
    });
    const snapshot = parsePresentationSnapshot(stored.snapshot);
    expect(snapshot.question).toEqual(first.question);

    await database.question.update({ where: { id: questionIds.middle }, data: {
      textEnglish: 'MUTATED CURRENT WORDING',
      vehicleType: 'MOTORCYCLE',
      active: false,
      verificationStatus: 'REJECTED',
    } });
    await database.user.update({ where: { id: learners.primary.id }, data: { selectedVehicleType: null } });
    const replay = await daily(learners.primary.token);
    expect(replay.json()).toEqual(first);

    const answer = await app.inject({
      method: 'POST',
      url: '/practice/answer',
      headers: { ...authorization(learners.primary.token), 'content-type': 'application/json' },
      payload: JSON.stringify({ presentationId: first.presentationId, choiceId: snapshot.correctChoiceId }),
    });
    expect(answer.statusCode).toBe(200);
    expect(answerResponseSchema.parse(answer.json()).isCorrect).toBe(true);
    const answered = dailyPracticeResponseSchema.parse((await daily(learners.primary.token)).json());
    expect(answered).toEqual({ ...first, answered: true });
    expect(answered.question.textEnglish).toBe('middle wording');
    expect(await database.questionPresentation.count()).toBe(1);
    expect(await database.answerAttempt.count()).toBe(1);
    expect(await database.conceptLearningState.findUniqueOrThrow({
      where: { userId_conceptId: { userId: learners.primary.id, conceptId } },
    })).toMatchObject({ practiceAnswered: 1, practiceCorrect: 1 });
  });

  it('rolls over exactly at Thailand midnight while allowing unlimited ordinary null-date presentations', async () => {
    requestInstant = new Date('2026-10-02T16:59:59.999Z');
    const beforeMidnight = dailyPracticeResponseSchema.parse((await daily(learners.primary.token)).json());
    expect(beforeMidnight.day).toBe('2026-10-02');
    requestInstant = new Date('2026-10-02T17:00:00.000Z');
    const atMidnight = dailyPracticeResponseSchema.parse((await daily(learners.primary.token)).json());
    expect(atMidnight.day).toBe('2026-10-03');
    expect(atMidnight.presentationId).not.toBe(beforeMidnight.presentationId);

    const source = await database.question.findUniqueOrThrow({
      where: { id: questionIds.first }, include: { choices: { orderBy: { key: 'asc' } } },
    });
    const snapshot = parsePresentationSnapshot((await database.questionPresentation.findUniqueOrThrow({
      where: { id: beforeMidnight.presentationId },
    })).snapshot);
    await database.questionPresentation.createMany({ data: [
      { userId: learners.primary.id, questionId: source.id, conceptId, snapshot },
      { userId: learners.primary.id, questionId: source.id, conceptId, snapshot },
    ] });
    expect(await database.questionPresentation.count({
      where: { userId: learners.primary.id, dailyDate: null },
    })).toBe(2);
    expect(await database.questionPresentation.count({
      where: { userId: learners.primary.id, dailyDate: { not: null } },
    })).toBe(2);
  });

  it('converges concurrent same-user requests and keeps different learners independent', async () => {
    requestInstant = new Date('2026-10-10T12:00:00.000Z');
    injectedOffset = 2;
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => daily(learners.primary.token)));
    expect(concurrent.map(({ statusCode }) => statusCode)).toEqual(Array.from({ length: 12 }, () => 200));
    const parsed = concurrent.map((response) => dailyPracticeResponseSchema.parse(response.json()));
    expect(new Set(parsed.map(({ presentationId }) => presentationId)).size).toBe(1);
    expect(new Set(parsed.map(({ question }) => question.id))).toEqual(new Set([questionIds.last]));
    expect(await database.questionPresentation.count({
      where: { userId: learners.primary.id, dailyDate: new Date('2026-10-10T00:00:00.000Z') },
    })).toBe(1);

    requestInstant = new Date('2026-10-11T12:00:00.000Z');
    const [primary, second] = await Promise.all([
      daily(learners.primary.token),
      daily(learners.second.token),
    ]);
    expect(primary.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const primaryBody = dailyPracticeResponseSchema.parse(primary.json());
    const secondBody = dailyPracticeResponseSchema.parse(second.json());
    expect(primaryBody.presentationId).not.toBe(secondBody.presentationId);
    expect(await database.questionPresentation.count({
      where: { dailyDate: new Date('2026-10-11T00:00:00.000Z') },
    })).toBe(2);
  }, 30_000);

  it('returns exact private fields and fails closed on a corrupt saved assignment without unrelated writes', async () => {
    requestInstant = new Date('2026-10-12T12:00:00.000Z');
    const before = {
      users: await database.user.count(),
      sessions: await database.session.count(),
      questions: await database.question.count(),
      choices: await database.questionChoice.count(),
      attempts: await database.answerAttempt.count(),
      states: await database.conceptLearningState.count(),
      favorites: await database.favorite.count(),
      reports: await database.questionReport.count(),
    };
    const response = await daily(learners.primary.token);
    const body = dailyPracticeResponseSchema.parse(response.json());
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(['answered', 'day', 'presentationId', 'question']);
    expect(Object.keys(body.question).sort()).toEqual([
      'choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai',
    ]);
    for (const choice of body.question.choices) {
      expect(Object.keys(choice).sort()).toEqual(['id', 'key', 'textEnglish', 'textRussian', 'textThai']);
    }
    for (const prohibited of [
      'correctChoiceId', 'isCorrect', 'selectedChoiceId', 'explanation', 'source', 'reviewer',
      'conceptId', 'categoryId', 'userId', 'active', 'verificationStatus', 'telegram',
    ]) expect(response.body).not.toContain(prohibited);
    expect({
      users: await database.user.count(),
      sessions: await database.session.count(),
      questions: await database.question.count(),
      choices: await database.questionChoice.count(),
      attempts: await database.answerAttempt.count(),
      states: await database.conceptLearningState.count(),
      favorites: await database.favorite.count(),
      reports: await database.questionReport.count(),
    }).toEqual(before);

    await database.questionPresentation.update({ where: { id: body.presentationId }, data: { snapshot: { version: 999 } } });
    const corruptBefore = await database.questionPresentation.findMany({ orderBy: { id: 'asc' } });
    const corrupt = await daily(learners.primary.token);
    expect(corrupt.statusCode).toBe(500);
    expect(corrupt.json()).toEqual({ error: 'Internal Server Error' });
    expect(await database.questionPresentation.findMany({ orderBy: { id: 'asc' } })).toEqual(corruptBefore);
  });
});
