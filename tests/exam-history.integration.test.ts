import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import {
  examHistoryResponseSchema,
  parseExamHistoryCursor,
} from '../packages/database/src/exam-history.ts';
import { EXAM_DURATION_MS } from '../packages/database/src/exam.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for exam history integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_history_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const questionIds = Array.from({ length: 50 }, () => randomUUID());
const choiceIds = questionIds.map(() => Array.from({ length: 4 }, () => randomUUID()));
const clock = new Date('2026-09-19T12:00:00.123Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock });
const examIds = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
] as const;
const expectedOrder = [examIds[3], examIds[2], examIds[1], examIds[0]];
let databaseCreated = false;
let telegramSequence = 61_000n;
let owner: Awaited<ReturnType<typeof createLearner>>;
let stranger: Awaited<ReturnType<typeof createLearner>>;
let empty: Awaited<ReturnType<typeof createLearner>>;

function questionIdAt(index: number) {
  const id = questionIds[index];
  if (!id) throw new Error('Missing exam history question fixture');
  return id;
}

function choiceIdAt(questionIndex: number, choiceIndex: number) {
  const id = choiceIds[questionIndex]?.[choiceIndex];
  if (!id) throw new Error('Missing exam history choice fixture');
  return id;
}

function snapshot(index: number) {
  return {
    version: 1,
    question: {
      id: questionIdAt(index),
      textThai: null,
      textExamEnglish: `Exam snapshot ${index + 1}`,
      textEnglish: `Immutable history question ${index + 1}`,
      textRussian: null,
      choices: (['A', 'B', 'C', 'D'] as const).map((key, choiceIndex) => ({
        id: choiceIdAt(index, choiceIndex),
        key,
        textThai: null,
        textEnglish: `Immutable ${index + 1} choice ${key}`,
        textRussian: null,
      })),
    },
    correctChoiceId: choiceIdAt(index, 0),
    explanationThai: null,
    explanationEnglish: `Private immutable explanation ${index + 1}`,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: `Private immutable trap ${index + 1}`,
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
  id?: string;
  userId: string;
  startedAt: Date;
  vehicleType?: 'CAR' | 'MOTORCYCLE';
  outcomes?: readonly (boolean | null)[];
  completed?: boolean;
  questionTotal?: number;
}) {
  const questionTotal = options.questionTotal ?? 50;
  const outcomes = options.outcomes ?? Array.from({ length: questionTotal }, () => true);
  const expiresAt = new Date(options.startedAt.getTime() + EXAM_DURATION_MS);
  const score = outcomes.filter((outcome) => outcome === true).length;
  const hasUnanswered = outcomes.some((outcome) => outcome === null);
  const completedAt = hasUnanswered ? expiresAt : new Date(options.startedAt.getTime() + EXAM_DURATION_MS / 2);
  return database.examSession.create({
    data: {
      ...(options.id === undefined ? {} : { id: options.id }),
      userId: options.userId,
      vehicleType: options.vehicleType ?? 'CAR',
      passingScore: 45,
      startedAt: options.startedAt,
      expiresAt,
      ...(options.completed === false ? {} : { completedAt, score, passed: score >= 45 }),
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

function history(token: string | undefined, query = '') {
  return app.inject({
    method: 'GET',
    url: `/exam/history${query}`,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

async function expectError(responsePromise: ReturnType<typeof history>, statusCode: number, error: string) {
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
    data: { id: categoryId, slug: 'exam-history', nameThai: 'exam', nameEnglish: 'exam', nameRussian: 'exam' },
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

  owner = await createLearner();
  stranger = await createLearner();
  empty = await createLearner();
  const starts = [
    new Date('2026-09-19T08:00:00.000Z'),
    new Date('2026-09-19T09:00:00.000Z'),
    new Date('2026-09-19T09:00:00.000Z'),
    new Date('2026-09-19T10:00:00.000Z'),
  ];
  const failOutcomes = [
    ...Array.from({ length: 44 }, () => true),
    ...Array.from({ length: 4 }, () => false),
    null,
    null,
  ];
  for (const [index, id] of examIds.entries()) {
    const startedAt = starts[index];
    if (!startedAt) throw new Error('Missing exam history start time');
    await createExam({
      id,
      userId: owner.user.id,
      startedAt,
      vehicleType: index === 1 ? 'MOTORCYCLE' : 'CAR',
      outcomes: index === 1 ? failOutcomes : Array.from({ length: 50 }, (_, questionIndex) => questionIndex < 45),
    });
  }
  await createExam({ userId: owner.user.id, startedAt: new Date('2026-09-19T11:00:00.000Z'), completed: false });
  await createExam({ userId: stranger.user.id, startedAt: new Date('2026-09-19T11:30:00.000Z') });
  await database.question.update({ where: { id: questionIdAt(0) }, data: { textEnglish: 'Edited mutable source' } });
  await database.questionChoice.update({ where: { id: choiceIdAt(0, 0) }, data: { isCorrect: false, textEnglish: 'Edited mutable correct choice' } });
  await database.questionChoice.update({ where: { id: choiceIdAt(0, 1) }, data: { isCorrect: true } });
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

describe('GET /exam/history', () => {
  it('authenticates before query parsing and rejects malformed queries and cursors', async () => {
    const expired = await createLearner('expired');
    const revoked = await createLearner('revoked');
    for (const token of [undefined, 'invalid', randomBytes(32).toString('base64url'), expired.token, revoked.token]) {
      await expectError(history(token, '?limit=01&unknown=true'), 401, 'Unauthorized');
    }
    const malformed = [
      '?limit=', '?limit=0', '?limit=01', '?limit=%2B1', '?limit=-1', '?limit=1.0', '?limit=%201', '?limit=51',
      '?limit=1&limit=2', '?cursor=', '?cursor=abc%3D', `?cursor=${'a'.repeat(513)}`,
      `?cursor=${Buffer.from('{', 'utf8').toString('base64url')}`, '?unknown=true',
    ];
    for (const query of malformed) await expectError(history(owner.token, query), 400, 'Bad Request');
  });

  it('returns an empty envelope and isolates completed exams by owner', async () => {
    const emptyResponse = await history(empty.token);
    expect(emptyResponse.statusCode).toBe(200);
    expect(emptyResponse.json()).toEqual({ items: [], nextCursor: null });
    expect(emptyResponse.headers['cache-control']).toBe('no-store');

    const response = await history(owner.token);
    const body = examHistoryResponseSchema.parse(response.json());
    expect(body.items.map(({ examId: id }) => id)).toEqual(expectedOrder);
    expect(body.items).toHaveLength(4);
    expect(response.body).not.toContain(stranger.user.id);
  });

  it('returns deterministic vehicle and pass/fail summaries from immutable snapshots', async () => {
    const response = await history(owner.token);
    expect(response.statusCode).toBe(200);
    const body = examHistoryResponseSchema.parse(response.json());
    expect(body.items.find(({ examId: id }) => id === examIds[1])).toMatchObject({
      vehicleType: 'MOTORCYCLE',
      answeredCount: 48,
      unansweredCount: 2,
      score: 44,
      passed: false,
      startedAt: '2026-09-19T09:00:00.000Z',
      completedAt: '2026-09-19T10:00:00.000Z',
    });
    expect(body.items.find(({ examId: id }) => id === examIds[3])).toMatchObject({
      vehicleType: 'CAR', answeredCount: 50, unansweredCount: 0, score: 45, passed: true,
    });
    expect(Object.keys(body.items[0]!).sort()).toEqual([
      'answeredCount', 'completedAt', 'examId', 'passed', 'passingScore', 'questionCount', 'score',
      'startedAt', 'unansweredCount', 'vehicleType',
    ]);
    for (const privateValue of [
      owner.user.id, stranger.user.id, 'userId', 'sessionId', 'selectedChoiceId', 'correctChoiceId', 'isCorrect',
      'choices', 'explanation', 'Hidden source', 'hidden-image', 'Edited mutable source',
    ]) expect(response.body).not.toContain(privateValue);
  });

  it('traverses stable two-page keysets without duplicates at tied timestamps', async () => {
    const firstResponse = await history(owner.token, '?limit=2');
    expect(firstResponse.statusCode).toBe(200);
    const first = examHistoryResponseSchema.parse(firstResponse.json());
    expect(first.items.map(({ examId: id }) => id)).toEqual(expectedOrder.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error('Missing exam history cursor');
    expect(parseExamHistoryCursor(first.nextCursor)).toEqual({
      v: 1, startedAt: '2026-09-19T09:00:00.000Z', examId: examIds[2],
    });
    const secondResponse = await history(owner.token, `?limit=2&cursor=${first.nextCursor}`);
    const second = examHistoryResponseSchema.parse(secondResponse.json());
    expect(second.items.map(({ examId: id }) => id)).toEqual(expectedOrder.slice(2));
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map(({ examId: id }) => id);
    expect(ids).toEqual(expectedOrder);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fails the whole page on malformed policy, snapshot, answer, timing, result or cardinality', async () => {
    const target = await database.examSession.findUniqueOrThrow({
      where: { id: examIds[3] }, include: { questions: { orderBy: { position: 'asc' } } },
    });
    const firstQuestion = target.questions[0];
    if (!firstQuestion) throw new Error('Missing exam history target question');
    const assertInternal = () => expectError(history(owner.token, '?limit=50'), 500, 'Internal Server Error');

    await database.examSession.update({ where: { id: target.id }, data: { passingScore: 44 } });
    await assertInternal();
    await database.examSession.update({ where: { id: target.id }, data: { passingScore: 45 } });

    await database.examSession.update({ where: { id: target.id }, data: { expiresAt: new Date(target.expiresAt.getTime() + 1) } });
    await assertInternal();
    await database.examSession.update({ where: { id: target.id }, data: { expiresAt: target.expiresAt } });

    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { snapshot: { version: 2 } } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { snapshot: snapshot(0) } });

    await database.examQuestion.update({
      where: { id: firstQuestion.id },
      data: { snapshot: { ...snapshot(0), question: { ...snapshot(0).question, id: randomUUID() } } },
    });
    await assertInternal();
    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { snapshot: snapshot(0) } });

    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { selectedChoiceId: randomUUID(), isCorrect: false } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { selectedChoiceId: choiceIdAt(0, 0), isCorrect: true } });

    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { isCorrect: false } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { isCorrect: true } });

    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { answeredAt: target.expiresAt } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { answeredAt: new Date(target.startedAt.getTime() + 5 * 60_000) } });

    if (target.completedAt === null) throw new Error('Missing target completion time');
    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { answeredAt: new Date(target.completedAt.getTime() + 1) } });
    await assertInternal();
    await database.examQuestion.update({ where: { id: firstQuestion.id }, data: { answeredAt: new Date(target.startedAt.getTime() + 5 * 60_000) } });

    await database.examSession.update({ where: { id: target.id }, data: { score: 46 } });
    await assertInternal();
    await database.examSession.update({ where: { id: target.id }, data: { score: 45 } });

    const unanswered = await database.examSession.findUniqueOrThrow({ where: { id: examIds[1] } });
    await database.examSession.update({
      where: { id: unanswered.id },
      data: { completedAt: new Date(unanswered.expiresAt.getTime() - 1) },
    });
    await assertInternal();
    await database.examSession.update({ where: { id: unanswered.id }, data: { completedAt: unanswered.expiresAt } });

    const short = await createExam({
      userId: owner.user.id,
      startedAt: new Date('2026-09-19T10:30:00.000Z'),
      questionTotal: 49,
    });
    await assertInternal();
    await database.examSession.delete({ where: { id: short.id } });
    expect((await history(owner.token)).statusCode).toBe(200);
  });

  it('fails closed on a partial completion tuple and remains read-only', async () => {
    const target = await database.examSession.findUniqueOrThrow({
      where: { id: examIds[3] }, include: { questions: { orderBy: { position: 'asc' } } },
    });
    await database.$executeRawUnsafe('ALTER TABLE "ExamSession" DROP CONSTRAINT "ExamSession_completion_tuple"');
    try {
      await database.$executeRawUnsafe(`UPDATE "ExamSession" SET score = NULL WHERE id = '${target.id}'::uuid`);
      await expectError(history(owner.token), 500, 'Internal Server Error');
    } finally {
      await database.$executeRawUnsafe(`UPDATE "ExamSession" SET score = 45 WHERE id = '${target.id}'::uuid`);
      await database.$executeRawUnsafe(`ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_completion_tuple" CHECK (
        ("completedAt" IS NULL AND score IS NULL AND passed IS NULL)
        OR ("completedAt" IS NOT NULL AND score IS NOT NULL AND passed IS NOT NULL)
      )`);
    }

    const beforeExam = await database.examSession.findUniqueOrThrow({
      where: { id: target.id }, include: { questions: { orderBy: { position: 'asc' } } },
    });
    const beforeSideEffects = {
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    };
    const response = await history(owner.token);
    expect(response.statusCode).toBe(200);
    expect(await database.examSession.findUniqueOrThrow({
      where: { id: target.id }, include: { questions: { orderBy: { position: 'asc' } } },
    })).toEqual(beforeExam);
    expect({
      presentations: await database.questionPresentation.count(),
      attempts: await database.answerAttempt.count(),
      favorites: await database.favorite.count(),
    }).toEqual(beforeSideEffects);
  });
});
