import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient, type Prisma } from '../packages/database/src/index.ts';
import { EXAM_DURATION_MS, examResultResponseSchema } from '../packages/database/src/exam.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for exam result integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_result_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const questionIds = Array.from({ length: 50 }, () => randomUUID());
const choiceIds = questionIds.map(() => Array.from({ length: 4 }, () => randomUUID()));
const clock = new Date('2026-09-19T09:30:00.123Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock });
let databaseCreated = false;
let telegramSequence = 43_000n;

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
    explanationEnglish: `Explanation ${index + 1}`,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: `Trap ${index + 1}`,
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

const startedAt = new Date(clock.getTime() - EXAM_DURATION_MS - 60_000);
const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
const answeredAt = new Date(startedAt.getTime() + 1_000);

async function createExam(
  userId: string,
  options: {
    outcomes?: readonly (boolean | null)[];
    questionTotal?: number;
    completed?: boolean;
    session?: Partial<Prisma.ExamSessionUncheckedCreateInput>;
  } = {},
) {
  const questionTotal = options.questionTotal ?? 50;
  const outcomes = options.outcomes ?? Array.from({ length: questionTotal }, () => null);
  const answeredCount = outcomes.filter((outcome) => outcome !== null).length;
  const score = outcomes.filter((outcome) => outcome === true).length;
  const completion = options.completed === false ? {} : {
    completedAt: answeredCount === questionTotal ? new Date(answeredAt.getTime() + 1_000) : expiresAt,
    score,
    passed: score >= 45,
  };
  return database.examSession.create({
    data: {
      userId,
      vehicleType: 'CAR',
      passingScore: 45,
      startedAt,
      expiresAt,
      ...completion,
      ...options.session,
      questions: { create: Array.from({ length: questionTotal }, (_, index) => {
        const outcome = outcomes[index] ?? null;
        return {
          position: index + 1,
          questionId: questionIdAt(index),
          snapshot: snapshot(index),
          ...(outcome === null ? {} : {
            selectedChoiceId: choiceIdAt(index, outcome ? 0 : 1),
            isCorrect: outcome,
            answeredAt,
          }),
        };
      }) },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

function review(token: string | undefined, examId: string, query = '') {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return app.inject({ method: 'GET', url: `/exam/${examId}/result${query}`, headers });
}

async function expectError(responsePromise: ReturnType<typeof review>, statusCode: number, error: string) {
  const response = await responsePromise;
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toEqual({ error });
  expect(response.headers['cache-control']).toBe('no-store');
}

async function snapshotOfDatabase() {
  return {
    sessions: await database.examSession.findMany({ orderBy: { id: 'asc' } }),
    questions: await database.examQuestion.findMany({ orderBy: { id: 'asc' } }),
    presentations: await database.questionPresentation.count(),
    attempts: await database.answerAttempt.count(),
    favorites: await database.favorite.count(),
  };
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
    data: { id: categoryId, slug: 'exam-result', nameThai: 'exam', nameEnglish: 'exam', nameRussian: 'exam' },
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

describe('GET /exam/:examId/result', () => {
  it('authenticates before strict parameter/query validation', async () => {
    const learner = await createLearner();
    const expired = await createLearner('expired');
    const revoked = await createLearner('revoked');
    await expectError(review(undefined, 'not-a-uuid', '?unknown=1'), 401, 'Unauthorized');
    await expectError(review('invalid', 'not-a-uuid', '?unknown=1'), 401, 'Unauthorized');
    await expectError(review(randomBytes(32).toString('base64url'), 'not-a-uuid'), 401, 'Unauthorized');
    await expectError(review(expired.token, 'not-a-uuid'), 401, 'Unauthorized');
    await expectError(review(revoked.token, 'not-a-uuid'), 401, 'Unauthorized');

    const exam = await createExam(learner.user.id, { outcomes: Array.from({ length: 50 }, () => true) });
    await expectError(review(learner.token, 'not-a-uuid'), 400, 'Bad Request');
    await expectError(review(learner.token, exam.id.toUpperCase()), 400, 'Bad Request');
    await expectError(review(learner.token, exam.id, '?unknown=1'), 400, 'Bad Request');
    await expectError(review(learner.token, exam.id, '?examId='), 400, 'Bad Request');
  });

  it('does not disclose absent, other-user or incomplete exams', async () => {
    const owner = await createLearner();
    const stranger = await createLearner();
    const completed = await createExam(owner.user.id, { outcomes: Array.from({ length: 50 }, () => true) });
    await expectError(review(stranger.token, completed.id), 404, 'Exam not found');
    await expectError(review(owner.token, randomUUID()), 404, 'Exam not found');

    const open = await createExam(owner.user.id, {
      outcomes: [...Array.from({ length: 49 }, () => true), null],
      completed: false,
      session: { startedAt: new Date(clock.getTime() - 1_000), expiresAt: new Date(clock.getTime() - 1_000 + EXAM_DURATION_MS) },
    });
    const expiredOpen = await createExam(owner.user.id, { outcomes: Array.from({ length: 50 }, () => true), completed: false });
    const before = await snapshotOfDatabase();
    await expectError(review(owner.token, open.id), 409, 'Exam not completed');
    await expectError(review(owner.token, expiredOpen.id), 409, 'Exam not completed');
    expect(await snapshotOfDatabase()).toEqual(before);
  });

  it('returns the full per-question review of a completed exam with no side effects', async () => {
    const learner = await createLearner();
    const outcomes = [...Array.from({ length: 44 }, () => true), ...Array.from({ length: 3 }, () => false), null, null, null];
    const exam = await createExam(learner.user.id, { outcomes });
    const before = await snapshotOfDatabase();
    const response = await review(learner.token, exam.id);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = examResultResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      examId: exam.id,
      vehicleType: 'CAR',
      questionCount: 50,
      answeredCount: 47,
      unansweredCount: 3,
      score: 44,
      passingScore: 45,
      passed: false,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      completedAt: expiresAt.toISOString(),
    });
    expect(body.questions).toHaveLength(50);
    expect(body.questions[0]).toEqual({
      examQuestionId: exam.questions[0]!.id,
      position: 1,
      question: snapshot(0).question,
      selectedChoiceId: choiceIdAt(0, 0),
      correctChoiceId: choiceIdAt(0, 0),
      isCorrect: true,
      answeredAt: answeredAt.toISOString(),
      explanationThai: null,
      explanationEnglish: 'Explanation 1',
      explanationRussian: null,
      trapExplanationThai: null,
      trapExplanationEnglish: 'Trap 1',
      trapExplanationRussian: null,
    });
    expect(body.questions[44]).toMatchObject({
      position: 45, selectedChoiceId: choiceIdAt(44, 1), correctChoiceId: choiceIdAt(44, 0), isCorrect: false,
    });
    expect(body.questions[49]).toMatchObject({
      position: 50, selectedChoiceId: null, isCorrect: null, answeredAt: null, correctChoiceId: choiceIdAt(49, 0),
      explanationEnglish: 'Explanation 50',
    });
    const raw = JSON.stringify(response.json());
    for (const forbidden of ['Source wording', 'sourceType', 'imageUrl', 'userId', 'telegramUserId', 'ORIGINAL', 'VERIFIED']) {
      expect(raw).not.toContain(forbidden);
    }
    expect(await snapshotOfDatabase()).toEqual(before);
  });

  it('reviews immutable snapshots after source edits', async () => {
    await database.question.update({ where: { id: questionIdAt(0) }, data: { textEnglish: 'Edited source wording' } });
    await database.questionChoice.update({ where: { id: choiceIdAt(0, 0) }, data: { isCorrect: false, textEnglish: 'Edited choice' } });
    await database.questionChoice.update({ where: { id: choiceIdAt(0, 1) }, data: { isCorrect: true } });
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { outcomes: Array.from({ length: 50 }, () => true) });
    const body = examResultResponseSchema.parse((await review(learner.token, exam.id)).json());
    expect(body).toMatchObject({ score: 50, passed: true, completedAt: new Date(answeredAt.getTime() + 1_000).toISOString() });
    expect(body.questions[0]).toMatchObject({
      question: snapshot(0).question, correctChoiceId: choiceIdAt(0, 0), selectedChoiceId: choiceIdAt(0, 0), isCorrect: true,
    });
  });

  it('fails closed on corrupt rows, configuration, cardinality and an inconsistent persisted score', async () => {
    const corruptions: Array<(exam: Awaited<ReturnType<typeof createExam>>) => Promise<unknown>> = [
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { snapshot: { version: 2 } } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { snapshot: { ...snapshot(0), question: { ...snapshot(0).question, id: randomUUID() } } } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { isCorrect: false } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { selectedChoiceId: randomUUID() } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { answeredAt: exam.expiresAt } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { selectedChoiceId: null, isCorrect: null, answeredAt: null } }),
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { passingScore: 44 } }),
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { expiresAt: new Date(exam.expiresAt.getTime() + 1) } }),
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { score: 49 } }),
      (exam) => database.examQuestion.delete({ where: { id: exam.questions[49]!.id } }),
    ];
    for (const corrupt of corruptions) {
      const learner = await createLearner();
      const exam = await createExam(learner.user.id, { outcomes: Array.from({ length: 50 }, () => true) });
      await corrupt(exam);
      await expectError(review(learner.token, exam.id), 500, 'Internal Server Error');
    }

    const learner = await createLearner();
    const short = await createExam(learner.user.id, { questionTotal: 49, outcomes: Array.from({ length: 49 }, () => true) });
    await expectError(review(learner.token, short.id), 500, 'Internal Server Error');
  });
});
