import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient, type Prisma } from '../packages/database/src/index.ts';
import { EXAM_DURATION_MS, examReviewResponseSchema } from '../packages/database/src/exam.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for exam review integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_review_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const questionIds = Array.from({ length: 50 }, () => randomUUID());
const choiceIds = questionIds.map(() => Array.from({ length: 4 }, () => randomUUID()));
const clock = new Date('2026-09-18T19:00:00.123Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock });
let databaseCreated = false;
let telegramSequence = 51_000n;

function questionIdAt(index: number) {
  const id = questionIds[index];
  if (!id) throw new Error('Missing exam review question fixture');
  return id;
}

function choiceIdAt(questionIndex: number, choiceIndex: number) {
  const id = choiceIds[questionIndex]?.[choiceIndex];
  if (!id) throw new Error('Missing exam review choice fixture');
  return id;
}

function snapshot(index: number) {
  return {
    version: 1,
    question: {
      id: questionIdAt(index),
      textThai: `ภาพรวม ${index + 1}`,
      textExamEnglish: `Exam snapshot ${index + 1}`,
      textEnglish: `Immutable snapshot ${index + 1}`,
      textRussian: `Снимок ${index + 1}`,
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
    explanationEnglish: `Immutable explanation ${index + 1}`,
    explanationRussian: `Объяснение ${index + 1}`,
    trapExplanationThai: null,
    trapExplanationEnglish: `Immutable trap ${index + 1}`,
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
    completed?: boolean;
    session?: Partial<Prisma.ExamSessionUncheckedCreateInput>;
  } = {},
) {
  const questionTotal = options.questionTotal ?? 50;
  const outcomes = options.outcomes ?? Array.from({ length: questionTotal }, () => true);
  const containsUnanswered = outcomes.some((outcome) => outcome === null);
  const startedAt = new Date(clock.getTime() - (containsUnanswered ? EXAM_DURATION_MS : EXAM_DURATION_MS / 2));
  const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
  const score = outcomes.filter((outcome) => outcome === true).length;
  const completed = options.completed ?? true;
  return database.examSession.create({
    data: {
      userId,
      vehicleType: 'CAR',
      passingScore: 45,
      startedAt,
      expiresAt,
      ...(completed ? { completedAt: clock, score, passed: score >= 45 } : {}),
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
            answeredAt: new Date(clock.getTime() - 1_000),
          }),
        };
      }) },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

