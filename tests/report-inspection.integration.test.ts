import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';
import { inspectQuestionReports } from '../tools/content/report-inspection.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });
const databaseName = `report_inspection_test_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const cliPath = fileURLToPath(new URL('../tools/content/inspect-reports.ts', import.meta.url));
const failureMessage = 'Report inspection failed. No report inventory was produced.';
let created = false;

const userId = randomUUID();
const categoryId = randomUUID();
let sourceQuestion: Awaited<ReturnType<typeof createSourceQuestion>>;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const migration = spawnSync(process.execPath, [
    'node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy',
  ], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 120_000,
    stdio: 'pipe',
    windowsHide: true,
  });
  if (migration.status !== 0 || migration.error) throw new Error('Isolated report inspection migration failed.');
  await database.user.create({ data: {
    id: userId,
    telegramUserId: 156_001n,
    username: 'private_report_inspector_user',
    firstName: 'Private report inspector',
  } });
  await database.category.create({ data: {
    id: categoryId,
    slug: 'report-inspection-test',
    nameThai: 'หมวดทดสอบ',
    nameEnglish: 'Report inspection test',
    nameRussian: 'Проверка жалоб',
  } });
  sourceQuestion = await createSourceQuestion();
}, 150_000);

afterAll(async () => {
  try {
    await database.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
});

async function createSourceQuestion() {
  return database.question.create({
    data: {
      categoryId,
      vehicleType: 'CAR',
      active: true,
      verificationStatus: 'VERIFIED',
      sourceType: 'ORIGINAL',
      sourceReference: 'internal:private-current-source-reference',
      reviewer: 'Private Current Reviewer',
      reviewedAt: new Date('2026-10-01T00:00:00.000Z'),
      textThai: 'คำถามที่บันทึกไว้',
      textExamEnglish: 'Saved synthetic exam wording',
      textEnglish: 'Saved synthetic normalized wording',
      textRussian: 'Сохранённый синтетический вопрос',
      explanationThai: 'คำอธิบายที่บันทึกไว้',
      explanationEnglish: 'Saved explanation',
      explanationRussian: 'Сохранённое объяснение',
      trapExplanationThai: 'กับดักที่บันทึกไว้',
      trapExplanationEnglish: 'Saved trap explanation',
      trapExplanationRussian: 'Сохранённое объяснение ловушки',
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key,
        textThai: `ตัวเลือก ${key}`,
        textEnglish: `Saved choice ${key}`,
        textRussian: `Сохранённый вариант ${key}`,
        isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

function runCli() {
  return spawnSync(process.execPath, [cliPath], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 30_000,
    windowsHide: true,
  });
}

async function clearReportFixtures() {
  await database.questionReport.deleteMany();
  await database.examQuestionReport.deleteMany();
  await database.examSession.deleteMany();
  await database.questionPresentation.deleteMany();
}

async function relevantState() {
  return {
    users: await database.user.findMany({ orderBy: { id: 'asc' } }),
    questions: await database.question.findMany({ orderBy: { id: 'asc' } }),
    choices: await database.questionChoice.findMany({ orderBy: { id: 'asc' } }),
    presentations: await database.questionPresentation.findMany({ orderBy: { id: 'asc' } }),
    attempts: await database.answerAttempt.findMany({ orderBy: { id: 'asc' } }),
    practiceReports: await database.questionReport.findMany({ orderBy: { id: 'asc' } }),
    examSessions: await database.examSession.findMany({ orderBy: { id: 'asc' } }),
    examQuestions: await database.examQuestion.findMany({ orderBy: { id: 'asc' } }),
    examReports: await database.examQuestionReport.findMany({ orderBy: { id: 'asc' } }),
  };
}

describe('report inspection against isolated PostgreSQL', () => {
  it('emits exact combined immutable evidence and leaves every relevant row unchanged', async () => {
    await clearReportFixtures();
    const savedSnapshot = snapshotQuestion(sourceQuestion);
    const sharedReportId = randomUUID();
    const createdAt = new Date('2026-10-02T12:00:00.000Z');
    const presentation = await database.questionPresentation.create({ data: {
      userId,
      questionId: sourceQuestion.id,
      snapshot: savedSnapshot,
    } });
    const selected = sourceQuestion.choices[1];
    if (!selected) throw new Error('Missing selected choice fixture.');
    await database.answerAttempt.create({ data: {
      presentationId: presentation.id,
      selectedChoiceId: selected.id,
      isCorrect: false,
      submittedAt: new Date('2026-10-02T11:30:00.000Z'),
    } });
    const practiceDetails = 'Practice allegation ภาษาไทย 😀\nPlease inspect this wording.';
    await database.questionReport.create({ data: {
      id: sharedReportId,
      userId,
      questionId: sourceQuestion.id,
      presentationId: presentation.id,
      details: practiceDetails,
      createdAt,
    } });

    const examSession = await database.examSession.create({ data: {
      userId,
      vehicleType: 'CAR',
      passingScore: 45,
      startedAt: new Date('2026-10-02T10:00:00.000Z'),
      expiresAt: new Date('2026-10-02T11:00:00.000Z'),
      completedAt: new Date('2026-10-02T10:45:00.000Z'),
      score: 0,
      passed: false,
    } });
    const examQuestion = await database.examQuestion.create({ data: {
      examSessionId: examSession.id,
      position: 1,
      questionId: sourceQuestion.id,
      snapshot: savedSnapshot,
      selectedChoiceId: selected.id,
      isCorrect: false,
      answeredAt: new Date('2026-10-02T10:15:00.000Z'),
    } });
    const examDetails = 'Exam allegation по-русски 😀\nPlease inspect this answer.';
    await database.examQuestionReport.create({ data: {
      id: sharedReportId,
      userId,
      questionId: sourceQuestion.id,
      examSessionId: examSession.id,
      examQuestionId: examQuestion.id,
      details: examDetails,
      createdAt,
    } });
    await database.question.update({ where: { id: sourceQuestion.id }, data: {
      textEnglish: 'PRIVATE CURRENT MUTABLE WORDING',
      sourceReference: 'internal:private-mutated-reference',
      active: false,
      verificationStatus: 'REJECTED',
      reviewer: 'Private Mutated Reviewer',
      reviewedAt: new Date('2026-10-02T11:59:00.000Z'),
    } });

    const before = await relevantState();
    const expected = {
      version: 1 as const,
      summary: { total: 2, practice: 1, exam: 1 },
      items: [
        {
          reportId: sharedReportId,
          kind: 'EXAM' as const,
          createdAt: createdAt.toISOString(),
          details: examDetails,
          questionId: sourceQuestion.id,
          anchorId: examQuestion.id,
          snapshot: savedSnapshot,
        },
        {
          reportId: sharedReportId,
          kind: 'PRACTICE' as const,
          createdAt: createdAt.toISOString(),
          details: practiceDetails,
          questionId: sourceQuestion.id,
          anchorId: presentation.id,
          snapshot: savedSnapshot,
        },
      ],
    };
    expect(await inspectQuestionReports(database)).toEqual(expected);
    expect(await inspectQuestionReports(database)).toEqual(expected);

    const cli = runCli();
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe('');
    expect(cli.stdout).toBe(`${JSON.stringify(expected)}\n`);
    const output = JSON.parse(cli.stdout) as unknown;
    expect(JSON.stringify(output)).not.toContain(userId);
    expect(JSON.stringify(output)).not.toContain(examSession.id);
    expect(JSON.stringify(output)).not.toContain('PRIVATE CURRENT MUTABLE WORDING');
    expect(JSON.stringify(output)).not.toContain('private-mutated-reference');
    expect(JSON.stringify(output)).not.toContain('Private Mutated Reviewer');
    const outputKeys = collectKeys(output);
    for (const prohibited of [
      'userId', 'telegramUserId', 'username', 'firstName', 'tokenHash', 'presentationId',
      'examQuestionId', 'examSessionId', 'selectedChoiceId', 'isCorrect', 'score', 'passed',
      'active', 'verificationStatus', 'reviewer', 'sourceReference',
    ]) expect(outputKeys).not.toContain(prohibited);
    expect(await relevantState()).toEqual(before);
  }, 120_000);

  it('fails closed on corrupt and inconsistent saved snapshots without changing rows', async () => {
    await clearReportFixtures();
    const validSnapshot = snapshotQuestion(sourceQuestion);
    const presentation = await database.questionPresentation.create({ data: {
      userId,
      questionId: sourceQuestion.id,
      snapshot: { version: 999 },
    } });
    await database.questionReport.create({ data: {
      userId,
      questionId: sourceQuestion.id,
      presentationId: presentation.id,
      details: 'Corrupt saved snapshot allegation.',
    } });

    for (const corruptSnapshot of [
      { version: 999 },
      { ...validSnapshot, question: { ...validSnapshot.question, id: randomUUID() } },
    ]) {
      await database.questionPresentation.update({
        where: { id: presentation.id },
        data: { snapshot: corruptSnapshot },
      });
      const before = await relevantState();
      await expect(inspectQuestionReports(database)).rejects.toThrow();
      const cli = runCli();
      expect(cli.status).not.toBe(0);
      expect(cli.stdout).toBe('');
      expect(cli.stderr.trim()).toBe(failureMessage);
      expect(await relevantState()).toEqual(before);
    }
  }, 120_000);

  it('rejects 501 reports from one snapshot without truncation or writes', async () => {
    await clearReportFixtures();
    const savedSnapshot = snapshotQuestion(sourceQuestion);
    const presentations = Array.from({ length: 501 }, (_, index) => ({
      id: randomUUID(),
      userId,
      questionId: sourceQuestion.id,
      snapshot: savedSnapshot,
      createdAt: new Date(1_760_000_000_000 + index),
    }));
    await database.questionPresentation.createMany({ data: presentations });
    await database.questionReport.createMany({ data: presentations.map((presentation, index) => ({
      id: randomUUID(),
      userId,
      questionId: sourceQuestion.id,
      presentationId: presentation.id,
      details: `Bounded inventory allegation ${index}.`,
      createdAt: new Date(1_760_100_000_000 + index),
    })) });
    const before = await relevantState();

    await expect(inspectQuestionReports(database)).rejects.toThrow();
    const cli = runCli();
    expect(cli.status).not.toBe(0);
    expect(cli.stdout).toBe('');
    expect(cli.stderr.trim()).toBe(failureMessage);
    expect(await relevantState()).toEqual(before);
  }, 120_000);
});

function collectKeys(input: unknown): string[] {
  if (Array.isArray(input)) return input.flatMap(collectKeys);
  if (input === null || typeof input !== 'object') return [];
  return Object.entries(input).flatMap(([key, value]) => [key, ...collectKeys(value)]);
}
