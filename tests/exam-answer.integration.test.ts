import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient, type Prisma } from '../packages/database/src/index.ts';
import { EXAM_DURATION_MS, examAnswerResponseSchema } from '../packages/database/src/exam.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for exam answer integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_answer_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const questionIds = Array.from({ length: 50 }, () => randomUUID());
const choiceIds = questionIds.map(() => Array.from({ length: 4 }, () => randomUUID()));
const requestTime = new Date('2026-09-17T15:00:00.123Z');
const clock = requestTime;
const app = createApi({ database, botToken: 'synthetic', now: () => clock });
let databaseCreated = false;
let telegramSequence = 31_000n;

function questionIdAt(index: number) {
  const id = questionIds[index];
  if (!id) throw new Error('Missing exam question fixture');
  return id;
}

function choiceIdAt(questionIndex: number, choiceIndex: number) {
  const id = choiceIds[questionIndex]?.[choiceIndex];
  if (!id) throw new Error('Missing exam choice fixture');
  return id;
}

function snapshot(index: number) {
  const questionId = questionIdAt(index);
  return {
    version: 1,
    question: {
      id: questionId,
      textThai: null,
      textExamEnglish: `Exam wording ${index + 1}`,
      textEnglish: `Snapshot wording ${index + 1}`,
      textRussian: null,
      choices: (['A', 'B', 'C', 'D'] as const).map((key, choiceIndex) => ({
        id: choiceIdAt(index, choiceIndex),
        key,
        textThai: null,
        textEnglish: `Snapshot ${index + 1} choice ${key}`,
        textRussian: null,
      })),
    },
    correctChoiceId: choiceIdAt(index, 0),
    explanationThai: null,
    explanationEnglish: `Private explanation ${index + 1}`,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: `Private trap ${index + 1}`,
    trapExplanationRussian: null,
  };
}

