import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';
import { questionReportResponseSchema } from '../packages/database/src/report.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `question_report_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
let clock = new Date('2026-10-01T15:00:00.000Z');
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

const submitReport = (presentationId: string, details: string, token = tokens.alice) => app.inject({
  method: 'POST',
  url: '/practice/report',
  headers: { ...authorization(token), 'content-type': 'application/json' },
  payload: JSON.stringify({ presentationId, details }),
});

const submitRaw = (payload: string, authorizationHeader: string | undefined) => app.inject({
  method: 'POST',
  url: '/practice/report',
  headers: authorizationHeader === undefined
    ? { 'content-type': 'application/json' }
    : { authorization: authorizationHeader, 'content-type': 'application/json' },
  payload,
});

async function createQuestion(textEnglish: string) {
  return database.question.create({
    data: {
      categoryId,
      vehicleType: 'CAR',
      active: true,
      verificationStatus: 'VERIFIED',
      sourceType: 'ORIGINAL',
      textEnglish,
      explanationEnglish: `${textEnglish} explanation`,
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key,
        textEnglish: `${textEnglish} choice ${key}`,
        isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

async function createPresentation(userId = userIds.alice, label = randomUUID()) {
  const question = await createQuestion(`Report question ${label}`);
  const presentation = await database.questionPresentation.create({ data: {
    userId,
    questionId: question.id,
    snapshot: snapshotQuestion(question),
  } });
  return { question, presentation };
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
    { id: userIds.alice, token: tokens.alice, telegramUserId: 152_001n },
    { id: userIds.bob, token: tokens.bob, telegramUserId: 152_002n },
    { id: userIds.expired, token: tokens.expired, telegramUserId: 152_003n },
  ]) {
    await database.user.create({ data: {
      id: user.id,
      telegramUserId: user.telegramUserId,
      sessions: { create: session(user.token, user.id === userIds.expired ? clock : undefined) },
    } });
  }
  await database.category.create({ data: {
    id: categoryId,
    slug: 'question-report-test',
    nameThai: 'test',
    nameEnglish: 'test',
    nameRussian: 'test',
  } });
}, 150_000);

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('POST /practice/report', () => {
  it('authenticates before parsing and strictly rejects malformed or out-of-bounds details without writes', async () => {
    for (const authorizationHeader of [
      undefined,
      'Bearer invalid',
      `Bearer ${randomBytes(32).toString('base64url')}`,
      `Bearer ${tokens.expired}`,
    ]) {
      const response = await submitRaw('{', authorizationHeader);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }

    const { presentation } = await createPresentation();
    const valid = { presentationId: presentation.id, details: 'A valid learner allegation.' };
    const invalidBodies = [
      '{', 'null', '[]', '{}',
      JSON.stringify({ ...valid, presentationId: 'not-a-uuid' }),
      JSON.stringify({ ...valid, details: 'ab' }),
      JSON.stringify({ ...valid, details: ' padded' }),
      JSON.stringify({ ...valid, details: 'tab\tdetail' }),
      JSON.stringify({ ...valid, details: '😀'.repeat(1000) + 'a' }),
      JSON.stringify({ ...valid, extra: true }),
      `{"presentationId":"${presentation.id}","details":"first","details":"second"}`,
      `{"presentationId":"${presentation.id}","presentationId":"${randomUUID()}","details":"valid details"}`,
    ];
    for (const payload of invalidBodies) {
      const response = await submitRaw(payload, `Bearer ${tokens.alice}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const payload of [
      `{"presentationId":"${presentation.id}","details":"ab\\ud800cd"}`,
      `{"presentationId":"${presentation.id}","details":"ab\\udc00cd"}`,
    ]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await submitRaw(payload, `Bearer ${tokens.alice}`);
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Bad Request' });
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
    expect(await database.questionReport.count()).toBe(0);
  });

  it('creates against an owned immutable snapshot and replays exactly without timestamp churn or content exposure', async () => {
    const { question, presentation } = await createPresentation();
    await database.question.update({
      where: { id: question.id },
      data: { active: false, verificationStatus: 'REJECTED' },
    });
    const details = 'The displayed wording may be ambiguous 😀.\nPlease review it.';
    const first = await submitReport(presentation.id, details);
    expect(first.statusCode).toBe(200);
    const firstBody = reportBoundary(first);
    expect(firstBody).toMatchObject({ presentationId: presentation.id, createdAt: clock.toISOString() });
    const stored = await database.questionReport.findUniqueOrThrow({ where: { presentationId: presentation.id } });
    expect(stored).toMatchObject({
      id: firstBody.reportId,
      userId: userIds.alice,
      questionId: question.id,
      presentationId: presentation.id,
      details,
      createdAt: clock,
    });

    clock = new Date(clock.getTime() + 10_000);
    const replay = await submitReport(presentation.id, details);
    expect(replay.statusCode).toBe(200);
    expect(reportBoundary(replay)).toEqual(firstBody);
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: stored.id } })).toEqual(stored);

    const conflict = await submitReport(presentation.id, 'A different allegation must not replace the first.');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'Report already submitted' });
    expect(conflict.headers['cache-control']).toBe('no-store');
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: stored.id } })).toEqual(stored);
  });

  it('converges concurrent exact retries to one stable report row', async () => {
    const { presentation } = await createPresentation();
    const details = 'Concurrent exact learner report.';
    const responses = await Promise.all(Array.from({ length: 12 }, () => submitReport(presentation.id, details)));
    expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true);
    const bodies = responses.map(reportBoundary);
    expect(new Set(bodies.map(({ reportId }) => reportId)).size).toBe(1);
    expect(new Set(bodies.map(({ createdAt }) => createdAt)).size).toBe(1);
    expect(await database.questionReport.count({ where: { presentationId: presentation.id } })).toBe(1);
  });

  it('returns the same private not-found response for unknown and foreign presentations', async () => {
    const { presentation: foreign } = await createPresentation(userIds.bob);
    const before = await database.questionReport.findMany({ orderBy: { id: 'asc' } });
    for (const presentationId of [foreign.id, randomUUID()]) {
      const response = await submitReport(presentationId, 'Private unknown presentation report.');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Presentation not found' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain(presentationId);
    }
    expect(await database.questionReport.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('fails closed on corrupt and mismatched snapshots without reports or unrelated mutation', async () => {
    const first = await createQuestion('Corrupt report source');
    const second = await createQuestion('Mismatched report source');
    const [corrupt, mismatched] = await Promise.all([
      database.questionPresentation.create({ data: {
        userId: userIds.alice,
        questionId: first.id,
        snapshot: { version: 999 },
      } }),
      database.questionPresentation.create({ data: {
        userId: userIds.alice,
        questionId: first.id,
        snapshot: snapshotQuestion(second),
      } }),
    ]);
    const unrelatedBefore = await database.question.findUniqueOrThrow({ where: { id: second.id } });
    const countBefore = await database.questionReport.count();
    for (const presentationId of [corrupt.id, mismatched.id]) {
      const response = await submitReport(presentationId, 'This snapshot must fail closed.');
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await database.questionReport.count()).toBe(countBefore);
    expect(await database.question.findUniqueOrThrow({ where: { id: second.id } })).toEqual(unrelatedBefore);
  });

  it('enforces defaults, uniqueness, composite ownership and deletion behavior', async () => {
    const { question, presentation } = await createPresentation();
    await expect(database.questionReport.create({ data: {
      userId: userIds.bob,
      questionId: question.id,
      presentationId: presentation.id,
      details: 'Foreign composite user.',
    } })).rejects.toMatchObject({ code: 'P2003' });
    const other = await createQuestion('Other composite question');
    await expect(database.questionReport.create({ data: {
      userId: userIds.alice,
      questionId: other.id,
      presentationId: presentation.id,
      details: 'Foreign composite question.',
    } })).rejects.toMatchObject({ code: 'P2003' });
    const direct = await database.questionReport.create({ data: {
      userId: userIds.alice,
      questionId: question.id,
      presentationId: presentation.id,
      details: 'Direct persistence integrity report.',
    } });
    expect(() => questionReportResponseSchema.parse({
      reportId: direct.id,
      presentationId: direct.presentationId,
      createdAt: direct.createdAt.toISOString(),
    })).not.toThrow();
    await expect(database.questionReport.create({ data: {
      userId: userIds.alice,
      questionId: question.id,
      presentationId: presentation.id,
      details: 'Duplicate presentation.',
    } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(database.questionPresentation.delete({ where: { id: presentation.id } }))
      .rejects.toMatchObject({ code: 'P2003' });
    await expect(database.question.delete({ where: { id: question.id } }))
      .rejects.toMatchObject({ code: 'P2003' });

    const cascadeUserId = randomUUID();
    const cascadeToken = randomBytes(32).toString('base64url');
    await database.user.create({ data: {
      id: cascadeUserId,
      telegramUserId: 152_004n,
      sessions: { create: session(cascadeToken) },
    } });
    const cascade = await createPresentation(cascadeUserId);
    const submitted = await submitReport(cascade.presentation.id, 'Cascade behavior report.', cascadeToken);
    expect(submitted.statusCode).toBe(200);
    expect(await database.questionReport.count({ where: { userId: cascadeUserId } })).toBe(1);
    await database.user.delete({ where: { id: cascadeUserId } });
    expect(await database.questionReport.count({ where: { userId: cascadeUserId } })).toBe(0);
    expect(await database.questionPresentation.count({ where: { id: cascade.presentation.id } })).toBe(0);
    expect(await database.question.count({ where: { id: cascade.question.id } })).toBe(1);
  });
});

function reportBoundary(response: {
  json(): unknown;
  headers: Record<string, string | string[] | number | undefined>;
  body: string;
}) {
  const parsed = questionReportResponseSchema.parse(response.json());
  expect(Object.keys(parsed).sort()).toEqual(['createdAt', 'presentationId', 'reportId']);
  expect(response.headers['cache-control']).toBe('no-store');
  for (const hidden of [
    'details', 'userId', 'questionId', 'snapshot', 'correct', 'choice', 'textEnglish', 'updatedAt',
  ]) expect(response.body).not.toContain(hidden);
  return parsed;
}
