import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient, type Prisma } from '../packages/database/src/index.ts';
import { EXAM_DURATION_MS, examAnswerResponseSchema, examCompleteResponseSchema } from '../packages/database/src/exam.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for exam completion integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_complete_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const questionIds = Array.from({ length: 50 }, () => randomUUID());
const choiceIds = questionIds.map(() => Array.from({ length: 4 }, () => randomUUID()));
let clock = new Date('2026-09-18T17:00:00.123Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock });
let databaseCreated = false;
let telegramSequence = 41_000n;

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
  return {
    version: 1,
    question: {
      id: questionIdAt(index),
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
    outcomes?: readonly (boolean | null)[];
    questionTotal?: number;
    session?: Partial<Prisma.ExamSessionUncheckedCreateInput>;
  } = {},
) {
  const questionTotal = options.questionTotal ?? 50;
  const outcomes = options.outcomes ?? Array.from({ length: questionTotal }, () => null);
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
        const outcome = outcomes[index] ?? null;
        const selectedChoiceId = choiceIdAt(index, outcome ? 0 : 1);
        return {
          position: index + 1,
          questionId: questionIdAt(index),
          snapshot: snapshot(index),
          ...(outcome === null ? {} : {
            selectedChoiceId,
            isCorrect: outcome,
            answeredAt: new Date(clock.getTime() - 1_000),
          }),
        };
      }) },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

