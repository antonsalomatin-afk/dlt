import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient, type Prisma } from '../packages/database/src/index.ts';
import { EXAM_DURATION_MS } from '../packages/database/src/exam.ts';
import { encodeExamHistoryCursor, examHistoryResponseSchema } from '../packages/database/src/exam-history.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for exam history integration tests');

const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `exam_history_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const categoryId = randomUUID();
const questionIds = Array.from({ length: 3 }, () => randomUUID());
const choiceIds = questionIds.map(() => randomUUID());
const clock = new Date('2026-09-19T12:00:00.123Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock });
let databaseCreated = false;
let telegramSequence = 45_000n;

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

function fixture(index: number) {
  const questionId = questionIds[index];
  const choiceId = choiceIds[index];
  if (!questionId || !choiceId) throw new Error('Missing exam history fixture');
  return { questionId, choiceId };
}

function snapshot(index: number) {
  const { questionId, choiceId } = fixture(index);
  return {
    version: 1,
    question: {
      id: questionId, textThai: null, textExamEnglish: null, textEnglish: 'Snapshot', textRussian: null,
      choices: (['A', 'B', 'C', 'D'] as const).map((key, choiceIndex) => ({
        id: choiceIndex === 0 ? choiceId : randomUUID(), key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
      })),
    },
    correctChoiceId: choiceId,
    explanationThai: null, explanationEnglish: null, explanationRussian: null,
    trapExplanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null,
  };
}

async function createExam(
  userId: string,
  startedAt: Date,
  options: { completion?: { completedAt: Date; score: number; passed: boolean }; answered?: number; session?: Partial<Prisma.ExamSessionUncheckedCreateInput> } = {},
) {
  const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
  const answered = options.answered ?? 0;
  return database.examSession.create({
    data: {
      userId,
      vehicleType: 'CAR',
      passingScore: 45,
      startedAt,
      expiresAt,
      ...options.completion,
      ...options.session,
      ...(answered === 0 ? {} : { questions: { create: Array.from({ length: answered }, (_, index) => ({
        position: index + 1,
        questionId: fixture(index).questionId,
        snapshot: snapshot(index),
        selectedChoiceId: fixture(index).choiceId,
        isCorrect: true,
        answeredAt: new Date(startedAt.getTime() + 1_000),
      })) } }),
    },
  });
}

function history(token: string | undefined, query = '') {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return app.inject({ method: 'GET', url: `/exam/history${query}`, headers });
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
  for (const [index, questionId] of questionIds.entries()) {
    await database.question.create({
      data: {
        id: questionId, categoryId, vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL', legalCitation: 'Synthetic development citation, not legal guidance',
        textEnglish: `Source wording ${index + 1}`,
        choices: { create: (['A', 'B', 'C', 'D'] as const).map((key, choiceIndex) => ({
          id: choiceIndex === 0 ? fixture(index).choiceId : randomUUID(), key, textEnglish: `Source ${key}`, isCorrect: choiceIndex === 0,
        })) },
      },
    });
  }
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
  it('authenticates before strict query parsing and rejects malformed queries', async () => {
    const learner = await createLearner();
    const expired = await createLearner('expired');
    const revoked = await createLearner('revoked');
    await expectError(history(undefined, '?limit=0'), 401, 'Unauthorized');
    await expectError(history('invalid', '?limit=0'), 401, 'Unauthorized');
    await expectError(history(expired.token, '?limit=0'), 401, 'Unauthorized');
    await expectError(history(revoked.token, '?limit=0'), 401, 'Unauthorized');
    for (const query of ['?limit=0', '?limit=51', '?limit=01', '?limit=1&limit=2', '?cursor=', '?cursor=%2B', '?unknown=1', '?cursor=bm90LWpzb24']) {
      await expectError(history(learner.token, query), 400, 'Bad Request');
    }
  });

  it('returns an empty strict no-store envelope for a learner without exams', async () => {
    const learner = await createLearner();
    const response = await history(learner.token);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(examHistoryResponseSchema.parse(response.json())).toEqual({ items: [], nextCursor: null });
  });

  it('lists only owned exams newest first with status, counts and results', async () => {
    const learner = await createLearner();
    const stranger = await createLearner();
    const completedStart = new Date(clock.getTime() - 3 * EXAM_DURATION_MS);
    const completed = await createExam(learner.user.id, completedStart, {
      answered: 3,
      completion: { completedAt: new Date(completedStart.getTime() + EXAM_DURATION_MS), score: 3, passed: false },
    });
    const expired = await createExam(learner.user.id, new Date(clock.getTime() - EXAM_DURATION_MS), { answered: 2 });
    const open = await createExam(learner.user.id, new Date(clock.getTime() - EXAM_DURATION_MS + 1), { answered: 1 });
    await createExam(stranger.user.id, clock, { answered: 1 });
    const before = await database.examSession.findMany({ orderBy: { id: 'asc' } });

    const body = examHistoryResponseSchema.parse((await history(learner.token)).json());
    expect(body.nextCursor).toBeNull();
    expect(body.items.map(({ examId }) => examId)).toEqual([open.id, expired.id, completed.id]);
    expect(body.items[0]).toEqual({
      examId: open.id, vehicleType: 'CAR', status: 'IN_PROGRESS', questionCount: 50, passingScore: 45, answeredCount: 1,
      startedAt: open.startedAt.toISOString(), expiresAt: open.expiresAt.toISOString(), completedAt: null, score: null, passed: null,
    });
    expect(body.items[1]).toMatchObject({ status: 'EXPIRED', answeredCount: 2, completedAt: null, score: null, passed: null });
    expect(body.items[2]).toMatchObject({
      status: 'COMPLETED', answeredCount: 3, score: 3, passed: false, completedAt: completed.expiresAt.toISOString(),
    });
    const raw = JSON.stringify(body);
    for (const forbidden of ['Snapshot', 'Source', 'userId', 'snapshot', 'questions', 'choices']) expect(raw).not.toContain(forbidden);
    expect(await database.examSession.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('paginates tied start timestamps across pages without gaps or duplicates', async () => {
    const learner = await createLearner();
    const startedAt = new Date(clock.getTime() - 2 * EXAM_DURATION_MS);
    const created = await Promise.all(Array.from({ length: 5 }, () => createExam(learner.user.id, startedAt)));
    const expected = created.map(({ id }) => id).sort().reverse();
    const first = examHistoryResponseSchema.parse((await history(learner.token, '?limit=2')).json());
    expect(first.items.map(({ examId }) => examId)).toEqual(expected.slice(0, 2));
    expect(first.nextCursor).toBe(encodeExamHistoryCursor({ v: 1, startedAt: startedAt.toISOString(), examId: expected[1] as string }));
    const second = examHistoryResponseSchema.parse((await history(learner.token, `?limit=2&cursor=${first.nextCursor}`)).json());
    expect(second.items.map(({ examId }) => examId)).toEqual(expected.slice(2, 4));
    const third = examHistoryResponseSchema.parse((await history(learner.token, `?limit=2&cursor=${second.nextCursor}`)).json());
    expect(third.items.map(({ examId }) => examId)).toEqual(expected.slice(4));
    expect(third.nextCursor).toBeNull();
    const strangerCursor = encodeExamHistoryCursor({ v: 1, startedAt: clock.toISOString(), examId: randomUUID() });
    const all = examHistoryResponseSchema.parse((await history(learner.token, `?cursor=${strangerCursor}`)).json());
    expect(all.items).toHaveLength(5);
  });

  it('fails the whole request for an inconsistent stored policy', async () => {
    const learner = await createLearner();
    const startedAt = new Date(clock.getTime() - EXAM_DURATION_MS);
    await createExam(learner.user.id, startedAt);
    const corrupt = await createExam(learner.user.id, new Date(startedAt.getTime() - 1), { session: { passingScore: 44 } });
    await expectError(history(learner.token), 500, 'Internal Server Error');
    await database.examSession.update({ where: { id: corrupt.id }, data: { passingScore: 45, expiresAt: new Date(corrupt.expiresAt.getTime() + 1) } });
    await expectError(history(learner.token), 500, 'Internal Server Error');
  });
});
