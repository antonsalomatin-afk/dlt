import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, Prisma } from '../packages/database/src/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for real PostgreSQL integration tests.');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_session_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const startedAt = new Date('2026-09-17T12:00:00.000Z');
const expiresAt = new Date('2026-09-17T13:00:00.000Z');
let databaseCreated = false;
let userId: string;
let categoryId: string;
let questionIds: string[];

function questionId(index: number) {
  const id = questionIds[index];
  if (!id) throw new Error(`Missing exam test question ${index}.`);
  return id;
}

function sessionData(
  overrides: Partial<Prisma.ExamSessionUncheckedCreateInput> = {},
): Prisma.ExamSessionUncheckedCreateInput {
  return {
    userId,
    vehicleType: 'CAR',
    passingScore: 45,
    startedAt,
    expiresAt,
    ...overrides,
  };
}

function examQuestionData(
  examSessionId: string,
  questionId: string,
  position: number,
  overrides: Partial<Prisma.ExamQuestionUncheckedCreateInput> = {},
): Prisma.ExamQuestionUncheckedCreateInput {
  return {
    examSessionId,
    questionId,
    position,
    snapshot: { version: 1, questionId, correctChoiceId: randomUUID() },
    ...overrides,
  };
}

async function expectConstraintFailure(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'P2039' });
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    {
      env: { ...process.env, DATABASE_URL: isolatedUrl.toString() },
      stdio: 'pipe',
      timeout: 120_000,
      windowsHide: true,
    },
  );

  const user = await database.user.create({ data: { telegramUserId: 29_001n } });
  userId = user.id;
  const category = await database.category.create({
    data: {
      slug: 'exam-session-test',
      nameThai: 'ทดสอบ',
      nameEnglish: 'Exam session test',
      nameRussian: 'Тест экзамена',
    },
  });
  categoryId = category.id;
  const questions = await Promise.all(Array.from({ length: 4 }, (_, index) => database.question.create({
    data: {
      categoryId,
      vehicleType: 'CAR',
      textEnglish: `Exam question ${index + 1}`,
      sourceType: 'ORIGINAL',
    },
  })));
  questionIds = questions.map(({ id }) => id);
}, 150_000);