function complete(
  token: string | undefined,
  options: { payload?: string; contentType?: string; query?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  return app.inject({
    method: 'POST',
    url: `/exam/complete${options.query ?? ''}`,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

function validPayload(examId: string) {
  return { payload: JSON.stringify({ examId }), contentType: 'application/json' };
}

function answer(token: string, examQuestionId: string, choiceId: string) {
  return app.inject({
    method: 'POST',
    url: '/exam/answer',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify({ examQuestionId, choiceId }),
  });
}

async function waitUntil(probe: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for PostgreSQL overlap state');
}

async function expectError(responsePromise: ReturnType<typeof complete>, statusCode: number, error: string) {
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
    data: { id: categoryId, slug: 'exam-complete', nameThai: 'exam', nameEnglish: 'exam', nameRussian: 'exam' },
  });
  await database.question.createMany({
    data: questionIds.map((id, index) => ({
      id,
      categoryId,
      vehicleType: 'CAR' as const,
      active: true,
      verificationStatus: 'VERIFIED' as const,
      sourceType: 'ORIGINAL' as const, legalCitation: 'Synthetic development citation, not legal guidance',
      textEnglish: `Source wording ${index + 1}`,
    })),
  });
  await database.questionChoice.createMany({
    data: questionIds.flatMap((questionId, questionIndex) => (
      (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
        id: choiceIdAt(questionIndex, index),
        questionId,
        key,
        textEnglish: `Source ${questionIndex + 1} choice ${key}`,
        isCorrect: index === 0,
      }))
    )),
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

describe('POST /exam/complete', () => {
  it('authenticates before strict query/body validation and rejects noncanonical requests', async () => {
    const learner = await createLearner();
    const expired = await createLearner('expired');
    const revoked = await createLearner('revoked');
    const malformed = { payload: '{', contentType: 'application/json', query: '?unknown=1' };
    await expectError(complete(undefined, malformed), 401, 'Unauthorized');
    await expectError(complete('invalid', malformed), 401, 'Unauthorized');
    await expectError(complete(randomBytes(32).toString('base64url'), malformed), 401, 'Unauthorized');
    await expectError(complete(expired.token, malformed), 401, 'Unauthorized');
    await expectError(complete(revoked.token, malformed), 401, 'Unauthorized');

    const examId = randomUUID();
    for (const options of [
      { payload: '{', contentType: 'application/json' },
      { payload: 'null', contentType: 'application/json' },
      { payload: '[]', contentType: 'application/json' },
      { payload: '{}', contentType: 'application/json' },
      { payload: JSON.stringify({ unknown: examId }), contentType: 'application/json' },
      { payload: JSON.stringify({ examId, unknown: true }), contentType: 'application/json' },
      { payload: `{"examId":"${examId}","examId":"${randomUUID()}"}`, contentType: 'application/json' },
      { payload: JSON.stringify({ examId: examId.toUpperCase() }), contentType: 'application/json' },
      { payload: JSON.stringify({ examId }), contentType: 'application/xml' },
      { payload: JSON.stringify({ examId }), contentType: 'application/json', query: '?unknown=1' },
      {},
    ]) await expectError(complete(learner.token, options), 400, 'Bad Request');
  });

  it('does not disclose absent or other-user exams', async () => {
    const owner = await createLearner();
    const stranger = await createLearner();
    const exam = await createExam(owner.user.id);
    await expectError(complete(stranger.token, validPayload(exam.id)), 404, 'Exam not found');
    await expectError(complete(owner.token, validPayload(randomUUID())), 404, 'Exam not found');
    expect((await database.examSession.findUniqueOrThrow({ where: { id: exam.id } })).completedAt).toBeNull();
  });

  it('rejects an early incomplete exam without writes and completes all answers early', async () => {
    const incompleteLearner = await createLearner();
    const incomplete = await createExam(incompleteLearner.user.id, {
      outcomes: [...Array.from({ length: 49 }, () => true), null],
    });
    await expectError(complete(incompleteLearner.token, validPayload(incomplete.id)), 409, 'Exam incomplete');
    expect(await database.examSession.findUniqueOrThrow({ where: { id: incomplete.id } })).toMatchObject({
      completedAt: null, score: null, passed: null,
    });

    const completeLearner = await createLearner();
    const allAnswered = await createExam(completeLearner.user.id, {
      outcomes: [...Array.from({ length: 45 }, () => true), ...Array.from({ length: 5 }, () => false)],
    });
    const response = await complete(completeLearner.token, validPayload(allAnswered.id));
    expect(response.statusCode).toBe(200);
    expect(examCompleteResponseSchema.parse(response.json())).toEqual({
      examId: allAnswered.id,
      questionCount: 50,
      answeredCount: 50,
      unansweredCount: 0,
      score: 45,
      passingScore: 45,
      passed: true,
      completedAt: clock.toISOString(),
    });
  });

  it('completes at exact expiry and after expiry with unanswered questions counted incorrect', async () => {
    for (const elapsed of [EXAM_DURATION_MS, EXAM_DURATION_MS + 1]) {
      const learner = await createLearner();
      const startedAt = new Date(clock.getTime() - elapsed);
      const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
      const exam = await createExam(learner.user.id, {
        outcomes: [...Array.from({ length: 44 }, () => true), ...Array.from({ length: 3 }, () => false), null, null, null],
        session: { startedAt, expiresAt },
      });
      const response = await complete(learner.token, validPayload(exam.id));
      expect(response.statusCode).toBe(200);
      expect(examCompleteResponseSchema.parse(response.json())).toMatchObject({
        answeredCount: 47, unansweredCount: 3, score: 44, passed: false, completedAt: clock.toISOString(),
      });
    }
  });

  it('scores immutable snapshots after source edits and enforces the 44/45 boundary', async () => {
    await database.question.update({ where: { id: questionIdAt(0) }, data: { textEnglish: 'Edited source wording' } });
    await database.questionChoice.update({ where: { id: choiceIdAt(0, 0) }, data: { isCorrect: false } });
    await database.questionChoice.update({ where: { id: choiceIdAt(0, 1) }, data: { isCorrect: true } });
    for (const score of [44, 45]) {
      const learner = await createLearner();
      const exam = await createExam(learner.user.id, {
        outcomes: [
          ...Array.from({ length: score }, () => true),
          ...Array.from({ length: 50 - score }, () => false),
        ],
      });
      const response = await complete(learner.token, validPayload(exam.id));
      expect(examCompleteResponseSchema.parse(response.json())).toMatchObject({ score, passed: score === 45 });
    }
  });

  it('rolls back corrupt snapshots, answers, configuration and cardinality', async () => {
    const corruptions: Array<(exam: Awaited<ReturnType<typeof createExam>>) => Promise<unknown>> = [
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { snapshot: { version: 2 } } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { snapshot: { ...snapshot(0), question: { ...snapshot(0).question, id: randomUUID() } } } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { isCorrect: false } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { selectedChoiceId: randomUUID(), isCorrect: false } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { answeredAt: exam.expiresAt } }),
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { passingScore: 44 } }),
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { expiresAt: new Date(exam.expiresAt.getTime() + 1) } }),
    ];
    for (const corrupt of corruptions) {
      const learner = await createLearner();
      const exam = await createExam(learner.user.id, { outcomes: Array.from({ length: 50 }, () => true) });
      await corrupt(exam);
      await expectError(complete(learner.token, validPayload(exam.id)), 500, 'Internal Server Error');
      expect(await database.examSession.findUniqueOrThrow({ where: { id: exam.id } })).toMatchObject({
        completedAt: null, score: null, passed: null,
      });
    }

    const learner = await createLearner();
    const shortExam = await createExam(learner.user.id, { questionTotal: 49, outcomes: Array.from({ length: 49 }, () => true) });
    await expectError(complete(learner.token, validPayload(shortExam.id)), 500, 'Internal Server Error');
    expect((await database.examSession.findUniqueOrThrow({ where: { id: shortExam.id } })).completedAt).toBeNull();
  });

  it('is sequentially idempotent and rejects an inconsistent persisted result', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { outcomes: Array.from({ length: 50 }, (_, index) => index < 45) });
    const first = await complete(learner.token, validPayload(exam.id));
    clock = new Date(clock.getTime() + 2_000);
    const repeated = await complete(learner.token, validPayload(exam.id));
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());

    const corruptLearner = await createLearner();
    const corrupt = await createExam(corruptLearner.user.id, {
      outcomes: Array.from({ length: 50 }, (_, index) => index < 45),
      session: { completedAt: clock, score: 44, passed: false },
    });
    await expectError(complete(corruptLearner.token, validPayload(corrupt.id)), 500, 'Internal Server Error');

    const earlyLearner = await createLearner();
    const early = await createExam(earlyLearner.user.id, {
      session: { completedAt: clock, score: 0, passed: false },
    });
    await expectError(complete(earlyLearner.token, validPayload(early.id)), 500, 'Internal Server Error');
  });

  it('makes concurrent completion converge on one immutable tuple', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { outcomes: Array.from({ length: 50 }, (_, index) => index < 45) });
    const responses = await Promise.all([
      complete(learner.token, validPayload(exam.id)),
      complete(learner.token, validPayload(exam.id)),
    ]);
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    expect(responses[1]?.json()).toEqual(responses[0]?.json());
    expect(await database.examSession.findUniqueOrThrow({ where: { id: exam.id } })).toMatchObject({
      completedAt: clock, score: 45, passed: true,
    });
  });

  it('serializes a final pre-expiry answer with exact-expiry completion', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, {
      outcomes: [...Array.from({ length: 49 }, () => true), null],
    });
    const finalQuestion = exam.questions[49];
    if (!finalQuestion) throw new Error('Missing final exam question');
    const correctChoiceId = choiceIdAt(49, 0);
    const lockKey1 = 32_032;
    const lockKey2 = 1;
    const blocker = new pg.Client({ connectionString: isolatedUrl.toString(), connectionTimeoutMillis: 5_000 });
    await blocker.connect();
    await database.$executeRawUnsafe(`
      CREATE FUNCTION block_final_exam_answer() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${lockKey1}, ${lockKey2});
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await database.$executeRawUnsafe(`
      CREATE TRIGGER block_final_exam_answer
      BEFORE UPDATE ON "ExamQuestion"
      FOR EACH ROW
      WHEN (OLD."answeredAt" IS NULL AND NEW."answeredAt" IS NOT NULL)
      EXECUTE FUNCTION block_final_exam_answer()
    `);
    await blocker.query('SELECT pg_advisory_lock($1, $2)', [lockKey1, lockKey2]);

    let answerResponse: Awaited<ReturnType<typeof answer>> | undefined;
    let completionResponse: Awaited<ReturnType<typeof complete>> | undefined;
    try {
      clock = new Date(exam.expiresAt.getTime() - 1);
      const answerPromise = answer(learner.token, finalQuestion.id, correctChoiceId);
      await waitUntil(async () => {
        const waiting = await blocker.query<{ waiting: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory'
              AND classid = $1::oid
              AND objid = $2::oid
              AND granted = false
          ) AS waiting
        `, [lockKey1, lockKey2]);
        return waiting.rows[0]?.waiting === true;
      });

      clock = exam.expiresAt;
      const completionPromise = complete(learner.token, validPayload(exam.id));
      await waitUntil(async () => {
        const waiting = await blocker.query<{ waiting: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND query LIKE '%FOR UPDATE OF session%'
              AND wait_event_type = 'Lock'
          ) AS waiting
        `);
        return waiting.rows[0]?.waiting === true;
      });

      await blocker.query('SELECT pg_advisory_unlock($1, $2)', [lockKey1, lockKey2]);
      [answerResponse, completionResponse] = await Promise.all([answerPromise, completionPromise]);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1, $2)', [lockKey1, lockKey2]).catch(() => undefined);
      await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS block_final_exam_answer ON "ExamQuestion"');
      await database.$executeRawUnsafe('DROP FUNCTION IF EXISTS block_final_exam_answer()');
      await blocker.end();
    }

    expect(answerResponse?.statusCode).toBe(200);
    expect(examAnswerResponseSchema.parse(answerResponse?.json())).toMatchObject({
      examId: exam.id,
      examQuestionId: finalQuestion.id,
      answeredCount: 50,
      remainingCount: 0,
    });
    expect(completionResponse?.statusCode).toBe(200);
    expect(examCompleteResponseSchema.parse(completionResponse?.json())).toMatchObject({
      examId: exam.id,
      answeredCount: 50,
      unansweredCount: 0,
      score: 50,
      passed: true,
      completedAt: exam.expiresAt.toISOString(),
    });
    const persisted = await database.examSession.findUniqueOrThrow({
      where: { id: exam.id },
      include: { questions: true },
    });
    expect(persisted).toMatchObject({ completedAt: exam.expiresAt, score: 50, passed: true });
    expect(persisted.questions.filter(({ isCorrect }) => isCorrect === true)).toHaveLength(50);

    const answeredAt = persisted.questions.find(({ id }) => id === finalQuestion.id)?.answeredAt;
    await expectError(answer(learner.token, finalQuestion.id, correctChoiceId), 409, 'Exam already completed');
    expect((await database.examQuestion.findUniqueOrThrow({ where: { id: finalQuestion.id } })).answeredAt).toEqual(answeredAt);
    expect((await complete(learner.token, validPayload(exam.id))).json()).toEqual(completionResponse?.json());
  });

  it('returns only the safe summary and has no practice side effects', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { outcomes: Array.from({ length: 50 }, (_, index) => index < 45) });
    const before = {
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    };
    const response = await complete(learner.token, validPayload(exam.id));
    const body = examCompleteResponseSchema.parse(response.json());
    expect(Object.keys(body).sort()).toEqual([
      'answeredCount', 'completedAt', 'examId', 'passed', 'passingScore', 'questionCount', 'score', 'unansweredCount',
    ]);
    for (const privateValue of [
      'selectedChoiceId', 'correctChoiceId', 'isCorrect', 'questions', 'explanation', 'source', learner.user.id,
    ]) expect(response.body).not.toContain(privateValue);
    expect({
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    }).toEqual(before);
  });
});
