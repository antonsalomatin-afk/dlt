import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';
import { examQuestionReportResponseSchema } from '../packages/database/src/report.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `exam_question_report_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
let clock = new Date('2026-10-02T07:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic', now: () => clock, randomOffset: () => 0 });

const tokens = {
  alice: randomBytes(32).toString('base64url'),
  bob: randomBytes(32).toString('base64url'),
  expired: randomBytes(32).toString('base64url'),
};
const userIds = { alice: randomUUID(), bob: randomUUID(), expired: randomUUID() };
const categoryId = randomUUID();
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const session = (token: string, expiresAt = new Date(clock.getTime() + 3_600_000)) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(clock.getTime() - 1_000),
  expiresAt,
});

const submitReport = (examQuestionId: string, details: string, token = tokens.alice) => app.inject({
  method: 'POST', url: '/exam/report',
  headers: { ...authorization(token), 'content-type': 'application/json' },
  payload: JSON.stringify({ examQuestionId, details }),
});
const submitRaw = (payload: string, authorizationHeader: string | undefined, query = '') => app.inject({
  method: 'POST', url: `/exam/report${query}`,
  headers: authorizationHeader === undefined
    ? { 'content-type': 'application/json' }
    : { authorization: authorizationHeader, 'content-type': 'application/json' },
  payload,
});