afterAll(async () => {
  try {
    await database.$disconnect();
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
});

describe('mock exam persistence foundation', () => {
  it('applies the complete migration chain to an empty PostgreSQL database with named checks', async () => {
    const migrations = await database.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name
    `;
    expect(migrations.map(({ migration_name }) => migration_name)).toEqual([
      '20260907183951_initial_user',
      '20260908055549_question_domain',
      '20260909120000_auth_sessions',
      '20260910130000_question_presentations',
      '20260910140000_answer_attempts',
      '20260916110000_favorites',
      '20260917120000_exam_sessions',
    ]);

    const constraints = await database.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid IN ('"ExamSession"'::regclass, '"ExamQuestion"'::regclass)
      ORDER BY conname
    `;
    expect(constraints.map(({ conname }) => conname)).toEqual(expect.arrayContaining([
      'ExamSession_questionCount_fixed50',
      'ExamSession_passingScore_range',
      'ExamSession_expiry_after_start',
      'ExamSession_completion_tuple',
      'ExamSession_completion_score_range',
      'ExamSession_completion_pass_matches_score',
      'ExamSession_completion_not_before_start',
      'ExamQuestion_position_range',
      'ExamQuestion_answer_tuple',
    ]));
  });

  it('stores valid in-progress and completed session policy snapshots', async () => {
    const inProgress = await database.examSession.create({ data: sessionData() });
    expect(inProgress).toMatchObject({
      userId,
      vehicleType: 'CAR',
      questionCount: 50,
      passingScore: 45,
      startedAt,
      expiresAt,
      completedAt: null,
      score: null,
      passed: null,
    });

    const completedAt = new Date('2026-09-17T14:00:00.000Z');
    const completed = await database.examSession.create({
      data: sessionData({ completedAt, score: 45, passed: true }),
    });
    expect(completed).toMatchObject({ completedAt, score: 45, passed: true });

    const failed = await database.examSession.create({
      data: sessionData({ completedAt: startedAt, score: 0, passed: false }),
    });
    expect(failed).toMatchObject({ completedAt: startedAt, score: 0, passed: false });
  });

  it('rejects non-50 question counts and pass marks outside the configured count', async () => {
    for (const overrides of [
      { questionCount: 49 },
      { questionCount: 51 },
      { passingScore: 0 },
      { passingScore: 51 },
    ]) {
      await expectConstraintFailure(database.examSession.create({ data: sessionData(overrides) }));
    }
  });

  it('rejects invalid expiry and partial or chronologically invalid completion tuples', async () => {
    for (const invalidExpiry of [startedAt, new Date(startedAt.getTime() - 1)]) {
      await expectConstraintFailure(database.examSession.create({
        data: sessionData({ expiresAt: invalidExpiry }),
      }));
    }

    const completedAt = new Date(startedAt.getTime() + 1);
    const partialCompletions: Array<Partial<Prisma.ExamSessionUncheckedCreateInput>> = [
      { completedAt },
      { score: 45 },
      { passed: true },
      { completedAt, score: 45 },
      { completedAt, passed: true },
      { score: 45, passed: true },
    ];
    for (const completion of partialCompletions) {
      await expectConstraintFailure(database.examSession.create({ data: sessionData(completion) }));
    }
    await expectConstraintFailure(database.examSession.create({
      data: sessionData({ completedAt: new Date(startedAt.getTime() - 1), score: 45, passed: true }),
    }));
  });

  it('rejects out-of-range scores and pass results inconsistent with the stored pass mark', async () => {
    const completedAt = new Date(startedAt.getTime() + 1);
    for (const completion of [
      { completedAt, score: -1, passed: false },
      { completedAt, score: 51, passed: true },
      { completedAt, score: 44, passed: true },
      { completedAt, score: 45, passed: false },
    ]) {
      await expectConstraintFailure(database.examSession.create({ data: sessionData(completion) }));
    }
  });

  it('stores both unanswered and atomically answered immutable exam rows', async () => {
    const session = await database.examSession.create({ data: sessionData() });
    const snapshot = { version: 1, wording: 'Immutable exam wording', correctChoiceId: randomUUID() };
    const unanswered = await database.examQuestion.create({
      data: { ...examQuestionData(session.id, questionId(0), 1), snapshot },
    });
    expect(unanswered).toMatchObject({
      examSessionId: session.id,
      position: 1,
      questionId: questionId(0),
      snapshot,
      selectedChoiceId: null,
      isCorrect: null,
      answeredAt: null,
    });

    const selectedChoiceId = randomUUID();
    const answeredAt = new Date(startedAt.getTime() + 1_000);
    const answered = await database.examQuestion.create({
      data: examQuestionData(session.id, questionId(1), 50, {
        selectedChoiceId,
        isCorrect: false,
        answeredAt,
      }),
    });
    expect(answered).toMatchObject({ selectedChoiceId, isCorrect: false, answeredAt });
  });

  it('rejects positions outside 1 through 50 and every partial answer tuple', async () => {
    const session = await database.examSession.create({ data: sessionData() });
    for (const position of [0, 51]) {
      await expectConstraintFailure(database.examQuestion.create({
        data: examQuestionData(session.id, questionId(2), position),
      }));
    }

    const selectedChoiceId = randomUUID();
    const answeredAt = new Date(startedAt.getTime() + 1_000);
    const partialAnswers: Array<Partial<Prisma.ExamQuestionUncheckedCreateInput>> = [
      { selectedChoiceId },
      { isCorrect: true },
      { answeredAt },
      { selectedChoiceId, isCorrect: true },
      { selectedChoiceId, answeredAt },
      { isCorrect: true, answeredAt },
    ];
    for (const answer of partialAnswers) {
      await expectConstraintFailure(database.examQuestion.create({
        data: examQuestionData(session.id, questionId(2), 2, answer),
      }));
    }
  });

  it('enforces per-session position and question uniqueness while allowing cross-session reuse', async () => {
    const firstSession = await database.examSession.create({ data: sessionData() });
    const secondSession = await database.examSession.create({ data: sessionData() });
    await database.examQuestion.create({ data: examQuestionData(firstSession.id, questionId(0), 1) });

    await expect(database.examQuestion.create({
      data: examQuestionData(firstSession.id, questionId(1), 1),
    })).rejects.toMatchObject({ code: 'P2002' });
    await expect(database.examQuestion.create({
      data: examQuestionData(firstSession.id, questionId(0), 2),
    })).rejects.toMatchObject({ code: 'P2002' });

    const reused = await database.examQuestion.create({
      data: examQuestionData(secondSession.id, questionId(0), 1),
    });
    expect(reused).toMatchObject({ examSessionId: secondSession.id, questionId: questionId(0) });
  });

  it('enforces foreign keys, cascades user and session deletion, and restricts question deletion', async () => {
    await expect(database.examSession.create({
      data: sessionData({ userId: randomUUID() }),
    })).rejects.toMatchObject({ code: 'P2003' });

    const referenceSession = await database.examSession.create({ data: sessionData() });
    await expect(database.examQuestion.create({
      data: examQuestionData(randomUUID(), questionId(0), 1),
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.examQuestion.create({
      data: examQuestionData(referenceSession.id, randomUUID(), 1),
    })).rejects.toMatchObject({ code: 'P2003' });

    const restrictedQuestion = await database.question.create({
      data: {
        categoryId,
        vehicleType: 'CAR',
        textEnglish: 'Restricted exam question',
        sourceType: 'ORIGINAL',
      },
    });
    await database.examQuestion.create({
      data: examQuestionData(referenceSession.id, restrictedQuestion.id, 1),
    });
    await expect(database.question.delete({ where: { id: restrictedQuestion.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await database.examSession.delete({ where: { id: referenceSession.id } });
    expect(await database.examQuestion.count({ where: { examSessionId: referenceSession.id } })).toBe(0);
    expect(await database.user.count({ where: { id: userId } })).toBe(1);
    await database.question.delete({ where: { id: restrictedQuestion.id } });

    const cascadeUser = await database.user.create({ data: { telegramUserId: 29_002n } });
    const cascadeSession = await database.examSession.create({
      data: sessionData({ userId: cascadeUser.id }),
    });
    await database.examQuestion.create({
      data: examQuestionData(cascadeSession.id, questionId(3), 1),
    });
    await database.user.delete({ where: { id: cascadeUser.id } });
    expect(await database.examSession.count({ where: { id: cascadeSession.id } })).toBe(0);
    expect(await database.examQuestion.count({ where: { examSessionId: cascadeSession.id } })).toBe(0);
    expect(await database.question.count({ where: { id: questionId(3) } })).toBe(1);
  });
});
