import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import {
  EXAM_DURATION_MS,
  EXAM_PASSING_SCORE,
  EXAM_QUESTION_COUNT,
  examStartResponseSchema,
} from '../packages/database/src/exam.ts';
import { parsePresentationSnapshot } from '../packages/database/src/presentation.ts';
import { isSerializationFailure } from '../packages/database/src/transaction.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for exam start integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_start_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const initialNow = new Date('2026-09-17T14:00:00.000Z');
let clock = initialNow;
let injectedOffset: unknown = 0;
const randomBounds: number[] = [];
const app = createApi({
  database,
  botToken: 'synthetic',
  now: () => clock,
  examRandomOffset: (remainingCount) => {
    randomBounds.push(remainingCount);
    return injectedOffset;
  },
});
let databaseCreated = false;
let telegramSequence = 30_000n;

const eligibleQuestionIds = Array.from({ length: 52 }, (_, index) =>
  `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const excludedQuestionIds = {
  motorcycle: '01000000-0000-4000-8000-000000000001',
  inactive: '01000000-0000-4000-8000-000000000002',
  draft: '01000000-0000-4000-8000-000000000003',
  rejected: '01000000-0000-4000-8000-000000000004',
};

async function createLearner(vehicleType: 'CAR' | 'MOTORCYCLE' | null, sessionState: 'valid' | 'expired' | 'revoked' = 'valid') {
  telegramSequence++;
  const token = randomBytes(32).toString('base64url');
  const user = await database.user.create({
    data: {
      telegramUserId: telegramSequence,
      selectedVehicleType: vehicleType,
      sessions: { create: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        createdAt: new Date(clock.getTime() - 1_000),
        expiresAt: sessionState === 'expired' ? clock : new Date(clock.getTime() + 86_400_000),
      } },
    },
  });
  if (sessionState === 'revoked') await database.session.deleteMany({ where: { userId: user.id } });
  return { user, token };
}

function start(token?: string, options: { payload?: string; contentType?: string; query?: string } = {}) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  return app.inject({
    method: 'POST',
    url: `/exam/start${options.query ?? ''}`,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

async function expectError(responsePromise: ReturnType<typeof start>, statusCode: number, error: string) {
  const response = await responsePromise;
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toEqual({ error });
  expect(response.headers['cache-control']).toBe('no-store');
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
  await database.category.create({
    data: { id: categoryId, slug: 'exam-start', nameThai: 'exam', nameEnglish: 'exam', nameRussian: 'exam' },
  });
  await database.question.createMany({
    data: [
      ...eligibleQuestionIds.map((id, index) => ({
        id,
        categoryId,
        vehicleType: 'CAR' as const,
        active: true,
        verificationStatus: 'VERIFIED' as const,
        sourceType: 'ORIGINAL' as const,
        textEnglish: `Exam question ${index + 1}`,
        textExamEnglish: `Exam-style wording ${index + 1}`,
        explanationEnglish: `Private explanation ${index + 1}`,
        trapExplanationEnglish: `Private trap ${index + 1}`,
        sourceReference: `Private source ${index + 1}`,
        imageReference: `Private image ${index + 1}`,
      })),
      { id: excludedQuestionIds.motorcycle, categoryId, vehicleType: 'MOTORCYCLE', active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL', textEnglish: 'Motorcycle question' },
      { id: excludedQuestionIds.inactive, categoryId, vehicleType: 'CAR', active: false, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL', textEnglish: 'Inactive question' },
      { id: excludedQuestionIds.draft, categoryId, vehicleType: 'CAR', active: true, verificationStatus: 'DRAFT', sourceType: 'ORIGINAL', textEnglish: 'Draft question' },
      { id: excludedQuestionIds.rejected, categoryId, vehicleType: 'CAR', active: true, verificationStatus: 'REJECTED', sourceType: 'ORIGINAL', textEnglish: 'Rejected question' },
    ],
  });
  await database.questionChoice.createMany({
    data: eligibleQuestionIds.flatMap((questionId, questionIndex) =>
      (['A', 'B', 'C', 'D'] as const).map((key) => ({
        id: randomUUID(),
        questionId,
        key,
        textEnglish: `Question ${questionIndex + 1} choice ${key}`,
        isCorrect: key === 'A',
      })),
    ),
  });
}, 150_000);

afterAll(async () => {
  await app.close();
  try {
    await database.$disconnect();
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
});

describe('POST /exam/start boundaries', () => {
  it('authenticates before strict query and body validation, then requires a saved vehicle', async () => {
    const noVehicle = await createLearner(null);
    const expired = await createLearner('CAR', 'expired');
    const revoked = await createLearner('CAR', 'revoked');
    const malformed = { payload: '{', contentType: 'application/json', query: '?unknown=1' };
    await expectError(start(undefined, malformed), 401, 'Unauthorized');
    await expectError(start('invalid', malformed), 401, 'Unauthorized');
    await expectError(start(randomBytes(32).toString('base64url'), malformed), 401, 'Unauthorized');
    await expectError(start(expired.token, malformed), 401, 'Unauthorized');
    await expectError(start(revoked.token, malformed), 401, 'Unauthorized');

    for (const options of [
      { payload: '{', contentType: 'application/json' },
      { payload: 'null', contentType: 'application/json' },
      { payload: '[]', contentType: 'application/json' },
      { payload: '{"unknown":true}', contentType: 'application/json' },
      { payload: '{"unknown":true,"unknown":false}', contentType: 'application/json' },
      { payload: '{}', contentType: 'application/xml' },
      { payload: '{}', contentType: 'application/json', query: '?unknown=1' },
      { payload: '{}', contentType: 'application/json', query: '?unknown=1&unknown=2' },
      {},
    ]) await expectError(start(noVehicle.token, options), 400, 'Bad Request');
    await expectError(start(noVehicle.token, { payload: '{}', contentType: 'application/json' }), 409, 'Vehicle selection required');
    expect(await database.examSession.count({ where: { userId: noVehicle.user.id } })).toBe(0);
  });

  it('creates exactly 50 deterministic safe immutable snapshots with the approved policy', async () => {
    const learner = await createLearner('CAR');
    randomBounds.length = 0;
    injectedOffset = 0;
    const response = await start(learner.token, { payload: '{}', contentType: 'application/json' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = examStartResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      vehicleType: 'CAR',
      questionCount: EXAM_QUESTION_COUNT,
      passingScore: EXAM_PASSING_SCORE,
      startedAt: initialNow.toISOString(),
      expiresAt: new Date(initialNow.getTime() + EXAM_DURATION_MS).toISOString(),
    });
    expect(randomBounds).toEqual(Array.from({ length: 50 }, (_, index) => 52 - index));
    expect(body.questions.map(({ question }) => question.id)).toEqual(eligibleQuestionIds.slice(0, 50));
    expect(body.questions.map(({ position }) => position)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(new Set(body.questions.map(({ examQuestionId }) => examQuestionId)).size).toBe(50);
    expect(Object.keys(body).sort()).toEqual(['examId', 'expiresAt', 'passingScore', 'questionCount', 'questions', 'startedAt', 'vehicleType']);
    for (const item of body.questions) {
      expect(Object.keys(item).sort()).toEqual(['examQuestionId', 'position', 'question']);
      expect(Object.keys(item.question).sort()).toEqual(['choices', 'id', 'textEnglish', 'textExamEnglish', 'textRussian', 'textThai']);
      for (const choice of item.question.choices) {
        expect(Object.keys(choice).sort()).toEqual(['id', 'key', 'textEnglish', 'textRussian', 'textThai']);
      }
    }
    for (const privateValue of ['correctChoiceId', 'isCorrect', 'selectedChoiceId', 'explanation', 'sourceReference', 'imageReference', learner.user.id]) {
      expect(response.body).not.toContain(privateValue);
    }

    const stored = await database.examSession.findUniqueOrThrow({
      where: { id: body.examId },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    expect(stored).toMatchObject({
      userId: learner.user.id,
      vehicleType: 'CAR',
      questionCount: 50,
      passingScore: 45,
      startedAt: initialNow,
      expiresAt: new Date(initialNow.getTime() + EXAM_DURATION_MS),
      completedAt: null,
      score: null,
      passed: null,
    });
    expect(stored.questions).toHaveLength(50);
    for (const [index, examQuestion] of stored.questions.entries()) {
      expect(examQuestion).toMatchObject({
        position: index + 1,
        questionId: eligibleQuestionIds[index],
        selectedChoiceId: null,
        isCorrect: null,
        answeredAt: null,
      });
      expect(parsePresentationSnapshot(examQuestion.snapshot).question).toEqual(body.questions[index]?.question);
    }
    const originalSnapshot = stored.questions[0]?.snapshot;
    const firstQuestionId = eligibleQuestionIds[0];
    if (!originalSnapshot || !firstQuestionId) throw new Error('Missing stored snapshot');
    await database.question.update({ where: { id: firstQuestionId }, data: { textEnglish: 'Later edited wording' } });
    expect((await database.examQuestion.findFirstOrThrow({ where: { examSessionId: body.examId, position: 1 } })).snapshot).toEqual(originalSnapshot);
  });

  it('blocks an active exam, but permits starts after completion or strict expiry', async () => {
    const learner = await createLearner('CAR');
    injectedOffset = 0;
    const first = examStartResponseSchema.parse((await start(learner.token, { payload: '{}', contentType: 'application/json' })).json());
    await expectError(start(learner.token, { payload: '{}', contentType: 'application/json' }), 409, 'Exam already in progress');
    expect(await database.examSession.count({ where: { userId: learner.user.id } })).toBe(1);

    await database.examSession.update({
      where: { id: first.examId },
      data: { completedAt: initialNow, score: 45, passed: true },
    });
    const secondResponse = await start(learner.token, { payload: '{}', contentType: 'application/json' });
    expect(secondResponse.statusCode).toBe(200);
    const second = examStartResponseSchema.parse(secondResponse.json());
    await database.examSession.update({
      where: { id: second.examId },
      data: { expiresAt: new Date(initialNow.getTime() + 1) },
    });
    clock = new Date(initialNow.getTime() + 1);
    try {
      const third = await start(learner.token, { payload: '{}', contentType: 'application/json' });
      expect(third.statusCode).toBe(200);
      expect(examStartResponseSchema.parse(third.json()).startedAt).toBe(clock.toISOString());
      expect(await database.examSession.count({ where: { userId: learner.user.id } })).toBe(3);
    } finally {
      clock = initialNow;
    }
  });

  it('returns deterministic insufficient and oversized pool errors without writes or randomness', async () => {
    const learner = await createLearner('MOTORCYCLE');
    const callsBefore = randomBounds.length;
    await expectError(start(learner.token, { payload: '{}', contentType: 'application/json' }), 409, 'Not enough questions available');
    expect(randomBounds).toHaveLength(callsBefore);
    expect(await database.examSession.count({ where: { userId: learner.user.id } })).toBe(0);

    await database.question.createMany({
      data: Array.from({ length: 10_000 }, (_, index) => ({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        categoryId,
        vehicleType: 'MOTORCYCLE' as const,
        active: true,
        verificationStatus: 'VERIFIED' as const,
        sourceType: 'ORIGINAL' as const,
        textEnglish: `Oversized question ${index + 1}`,
      })),
    });
    await expectError(start(learner.token, { payload: '{}', contentType: 'application/json' }), 500, 'Internal Server Error');
    expect(randomBounds).toHaveLength(callsBefore);
    expect(await database.examSession.count({ where: { userId: learner.user.id } })).toBe(0);
  }, 30_000);

  it('rolls back corrupt selected content and invalid random output', async () => {
    const corruptId = '00000000-0000-4000-8000-000000000001';
    await database.question.create({ data: {
      id: corruptId,
      categoryId,
      vehicleType: 'CAR',
      active: true,
      verificationStatus: 'VERIFIED',
      sourceType: 'ORIGINAL',
      textEnglish: 'Corrupt selected question without choices',
    } });
    const corruptLearner = await createLearner('CAR');
    injectedOffset = 0;
    try {
      await expectError(start(corruptLearner.token, { payload: '{}', contentType: 'application/json' }), 500, 'Internal Server Error');
      expect(await database.examSession.count({ where: { userId: corruptLearner.user.id } })).toBe(0);
      expect(await database.examQuestion.count({ where: { examSession: { userId: corruptLearner.user.id } } })).toBe(0);
    } finally {
      await database.question.delete({ where: { id: corruptId } });
    }

    for (const invalid of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 52]) {
      const learner = await createLearner('CAR');
      injectedOffset = invalid;
      await expectError(start(learner.token, { payload: '{}', contentType: 'application/json' }), 500, 'Internal Server Error');
      expect(await database.examSession.count({ where: { userId: learner.user.id } })).toBe(0);
    }
    injectedOffset = 0;
  });

  it('serializes concurrent starts per learner while keeping different learners independent', async () => {
    injectedOffset = 0;
    const sameLearner = await createLearner('CAR');
    const sameResponses = await Promise.all([
      start(sameLearner.token, { payload: '{}', contentType: 'application/json' }),
      start(sameLearner.token, { payload: '{}', contentType: 'application/json' }),
    ]);
    expect(
      sameResponses.map(({ statusCode }) => statusCode).sort(),
      `concurrent start bodies: ${sameResponses.map(({ statusCode, body }) => `${statusCode} ${body.slice(0, 200)}`).join(' | ')}`,
    ).toEqual([200, 409]);
    expect(sameResponses.find(({ statusCode }) => statusCode === 409)?.json()).toEqual({ error: 'Exam already in progress' });
    expect(await database.examSession.count({ where: { userId: sameLearner.user.id } })).toBe(1);
    expect(await database.examQuestion.count({ where: { examSession: { userId: sameLearner.user.id } } })).toBe(50);

    const first = await createLearner('CAR');
    const second = await createLearner('CAR');
    const independent = await Promise.all([
      start(first.token, { payload: '{}', contentType: 'application/json' }),
      start(second.token, { payload: '{}', contentType: 'application/json' }),
    ]);
    expect(independent.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    expect(await database.examSession.count({ where: { userId: { in: [first.user.id, second.user.id] } } })).toBe(2);
  });

  it('classifies a real driver serialization conflict as retryable', async () => {
    const learner = await createLearner('CAR');
    let conflict: unknown;
    let induced = false;

    // Two serializable transactions read the learner's sessions, then both insert into that
    // same predicate. PostgreSQL must abort one of them, which is the conflict the endpoint
    // has to recognize. Asserting against the driver's own error, not a hand-written object,
    // is the point of this test.
    for (let attempt = 0; attempt < 3 && !induced; attempt++) {
      let release: (() => void) | undefined;
      const bothRead = new Promise<void>((resolve) => { release = resolve; });
      let arrived = 0;
      const insert = () => database.$transaction(async (transaction) => {
        await transaction.examSession.findMany({ where: { userId: learner.user.id }, select: { id: true } });
        arrived++;
        if (arrived === 2) release?.();
        await bothRead;
        const startedAt = new Date(clock.getTime() - attempt * 1_000);
        await transaction.examSession.create({ data: {
          userId: learner.user.id, vehicleType: 'CAR', passingScore: EXAM_PASSING_SCORE,
          startedAt, expiresAt: new Date(startedAt.getTime() + EXAM_DURATION_MS),
        } });
      }, { isolationLevel: 'Serializable' });

      const settled = await Promise.allSettled([insert(), insert()]);
      const rejected = settled.filter((outcome) => outcome.status === 'rejected');
      if (rejected.length === 1 && rejected[0]?.status === 'rejected') {
        conflict = rejected[0].reason;
        induced = true;
      }
    }

    expect(induced, 'PostgreSQL did not raise a serialization conflict to classify').toBe(true);
    expect(conflict).toBeInstanceOf(Error);
    expect(
      isSerializationFailure(conflict),
      `unrecognized conflict: ${conflict instanceof Error ? `${conflict.name}: ${conflict.message} cause ${JSON.stringify(conflict.cause)}` : String(conflict)}`,
    ).toBe(true);
    await database.examSession.deleteMany({ where: { userId: learner.user.id } });
  });

  it('keeps repeated concurrent starts converging on one session', async () => {
    injectedOffset = 0;
    for (let round = 0; round < 6; round++) {
      const learner = await createLearner('CAR');
      const responses = await Promise.all([
        start(learner.token, { payload: '{}', contentType: 'application/json' }),
        start(learner.token, { payload: '{}', contentType: 'application/json' }),
      ]);
      expect(
        responses.map(({ statusCode }) => statusCode).sort(),
        `round ${round} bodies: ${responses.map(({ statusCode, body }) => `${statusCode} ${body.slice(0, 200)}`).join(' | ')}`,
      ).toEqual([200, 409]);
      expect(await database.examSession.count({ where: { userId: learner.user.id } })).toBe(1);
    }
  }, 60_000);
});
