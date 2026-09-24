import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { currentExamResponseSchema, EXAM_DURATION_MS } from '../packages/database/src/exam.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for current exam integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_current_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const questionIds = Array.from({ length: 50 }, () => randomUUID());
const choiceIds = questionIds.map(() => Array.from({ length: 4 }, () => randomUUID()));
const clock = new Date('2026-09-24T08:00:00.123Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock });
let databaseCreated = false;
let telegramSequence = 71_000n;

function questionIdAt(index: number) {
  const id = questionIds[index];
  if (!id) throw new Error('Missing current exam question fixture');
  return id;
}

function choiceIdAt(questionIndex: number, choiceIndex: number) {
  const id = choiceIds[questionIndex]?.[choiceIndex];
  if (!id) throw new Error('Missing current exam choice fixture');
  return id;
}

function snapshot(index: number) {
  return {
    version: 1,
    question: {
      id: questionIdAt(index),
      textThai: `คำถาม ${index + 1}`,
      textExamEnglish: `Exam snapshot ${index + 1}`,
      textEnglish: `Immutable current question ${index + 1}`,
      textRussian: `Вопрос ${index + 1}`,
      choices: (['A', 'B', 'C', 'D'] as const).map((key, choiceIndex) => ({
        id: choiceIdAt(index, choiceIndex),
        key,
        textThai: null,
        textEnglish: `Immutable ${index + 1} choice ${key}`,
        textRussian: null,
      })),
    },
    correctChoiceId: choiceIdAt(index, 0),
    explanationThai: `อธิบาย ${index + 1}`,
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

async function createExam(options: {
  userId: string;
  startedAt: Date;
  id?: string;
  vehicleType?: 'CAR' | 'MOTORCYCLE';
  outcomes?: readonly (boolean | null)[];
  questionTotal?: number;
}) {
  const questionTotal = options.questionTotal ?? 50;
  const outcomes = options.outcomes ?? Array.from({ length: questionTotal }, () => null);
  return database.examSession.create({
    data: {
      ...(options.id === undefined ? {} : { id: options.id }),
      userId: options.userId,
      vehicleType: options.vehicleType ?? 'CAR',
      passingScore: 45,
      startedAt: options.startedAt,
      expiresAt: new Date(options.startedAt.getTime() + EXAM_DURATION_MS),
      questions: { create: Array.from({ length: questionTotal }, (_, index) => {
        const outcome = outcomes[index] ?? null;
        return {
          position: index + 1,
          questionId: questionIdAt(index),
          snapshot: snapshot(index),
          ...(outcome === null ? {} : {
            selectedChoiceId: choiceIdAt(index, outcome ? 0 : 1),
            isCorrect: outcome,
            answeredAt: new Date(options.startedAt.getTime() + 5 * 60_000),
          }),
        };
      }) },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

function current(token: string | undefined, query = '') {
  return app.inject({
    method: 'GET',
    url: `/exam/current${query}`,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

async function expectError(responsePromise: ReturnType<typeof current>, statusCode: number, error: string) {
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
    data: { id: categoryId, slug: 'exam-current', nameThai: 'exam', nameEnglish: 'exam', nameRussian: 'exam' },
  });
  await database.question.createMany({
    data: questionIds.map((id, index) => ({
      id,
      categoryId,
      vehicleType: 'CAR' as const,
      active: true,
      verificationStatus: 'VERIFIED' as const,
      sourceType: 'ORIGINAL' as const,
      sourceReference: `Hidden source ${index + 1}`,
      imageReference: `hidden-image-${index + 1}`,
      textEnglish: `Mutable source ${index + 1}`,
    })),
  });
  await database.questionChoice.createMany({
    data: questionIds.flatMap((questionId, questionIndex) => (
      (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
        id: choiceIdAt(questionIndex, index),
        questionId,
        key,
        textEnglish: `Mutable ${questionIndex + 1} choice ${key}`,
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

describe('GET /exam/current', () => {
  it('authenticates before exact empty-query validation', async () => {
    const learner = await createLearner();
    const expired = await createLearner('expired');
    const revoked = await createLearner('revoked');
    for (const token of [undefined, 'invalid', randomBytes(32).toString('base64url'), expired.token, revoked.token]) {
      await expectError(current(token, '?unknown=1'), 401, 'Unauthorized');
    }
    for (const query of ['?unknown=1', '?unknown=', '?unknown=1&unknown=2']) {
      await expectError(current(learner.token, query), 400, 'Bad Request');
    }
  });

  it('returns no current exam without disclosing another learner session', async () => {
    const learner = await createLearner();
    const stranger = await createLearner();
    const completed = await createExam({
      userId: learner.user.id,
      startedAt: new Date(clock.getTime() - 20 * 60_000),
      outcomes: Array.from({ length: 50 }, () => true),
    });
    await database.examSession.update({
      where: { id: completed.id }, data: { completedAt: clock, score: 50, passed: true },
    });
    await createExam({ userId: stranger.user.id, startedAt: new Date(clock.getTime() - 10 * 60_000) });
    await expectError(current(learner.token), 404, 'Exam not found');
  });

  it('returns an active immutable exam with persisted selections and no writes', async () => {
    const learner = await createLearner();
    const outcomes = Array.from({ length: 50 }, (_, index) => index < 4 ? index % 2 === 0 : null);
    const exam = await createExam({
      userId: learner.user.id,
      startedAt: new Date(clock.getTime() - 30 * 60_000),
      vehicleType: 'MOTORCYCLE',
      outcomes,
    });
    await database.question.update({
      where: { id: questionIdAt(0) },
      data: { textEnglish: 'Edited mutable wording', sourceReference: 'Edited hidden source' },
    });
    await database.questionChoice.update({
      where: { id: choiceIdAt(0, 0) }, data: { textEnglish: 'Edited mutable choice', isCorrect: false },
    });
    await database.questionChoice.update({ where: { id: choiceIdAt(0, 1) }, data: { isCorrect: true } });
    const beforeExam = await database.examSession.findUniqueOrThrow({
      where: { id: exam.id }, include: { questions: { orderBy: { position: 'asc' } } },
    });
    const beforeSideEffects = {
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    };

    const response = await current(learner.token);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = currentExamResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      examId: exam.id,
      vehicleType: 'MOTORCYCLE',
      serverTime: clock.toISOString(),
      expired: false,
      answeredCount: 4,
      remainingCount: 46,
    });
    expect(body.questions.map(({ position }) => position)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(body.questions[0]).toMatchObject({
      examQuestionId: exam.questions[0]!.id,
      selectedChoiceId: choiceIdAt(0, 0),
      answeredAt: new Date(exam.startedAt.getTime() + 5 * 60_000).toISOString(),
      question: { textEnglish: 'Immutable current question 1' },
    });
    expect(body.questions[1]).toMatchObject({ selectedChoiceId: choiceIdAt(1, 1) });
    expect(body.questions[4]).toMatchObject({ selectedChoiceId: null, answeredAt: null });
    expect(Object.keys(body).sort()).toEqual([
      'answeredCount', 'examId', 'expired', 'expiresAt', 'passingScore', 'questionCount', 'questions',
      'remainingCount', 'serverTime', 'startedAt', 'vehicleType',
    ]);
    expect(Object.keys(body.questions[0]!).sort()).toEqual([
      'answeredAt', 'examQuestionId', 'position', 'question', 'selectedChoiceId',
    ]);
    for (const privateValue of [
      learner.user.id, 'userId', 'isCorrect', 'correctChoiceId', 'score', 'passed', 'explanation',
      'Hidden source', 'hidden-image', 'Edited mutable wording', 'Edited mutable choice', 'Edited hidden source',
    ]) expect(response.body).not.toContain(privateValue);
    expect(await database.examSession.findUniqueOrThrow({
      where: { id: exam.id }, include: { questions: { orderBy: { position: 'asc' } } },
    })).toEqual(beforeExam);
    expect({
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    }).toEqual(beforeSideEffects);
  });

  it('returns the deterministic latest expired residue and marks exact expiry expired', async () => {
    const learner = await createLearner();
    const tiedStart = new Date(clock.getTime() - EXAM_DURATION_MS);
    const older = await createExam({
      id: '40000000-0000-4000-8000-000000000001',
      userId: learner.user.id,
      startedAt: new Date(tiedStart.getTime() - 1),
    });
    await createExam({
      id: '40000000-0000-4000-8000-000000000002',
      userId: learner.user.id,
      startedAt: tiedStart,
    });
    const newest = await createExam({
      id: '40000000-0000-4000-8000-000000000003',
      userId: learner.user.id,
      startedAt: tiedStart,
    });
    const response = await current(learner.token);
    const body = currentExamResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      examId: newest.id,
      serverTime: clock.toISOString(),
      expiresAt: clock.toISOString(),
      expired: true,
      answeredCount: 0,
      remainingCount: 50,
    });
    expect(body.examId).not.toBe(older.id);
  });

  it('fails closed when more than one owned uncompleted exam is active', async () => {
    const learner = await createLearner();
    await createExam({ userId: learner.user.id, startedAt: new Date(clock.getTime() - 20 * 60_000) });
    await createExam({ userId: learner.user.id, startedAt: new Date(clock.getTime() - 10 * 60_000) });
    await expectError(current(learner.token), 500, 'Internal Server Error');
  });

  it('fails the whole response on completion, policy, snapshot, answer, timing or cardinality corruption', async () => {
    const learner = await createLearner();
    const outcomes = Array.from({ length: 50 }, (_, index) => index === 0 ? true : null);
    const exam = await createExam({
      userId: learner.user.id,
      startedAt: new Date(clock.getTime() - 30 * 60_000),
      outcomes,
    });
    const target = exam.questions[0];
    if (!target) throw new Error('Missing current exam target question');
    const assertInternal = () => expectError(current(learner.token), 500, 'Internal Server Error');

    await database.examSession.update({ where: { id: exam.id }, data: { passingScore: 44 } });
    await assertInternal();
    await database.examSession.update({ where: { id: exam.id }, data: { passingScore: 45 } });

    await database.examSession.update({ where: { id: exam.id }, data: { expiresAt: new Date(exam.expiresAt.getTime() + 1) } });
    await assertInternal();
    await database.examSession.update({ where: { id: exam.id }, data: { expiresAt: exam.expiresAt } });

    await database.examQuestion.update({ where: { id: target.id }, data: { snapshot: { version: 2 } } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: target.id }, data: { snapshot: snapshot(0) } });

    await database.examQuestion.update({
      where: { id: target.id },
      data: { snapshot: { ...snapshot(0), question: { ...snapshot(0).question, id: randomUUID() } } },
    });
    await assertInternal();
    await database.examQuestion.update({ where: { id: target.id }, data: { snapshot: snapshot(0) } });

    await database.examQuestion.update({ where: { id: target.id }, data: { selectedChoiceId: randomUUID(), isCorrect: false } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: target.id }, data: { selectedChoiceId: choiceIdAt(0, 0), isCorrect: true } });

    await database.examQuestion.update({ where: { id: target.id }, data: { isCorrect: false } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: target.id }, data: { isCorrect: true } });

    await database.examQuestion.update({ where: { id: target.id }, data: { answeredAt: exam.expiresAt } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: target.id }, data: { answeredAt: new Date(exam.startedAt.getTime() + 5 * 60_000) } });

    await database.$executeRawUnsafe('ALTER TABLE "ExamQuestion" DROP CONSTRAINT "ExamQuestion_answer_tuple"');
    try {
      await database.$executeRawUnsafe(`UPDATE "ExamQuestion" SET "isCorrect" = NULL WHERE id = '${target.id}'::uuid`);
      await assertInternal();
    } finally {
      await database.$executeRawUnsafe(`UPDATE "ExamQuestion" SET "isCorrect" = true WHERE id = '${target.id}'::uuid`);
      await database.$executeRawUnsafe(`ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_answer_tuple" CHECK (
        ("selectedChoiceId" IS NULL AND "isCorrect" IS NULL AND "answeredAt" IS NULL)
        OR ("selectedChoiceId" IS NOT NULL AND "isCorrect" IS NOT NULL AND "answeredAt" IS NOT NULL)
      )`);
    }

    await database.$executeRawUnsafe('ALTER TABLE "ExamSession" DROP CONSTRAINT "ExamSession_completion_tuple"');
    try {
      await database.$executeRawUnsafe(`UPDATE "ExamSession" SET score = 0, passed = false WHERE id = '${exam.id}'::uuid`);
      await assertInternal();
    } finally {
      await database.$executeRawUnsafe(`UPDATE "ExamSession" SET score = NULL, passed = NULL WHERE id = '${exam.id}'::uuid`);
      await database.$executeRawUnsafe(`ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_completion_tuple" CHECK (
        ("completedAt" IS NULL AND score IS NULL AND passed IS NULL)
        OR ("completedAt" IS NOT NULL AND score IS NOT NULL AND passed IS NOT NULL)
      )`);
    }

    const shortLearner = await createLearner();
    await createExam({
      userId: shortLearner.user.id,
      startedAt: new Date(clock.getTime() - 30 * 60_000),
      questionTotal: 49,
    });
    await expectError(current(shortLearner.token), 500, 'Internal Server Error');
    expect((await current(learner.token)).statusCode).toBe(200);
  });
});