async function createLearner(sessionState: 'valid' | 'expired' | 'revoked' = 'valid') {
  telegramSequence++;
  const token = randomBytes(32).toString('base64url');
  const user = await database.user.create({
    data: {
      telegramUserId: telegramSequence,
      selectedVehicleType: 'CAR',
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

async function createExam(
  userId: string,
  options: {
    questionTotal?: number;
    answeredCount?: number;
    session?: Partial<Prisma.ExamSessionUncheckedCreateInput>;
    targetSnapshot?: Prisma.InputJsonValue;
  } = {},
) {
  const questionTotal = options.questionTotal ?? 50;
  const answeredCount = options.answeredCount ?? 0;
  const startedAt = new Date(clock.getTime() - EXAM_DURATION_MS / 2);
  const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
  return database.examSession.create({
    data: {
      userId,
      vehicleType: 'CAR',
      passingScore: 45,
      startedAt,
      expiresAt,
      ...options.session,
      questions: { create: Array.from({ length: questionTotal }, (_, index) => {
        const selectedChoiceId = choiceIdAt(index, 0);
        const answered = index < answeredCount;
        return {
          position: index + 1,
          questionId: questionIdAt(index),
          snapshot: index === 0 && options.targetSnapshot ? options.targetSnapshot : snapshot(index),
          ...(answered ? { selectedChoiceId, isCorrect: true, answeredAt: new Date(clock.getTime() - 1_000) } : {}),
        };
      }) },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

function answer(
  token: string | undefined,
  options: { payload?: string; contentType?: string; query?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  return app.inject({
    method: 'POST',
    url: `/exam/answer${options.query ?? ''}`,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

function validPayload(examQuestionId: string, choiceId: string) {
  return { payload: JSON.stringify({ examQuestionId, choiceId }), contentType: 'application/json' };
}

async function expectError(responsePromise: ReturnType<typeof answer>, statusCode: number, error: string) {
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
    data: { id: categoryId, slug: 'exam-answer', nameThai: 'exam', nameEnglish: 'exam', nameRussian: 'exam' },
  });
  await database.question.createMany({
    data: questionIds.map((id, index) => ({
      id,
      categoryId,
      vehicleType: 'CAR' as const,
      active: true,
      verificationStatus: 'VERIFIED' as const,
      sourceType: 'ORIGINAL' as const,
      textEnglish: `Source wording ${index + 1}`,
    })),
  });
  await database.questionChoice.createMany({
    data: questionIds.flatMap((questionId, questionIndex) => {
      return (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
        id: choiceIdAt(questionIndex, index),
        questionId,
        key,
        textEnglish: `Source ${questionIndex + 1} choice ${key}`,
        isCorrect: index === 0,
      }));
    }),
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

describe('POST /exam/answer', () => {
  it('authenticates before strict query/body validation and rejects every noncanonical request', async () => {
    const learner = await createLearner();
    const expired = await createLearner('expired');
    const revoked = await createLearner('revoked');
    const malformed = { payload: '{', contentType: 'application/json', query: '?unknown=1' };
    await expectError(answer(undefined, malformed), 401, 'Unauthorized');
    await expectError(answer('invalid', malformed), 401, 'Unauthorized');
    await expectError(answer(randomBytes(32).toString('base64url'), malformed), 401, 'Unauthorized');
    await expectError(answer(expired.token, malformed), 401, 'Unauthorized');
    await expectError(answer(revoked.token, malformed), 401, 'Unauthorized');

    const examQuestionId = randomUUID();
    const choiceId = randomUUID();
    for (const options of [
      { payload: '{', contentType: 'application/json' },
      { payload: 'null', contentType: 'application/json' },
      { payload: '[]', contentType: 'application/json' },
      { payload: '{}', contentType: 'application/json' },
      { payload: JSON.stringify({ examQuestionId }), contentType: 'application/json' },
      { payload: JSON.stringify({ examQuestionId, choiceId, unknown: true }), contentType: 'application/json' },
      { payload: `{"examQuestionId":"${examQuestionId}","choiceId":"${choiceId}","choiceId":"${randomUUID()}"}`, contentType: 'application/json' },
      { payload: JSON.stringify({ examQuestionId: examQuestionId.toUpperCase(), choiceId }), contentType: 'application/json' },
      { payload: JSON.stringify({ examQuestionId, choiceId }), contentType: 'application/xml' },
      { payload: JSON.stringify({ examQuestionId, choiceId }), contentType: 'application/json', query: '?unknown=1' },
      {},
    ]) await expectError(answer(learner.token, options), 400, 'Bad Request');
  });

  it('does not disclose absent or other-user exam questions', async () => {
    const owner = await createLearner();
    const stranger = await createLearner();
    const exam = await createExam(owner.user.id);
    const target = exam.questions[0];
    const choiceId = choiceIds[0]?.[0];
    if (!target || !choiceId) throw new Error('Missing target');
    await expectError(answer(stranger.token, validPayload(target.id, choiceId)), 404, 'Exam question not found');
    await expectError(answer(owner.token, validPayload(randomUUID(), choiceId)), 404, 'Exam question not found');
    expect((await database.examQuestion.findUniqueOrThrow({ where: { id: target.id } })).answeredAt).toBeNull();
  });

  it('scores correct and incorrect answers only from immutable snapshots after source edits', async () => {
    const correctLearner = await createLearner();
    const incorrectLearner = await createLearner();
    const correctExam = await createExam(correctLearner.user.id);
    const incorrectExam = await createExam(incorrectLearner.user.id);
    const firstIds = choiceIds[0];
    const correctTarget = correctExam.questions[0];
    const incorrectTarget = incorrectExam.questions[0];
    if (!firstIds || !correctTarget || !incorrectTarget) throw new Error('Missing target');
    await database.question.update({ where: { id: questionIdAt(0) }, data: { textEnglish: 'Edited after exam start' } });
    await database.questionChoice.update({ where: { id: choiceIdAt(0, 0) }, data: { isCorrect: false } });
    await database.questionChoice.update({ where: { id: choiceIdAt(0, 1) }, data: { isCorrect: true } });

    const correctResponse = await answer(correctLearner.token, validPayload(correctTarget.id, firstIds[0] as string));
    expect(correctResponse.statusCode).toBe(200);
    const correctBody = examAnswerResponseSchema.parse(correctResponse.json());
    expect(correctBody).toEqual({
      examId: correctExam.id,
      examQuestionId: correctTarget.id,
      selectedChoiceId: firstIds[0],
      answeredAt: requestTime.toISOString(),
      answeredCount: 1,
      remainingCount: 49,
    });
    expect(Object.keys(correctBody).sort()).toEqual(['answeredAt', 'answeredCount', 'examId', 'examQuestionId', 'remainingCount', 'selectedChoiceId']);
    for (const privateValue of ['isCorrect', 'correctChoiceId', 'score', 'passed', 'explanation', correctLearner.user.id]) {
      expect(correctResponse.body).not.toContain(privateValue);
    }
    expect(await database.examQuestion.findUniqueOrThrow({ where: { id: correctTarget.id } })).toMatchObject({
      selectedChoiceId: firstIds[0], isCorrect: true, answeredAt: requestTime,
    });

    const incorrectResponse = await answer(incorrectLearner.token, validPayload(incorrectTarget.id, firstIds[1] as string));
    expect(incorrectResponse.statusCode).toBe(200);
    expect(await database.examQuestion.findUniqueOrThrow({ where: { id: incorrectTarget.id } })).toMatchObject({
      selectedChoiceId: firstIds[1], isCorrect: false, answeredAt: requestTime,
    });
  });

  it('rejects choices outside the snapshot and rolls back malformed or inconsistent snapshots', async () => {
    const invalidChoiceLearner = await createLearner();
    const invalidChoiceExam = await createExam(invalidChoiceLearner.user.id);
    const invalidTarget = invalidChoiceExam.questions[0];
    if (!invalidTarget) throw new Error('Missing target');
    await expectError(answer(invalidChoiceLearner.token, validPayload(invalidTarget.id, randomUUID())), 400, 'Bad Request');
    expect((await database.examQuestion.findUniqueOrThrow({ where: { id: invalidTarget.id } })).answeredAt).toBeNull();

    for (const targetSnapshot of [
      { version: 2 },
      { ...snapshot(0), question: { ...snapshot(0).question, id: randomUUID() } },
    ]) {
      const learner = await createLearner();
      const exam = await createExam(learner.user.id, { targetSnapshot });
      const target = exam.questions[0];
      const choiceId = choiceIds[0]?.[0];
      if (!target || !choiceId) throw new Error('Missing target');
      await expectError(answer(learner.token, validPayload(target.id, choiceId)), 500, 'Internal Server Error');
      expect(await database.examQuestion.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        selectedChoiceId: null, isCorrect: null, answeredAt: null,
      });
    }
  });

  it('fails closed for incomplete session cardinality without a partial answer', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { questionTotal: 49 });
    const target = exam.questions[0];
    const choiceId = choiceIds[0]?.[0];
    if (!target || !choiceId) throw new Error('Missing target');
    await expectError(answer(learner.token, validPayload(target.id, choiceId)), 500, 'Internal Server Error');
    expect((await database.examQuestion.findUniqueOrThrow({ where: { id: target.id } })).answeredAt).toBeNull();
  });

  it('applies completed, expiry, then duplicate precedence at the request-time boundary', async () => {
    const choiceId = choiceIds[0]?.[0];
    if (!choiceId) throw new Error('Missing choice');
    const completedLearner = await createLearner();
    const completed = await createExam(completedLearner.user.id, {
      answeredCount: 1,
      session: { completedAt: new Date(clock.getTime() - 1), score: 45, passed: true },
    });
    await expectError(answer(completedLearner.token, validPayload(completed.questions[0]!.id, choiceId)), 409, 'Exam already completed');

    const expiredLearner = await createLearner();
    const expired = await createExam(expiredLearner.user.id, {
      answeredCount: 1,
      session: { startedAt: new Date(clock.getTime() - EXAM_DURATION_MS), expiresAt: clock },
    });
    await expectError(answer(expiredLearner.token, validPayload(expired.questions[0]!.id, choiceId)), 409, 'Exam expired');

    const duplicateLearner = await createLearner();
    const duplicate = await createExam(duplicateLearner.user.id, { answeredCount: 1 });
    await expectError(answer(duplicateLearner.token, validPayload(duplicate.questions[0]!.id, choiceId)), 409, 'Answer already submitted');
  });

  it('persists one sequential answer and returns stable progress for the duplicate', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { answeredCount: 4 });
    const target = exam.questions[4];
    const choiceId = choiceIds[4]?.[0];
    if (!target || !choiceId) throw new Error('Missing target');
    const first = await answer(learner.token, validPayload(target.id, choiceId));
    expect(first.statusCode).toBe(200);
    expect(examAnswerResponseSchema.parse(first.json())).toMatchObject({ answeredCount: 5, remainingCount: 45 });
    await expectError(answer(learner.token, validPayload(target.id, choiceId)), 409, 'Answer already submitted');
    expect(await database.examQuestion.count({ where: { examSessionId: exam.id, answeredAt: { not: null } } })).toBe(5);
  });

  it('allows exactly one concurrent submission and stores one complete tuple', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id);
    const target = exam.questions[0];
    const choiceId = choiceIds[0]?.[0];
    if (!target || !choiceId) throw new Error('Missing target');
    const responses = await Promise.all([
      answer(learner.token, validPayload(target.id, choiceId)),
      answer(learner.token, validPayload(target.id, choiceId)),
    ]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(responses.find(({ statusCode }) => statusCode === 409)?.json()).toEqual({ error: 'Answer already submitted' });
    expect(await database.examQuestion.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      selectedChoiceId: choiceId, isCorrect: true, answeredAt: requestTime,
    });
    expect(await database.examQuestion.count({ where: { examSessionId: exam.id, answeredAt: { not: null } } })).toBe(1);
  });

  it('acknowledges the 50th answer without completing the session or writing practice state', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { answeredCount: 49 });
    const target = exam.questions[49];
    const choiceId = choiceIds[49]?.[0];
    if (!target || !choiceId) throw new Error('Missing target');
    const before = {
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    };
    const response = await answer(learner.token, validPayload(target.id, choiceId));
    expect(response.statusCode).toBe(200);
    expect(examAnswerResponseSchema.parse(response.json())).toMatchObject({ answeredCount: 50, remainingCount: 0 });
    expect(await database.examSession.findUniqueOrThrow({ where: { id: exam.id } })).toMatchObject({
      completedAt: null, score: null, passed: null,
    });
    expect({
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    }).toEqual(before);
  });
});