async function createQuestion(label: string = randomUUID()) {
  return database.question.create({
    data: {
      categoryId, vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL',
      textEnglish: `Exam report ${label}`, explanationEnglish: `Explanation ${label}`,
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key, textEnglish: `${label} choice ${key}`, isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

async function createExamQuestion(options: {
  userId?: string;
  answered?: boolean;
  expired?: boolean;
  completed?: boolean;
  question?: Awaited<ReturnType<typeof createQuestion>>;
  snapshotQuestion?: Awaited<ReturnType<typeof createQuestion>>;
  snapshot?: object;
} = {}) {
  const userId = options.userId ?? userIds.alice;
  const question = options.question ?? await createQuestion();
  const startedAt = new Date(clock.getTime() - 20 * 60_000);
  const expiresAt = options.expired ? new Date(clock.getTime() - 10 * 60_000) : new Date(clock.getTime() + 40 * 60_000);
  const examSession = await database.examSession.create({ data: {
    userId, vehicleType: 'CAR', passingScore: 45, startedAt, expiresAt,
    ...(options.completed ? { completedAt: new Date(clock.getTime() - 5 * 60_000), score: 0, passed: false } : {}),
  } });
  const selected = question.choices[1];
  if (!selected) throw new Error('Question choice fixture missing');
  const examQuestion = await database.examQuestion.create({ data: {
    examSessionId: examSession.id, position: 1, questionId: question.id,
    snapshot: options.snapshot ?? snapshotQuestion(options.snapshotQuestion ?? question),
    ...(options.answered ? { selectedChoiceId: selected.id, isCorrect: false, answeredAt: new Date(clock.getTime() - 1_000) } : {}),
  } });
  return { question, examSession, examQuestion };
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true },
  );
  for (const user of [
    { id: userIds.alice, token: tokens.alice, telegramUserId: 154_001n },
    { id: userIds.bob, token: tokens.bob, telegramUserId: 154_002n },
    { id: userIds.expired, token: tokens.expired, telegramUserId: 154_003n },
  ]) await database.user.create({ data: {
    id: user.id, telegramUserId: user.telegramUserId,
    sessions: { create: session(user.token, user.id === userIds.expired ? clock : undefined) },
  } });
  await database.category.create({ data: {
    id: categoryId, slug: 'exam-question-report-test', nameThai: 'test', nameEnglish: 'test', nameRussian: 'test',
  } });
}, 150_000);

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('POST /exam/report', () => {
  it('authenticates before parsing and rejects duplicate members and strict invalid input without writes', async () => {
    for (const authorizationHeader of [undefined, 'Bearer invalid', `Bearer ${randomBytes(32).toString('base64url')}`, `Bearer ${tokens.expired}`]) {
      const response = await submitRaw('{', authorizationHeader);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const { examQuestion } = await createExamQuestion();
    const valid = { examQuestionId: examQuestion.id, details: 'A valid learner allegation.' };
    const invalidBodies = [
      '{', 'null', '[]', '{}', JSON.stringify({ ...valid, examQuestionId: 'bad' }),
      JSON.stringify({ ...valid, details: 'ab' }), JSON.stringify({ ...valid, details: ' padded' }),
      JSON.stringify({ ...valid, details: 'tab\tdetail' }), JSON.stringify({ ...valid, details: '😀'.repeat(1000) + 'a' }),
      JSON.stringify({ ...valid, extra: true }),
      `{"examQuestionId":"${examQuestion.id}","details":"first","details":"second"}`,
      `{"examQuestionId":"${examQuestion.id}","examQuestionId":"${randomUUID()}","details":"valid details"}`,
    ];
    for (const payload of invalidBodies) {
      const response = await submitRaw(payload, `Bearer ${tokens.alice}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
    }
    for (const payload of [
      `{"examQuestionId":"${examQuestion.id}","details":"ab\\ud800cd"}`,
      `{"examQuestionId":"${examQuestion.id}","details":"ab\\udc00cd"}`,
    ]) {
      const response = await submitRaw(payload, `Bearer ${tokens.alice}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
    }
    const queryResponse = await submitRaw(JSON.stringify(valid), `Bearer ${tokens.alice}`, '?extra=true');
    expect(queryResponse.statusCode).toBe(400);
    expect(queryResponse.json()).toEqual({ error: 'Bad Request' });
    expect(await database.examQuestionReport.count()).toBe(0);
  });

  it('reports owned unanswered, answered, expired and completed immutable snapshots without changing exam state', async () => {
    for (const state of [{}, { answered: true }, { expired: true }, { completed: true }]) {
      const source = await createExamQuestion(state);
      const before = await database.examSession.findUniqueOrThrow({
        where: { id: source.examSession.id }, include: { questions: true },
      });
      await database.question.update({ where: { id: source.question.id }, data: { active: false, verificationStatus: 'REJECTED' } });
      const details = `Exam state report ${JSON.stringify(state)} 😀`;
      const result = await submitReport(source.examQuestion.id, details);
      expect(result.statusCode).toBe(200);
      const body = reportBoundary(result);
      expect(body).toMatchObject({ examQuestionId: source.examQuestion.id, createdAt: clock.toISOString() });
      expect(await database.examQuestionReport.findUniqueOrThrow({ where: { examQuestionId: source.examQuestion.id } })).toMatchObject({
        id: body.reportId, userId: userIds.alice, questionId: source.question.id,
        examSessionId: source.examSession.id, examQuestionId: source.examQuestion.id, details, createdAt: clock,
      });
      expect(await database.examSession.findUniqueOrThrow({
        where: { id: source.examSession.id }, include: { questions: true },
      })).toEqual(before);
    }
  });

  it('replays exactly, rejects different details and converges concurrent exact submissions', async () => {
    const firstSource = await createExamQuestion();
    const details = 'Exact exam question report.';
    const first = await submitReport(firstSource.examQuestion.id, details);
    expect(first.statusCode).toBe(200);
    const firstBody = reportBoundary(first);
    const stored = await database.examQuestionReport.findUniqueOrThrow({ where: { examQuestionId: firstSource.examQuestion.id } });
    clock = new Date(clock.getTime() + 10_000);
    const replay = await submitReport(firstSource.examQuestion.id, details);
    expect(replay.statusCode).toBe(200);
    expect(reportBoundary(replay)).toEqual(firstBody);
    const conflict = await submitReport(firstSource.examQuestion.id, 'Different details must never replace the first report.');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'Report already submitted' });
    expect(await database.examQuestionReport.findUniqueOrThrow({ where: { id: stored.id } })).toEqual(stored);

    const concurrentSource = await createExamQuestion();
    const responses = await Promise.all(Array.from({ length: 12 }, () => submitReport(concurrentSource.examQuestion.id, 'Concurrent exact exam report.')));
    expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true);
    const bodies = responses.map(reportBoundary);
    expect(new Set(bodies.map(({ reportId }) => reportId)).size).toBe(1);
    expect(new Set(bodies.map(({ createdAt }) => createdAt)).size).toBe(1);
    expect(await database.examQuestionReport.count({ where: { examQuestionId: concurrentSource.examQuestion.id } })).toBe(1);
  });

  it('returns one private not-found response for unknown and foreign exam questions', async () => {
    const foreign = await createExamQuestion({ userId: userIds.bob });
    const before = await database.examQuestionReport.findMany({ orderBy: { id: 'asc' } });
    for (const examQuestionId of [foreign.examQuestion.id, randomUUID()]) {
      const response = await submitReport(examQuestionId, 'Private unknown exam question report.');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Exam question not found' });
      expect(response.body).not.toContain(examQuestionId);
    }
    expect(await database.examQuestionReport.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('fails closed on corrupt and mismatched snapshots without report or unrelated mutation', async () => {
    const first = await createQuestion('corrupt-source');
    const second = await createQuestion('mismatch-source');
    const corrupt = await createExamQuestion({ question: first, snapshot: { version: 999 } });
    const mismatched = await createExamQuestion({ question: first, snapshotQuestion: second });
    const before = await database.question.findUniqueOrThrow({ where: { id: second.id } });
    const countBefore = await database.examQuestionReport.count();
    for (const examQuestionId of [corrupt.examQuestion.id, mismatched.examQuestion.id]) {
      const response = await submitReport(examQuestionId, 'This exam snapshot must fail closed.');
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
    }
    expect(await database.examQuestionReport.count()).toBe(countBefore);
    expect(await database.question.findUniqueOrThrow({ where: { id: second.id } })).toEqual(before);
  });

  it('enforces defaults, composite ownership, uniqueness, deletion semantics and practice-report isolation', async () => {
    const source = await createExamQuestion();
    await expect(database.examQuestionReport.create({ data: {
      userId: userIds.bob, questionId: source.question.id, examSessionId: source.examSession.id,
      examQuestionId: source.examQuestion.id, details: 'Foreign learner composite.',
    } })).rejects.toMatchObject({ code: 'P2003' });
    const otherQuestion = await createQuestion('other-composite-question');
    await expect(database.examQuestionReport.create({ data: {
      userId: userIds.alice, questionId: otherQuestion.id, examSessionId: source.examSession.id,
      examQuestionId: source.examQuestion.id, details: 'Foreign question composite.',
    } })).rejects.toMatchObject({ code: 'P2003' });
    const otherSession = (await createExamQuestion()).examSession;
    await expect(database.examQuestionReport.create({ data: {
      userId: userIds.alice, questionId: source.question.id, examSessionId: otherSession.id,
      examQuestionId: source.examQuestion.id, details: 'Foreign session composite.',
    } })).rejects.toMatchObject({ code: 'P2003' });
    const direct = await database.examQuestionReport.create({ data: {
      userId: userIds.alice, questionId: source.question.id, examSessionId: source.examSession.id,
      examQuestionId: source.examQuestion.id, details: 'Direct integrity report.',
    } });
    expect(direct.createdAt).toBeInstanceOf(Date);
    await expect(database.examQuestionReport.create({ data: {
      userId: userIds.alice, questionId: source.question.id, examSessionId: source.examSession.id,
      examQuestionId: source.examQuestion.id, details: 'Duplicate exam question.',
    } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(database.examQuestion.delete({ where: { id: source.examQuestion.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.question.delete({ where: { id: source.question.id } })).rejects.toMatchObject({ code: 'P2003' });

    const practice = await createQuestion('preserved-practice-report');
    const presentation = await database.questionPresentation.create({ data: {
      userId: userIds.alice, questionId: practice.id, snapshot: snapshotQuestion(practice),
    } });
    const practiceReport = await database.questionReport.create({ data: {
      userId: userIds.alice, questionId: practice.id, presentationId: presentation.id, details: 'Preserved practice report.',
    } });
    await database.examSession.delete({ where: { id: source.examSession.id } });
    expect(await database.examQuestionReport.count({ where: { id: direct.id } })).toBe(0);
    expect(await database.examQuestion.count({ where: { id: source.examQuestion.id } })).toBe(0);
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: practiceReport.id } })).toEqual(practiceReport);

    const cascadeUserId = randomUUID();
    const cascadeToken = randomBytes(32).toString('base64url');
    await database.user.create({ data: {
      id: cascadeUserId, telegramUserId: 154_004n, sessions: { create: session(cascadeToken) },
    } });
    const cascade = await createExamQuestion({ userId: cascadeUserId });
    expect((await submitReport(cascade.examQuestion.id, 'Cascade exam report.', cascadeToken)).statusCode).toBe(200);
    await database.user.delete({ where: { id: cascadeUserId } });
    expect(await database.examQuestionReport.count({ where: { userId: cascadeUserId } })).toBe(0);
    expect(await database.examSession.count({ where: { id: cascade.examSession.id } })).toBe(0);
    expect(await database.examQuestion.count({ where: { id: cascade.examQuestion.id } })).toBe(0);
    expect(await database.question.count({ where: { id: cascade.question.id } })).toBe(1);
  });
});

function reportBoundary(response: {
  json(): unknown;
  headers: Record<string, string | string[] | number | undefined>;
  body: string;
}) {
  const parsed = examQuestionReportResponseSchema.parse(response.json());
  expect(Object.keys(parsed).sort()).toEqual(['createdAt', 'examQuestionId', 'reportId']);
  expect(response.headers['cache-control']).toBe('no-store');
  for (const hidden of [
    'details', 'userId', 'questionId', 'examSessionId', 'snapshot', 'position', 'selectedChoiceId', 'isCorrect',
    'startedAt', 'expiresAt', 'completedAt', 'score', 'passed', 'active', 'verificationStatus', 'reviewer', 'legalCitation',
  ]) expect(response.body).not.toContain(hidden);
  return parsed;
}