function review(token: string | undefined, examId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/exam/${examId}/review${query}`,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

async function expectError(responsePromise: ReturnType<typeof review>, statusCode: number, error: string) {
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
    data: { id: categoryId, slug: 'exam-review', nameThai: 'exam', nameEnglish: 'exam', nameRussian: 'exam' },
  });
  await database.question.createMany({
    data: questionIds.map((id, index) => ({
      id,
      categoryId,
      vehicleType: 'CAR' as const,
      active: true,
      verificationStatus: 'VERIFIED' as const,
      sourceType: 'ORIGINAL' as const,
      sourceReference: `Private source ${index + 1}`,
      imageReference: `private-image-${index + 1}`,
      textEnglish: `Mutable source ${index + 1}`,
      explanationEnglish: `Mutable explanation ${index + 1}`,
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

describe('GET /exam/:examId/review', () => {
  it('authenticates before strict query and canonical path validation', async () => {
    const learner = await createLearner();
    const expired = await createLearner('expired');
    const revoked = await createLearner('revoked');
    const invalidPath = randomUUID().toUpperCase();
    await expectError(review(undefined, invalidPath, '?unknown=1'), 401, 'Unauthorized');
    await expectError(review('invalid', invalidPath, '?unknown=1'), 401, 'Unauthorized');
    await expectError(review(randomBytes(32).toString('base64url'), invalidPath, '?unknown=1'), 401, 'Unauthorized');
    await expectError(review(expired.token, invalidPath, '?unknown=1'), 401, 'Unauthorized');
    await expectError(review(revoked.token, invalidPath, '?unknown=1'), 401, 'Unauthorized');
    await expectError(review(learner.token, invalidPath), 400, 'Bad Request');
    await expectError(review(learner.token, 'not-a-uuid'), 400, 'Bad Request');
    await expectError(review(learner.token, randomUUID(), '?unknown=1'), 400, 'Bad Request');
  });

  it('does not disclose absent, other-user or incomplete exams', async () => {
    const owner = await createLearner();
    const stranger = await createLearner();
    const incomplete = await createExam(owner.user.id, { completed: false });
    await expectError(review(stranger.token, incomplete.id), 404, 'Exam not found');
    await expectError(review(owner.token, randomUUID()), 404, 'Exam not found');
    await expectError(review(owner.token, incomplete.id), 409, 'Exam not completed');
  });

  it('fails closed on a partial completion tuple', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id, { completed: false });
    await database.$executeRawUnsafe('ALTER TABLE "ExamSession" DROP CONSTRAINT "ExamSession_completion_tuple"');
    try {
      await database.$executeRawUnsafe(`UPDATE "ExamSession" SET "completedAt" = '${clock.toISOString()}' WHERE id = '${exam.id}'::uuid`);
      await expectError(review(learner.token, exam.id), 500, 'Internal Server Error');
    } finally {
      await database.$executeRawUnsafe(`UPDATE "ExamSession" SET "completedAt" = NULL WHERE id = '${exam.id}'::uuid`);
      await database.$executeRawUnsafe(`ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_completion_tuple" CHECK (
        ("completedAt" IS NULL AND "score" IS NULL AND "passed" IS NULL)
        OR ("completedAt" IS NOT NULL AND "score" IS NOT NULL AND "passed" IS NOT NULL)
      )`);
    }
  });

  it('returns an exact empty mistake list for a perfect exam without writes', async () => {
    const learner = await createLearner();
    const exam = await createExam(learner.user.id);
    const beforeExam = await database.examSession.findUniqueOrThrow({ where: { id: exam.id }, include: { questions: { orderBy: { position: 'asc' } } } });
    const beforeSideEffects = {
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    };
    const response = await review(learner.token, exam.id);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = examReviewResponseSchema.parse(response.json());
    expect(body).toEqual({
      examId: exam.id,
      questionCount: 50,
      score: 50,
      passingScore: 45,
      passed: true,
      completedAt: clock.toISOString(),
      mistakes: [],
    });
    expect(Object.keys(body).sort()).toEqual(['completedAt', 'examId', 'mistakes', 'passed', 'passingScore', 'questionCount', 'score']);
    expect(await database.examSession.findUniqueOrThrow({ where: { id: exam.id }, include: { questions: { orderBy: { position: 'asc' } } } })).toEqual(beforeExam);
    expect({
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    }).toEqual(beforeSideEffects);
  });

  it('returns ordered incorrect and unanswered immutable snapshots after source edits', async () => {
    const learner = await createLearner();
    const outcomes = Array.from({ length: 50 }, () => true as boolean | null);
    outcomes[1] = false;
    outcomes[37] = null;
    const exam = await createExam(learner.user.id, { outcomes });
    await database.question.update({
      where: { id: questionIdAt(1) },
      data: { textEnglish: 'Edited source wording', explanationEnglish: 'Edited source explanation' },
    });
    await database.questionChoice.update({ where: { id: choiceIdAt(1, 0) }, data: { textEnglish: 'Edited correct choice', isCorrect: false } });
    await database.questionChoice.update({ where: { id: choiceIdAt(1, 1) }, data: { isCorrect: true } });

    const response = await review(learner.token, exam.id);
    expect(response.statusCode).toBe(200);
    const body = examReviewResponseSchema.parse(response.json());
    expect(body).toMatchObject({ score: 48, passed: true, completedAt: clock.toISOString() });
    expect(body.mistakes.map(({ position }) => position)).toEqual([2, 38]);
    expect(body.mistakes[0]).toMatchObject({
      examQuestionId: exam.questions[1]!.id,
      selectedChoiceId: choiceIdAt(1, 1),
      answeredAt: new Date(clock.getTime() - 1_000).toISOString(),
      correctChoiceId: choiceIdAt(1, 0),
      question: { textEnglish: 'Immutable snapshot 2' },
      explanationEnglish: 'Immutable explanation 2',
      trapExplanationEnglish: 'Immutable trap 2',
    });
    expect(body.mistakes[1]).toMatchObject({
      examQuestionId: exam.questions[37]!.id,
      selectedChoiceId: null,
      answeredAt: null,
      correctChoiceId: choiceIdAt(37, 0),
      question: { textEnglish: 'Immutable snapshot 38' },
    });
    expect(Object.keys(body.mistakes[0]!).sort()).toEqual([
      'answeredAt', 'correctChoiceId', 'examQuestionId', 'explanationEnglish', 'explanationRussian',
      'explanationThai', 'position', 'question', 'selectedChoiceId', 'trapExplanationEnglish',
      'trapExplanationRussian', 'trapExplanationThai',
    ]);
    for (const privateValue of [
      learner.user.id, 'Private source', 'private-image', 'Edited source wording', 'Edited source explanation',
      'Edited correct choice', 'isCorrect', 'userId', 'questionId', 'vehicleType', 'sourceReference', 'imageReference',
    ]) expect(response.body).not.toContain(privateValue);
  });

  it('fails closed on result, snapshot, answer, timing, policy and cardinality corruption without writes', async () => {
    const corruptions: Array<(exam: Awaited<ReturnType<typeof createExam>>) => Promise<unknown>> = [
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { score: 49 } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { snapshot: { version: 2 } } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { snapshot: { ...snapshot(0), question: { ...snapshot(0).question, id: randomUUID() } } } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { selectedChoiceId: randomUUID(), isCorrect: false } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { isCorrect: false } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { answeredAt: exam.expiresAt } }),
      (exam) => database.examQuestion.update({ where: { id: exam.questions[0]!.id }, data: { answeredAt: new Date(clock.getTime() + 1) } }),
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { passingScore: 44 } }),
      (exam) => database.examSession.update({ where: { id: exam.id }, data: { expiresAt: new Date(exam.expiresAt.getTime() + 1) } }),
    ];
    for (const corrupt of corruptions) {
      const learner = await createLearner();
      const exam = await createExam(learner.user.id);
      await corrupt(exam);
      const before = await database.examSession.findUniqueOrThrow({ where: { id: exam.id }, include: { questions: { orderBy: { position: 'asc' } } } });
      await expectError(review(learner.token, exam.id), 500, 'Internal Server Error');
      expect(await database.examSession.findUniqueOrThrow({ where: { id: exam.id }, include: { questions: { orderBy: { position: 'asc' } } } })).toEqual(before);
    }

    const learner = await createLearner();
    const short = await createExam(learner.user.id, { questionTotal: 49 });
    const before = await database.examSession.findUniqueOrThrow({ where: { id: short.id }, include: { questions: true } });
    await expectError(review(learner.token, short.id), 500, 'Internal Server Error');
    expect(await database.examSession.findUniqueOrThrow({ where: { id: short.id }, include: { questions: true } })).toEqual(before);
  });
});
