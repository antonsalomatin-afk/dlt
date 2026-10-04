import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';
import {
  inspectReportTriage,
  type ReportTriageAuditItem,
} from '../tools/content/report-triage-inspection.ts';
import { reportTriageInspectionFailureMessage } from '../tools/content/report-triage-inspection-cli.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });
const databaseName = `report_triage_audit_test_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const cliPath = fileURLToPath(new URL('../tools/content/inspect-report-triage.ts', import.meta.url));
const commandClock = new Date('2026-10-03T00:00:00.000Z');
const triagedAt = new Date('2026-10-02T00:00:00.000Z');
const userId = randomUUID();
const categoryId = randomUUID();
let created = false;
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
  if (migration.status !== 0 || migration.error) throw new Error('Isolated report triage audit migration failed.');
  await database.user.create({ data: {
    id: userId,
    telegramUserId: 158_001n,
    username: 'private_audit_user',
    firstName: 'Private Audit User',
  } });
  await database.category.create({ data: {
    id: categoryId,
    slug: 'report-triage-audit-test',
    nameThai: 'หมวดตรวจสอบ',
    nameEnglish: 'Report triage audit test',
    nameRussian: 'Аудит маршрутизации жалоб',
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
      sourceReference: 'internal:private-audit-source',
      reviewer: 'Private Question Reviewer',
      reviewedAt: new Date('2026-09-29T00:00:00.000Z'),
      textThai: 'PRIVATE CURRENT THAI QUESTION',
      textExamEnglish: 'PRIVATE CURRENT EXAM WORDING',
      textEnglish: 'PRIVATE CURRENT NORMALIZED WORDING',
      textRussian: 'ПРИВАТНЫЙ ТЕКУЩИЙ ВОПРОС',
      explanationThai: 'PRIVATE THAI EXPLANATION',
      explanationEnglish: 'PRIVATE CURRENT EXPLANATION',
      explanationRussian: 'ПРИВАТНОЕ ОБЪЯСНЕНИЕ',
      trapExplanationThai: 'PRIVATE THAI TRAP',
      trapExplanationEnglish: 'PRIVATE CURRENT TRAP',
      trapExplanationRussian: 'ПРИВАТНАЯ ЛОВУШКА',
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key,
        textThai: `PRIVATE THAI CHOICE ${key}`,
        textEnglish: `PRIVATE CURRENT CHOICE ${key}`,
        textRussian: `ПРИВАТНЫЙ ВАРИАНТ ${key}`,
        isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

async function createPracticeReport(options: {
  label: string;
  id?: string;
  createdAt: Date;
  decision?: 'ACTION_REQUIRED' | 'NO_ACTION_REQUIRED';
  triagedBy?: string;
}) {
  const presentation = await database.questionPresentation.create({ data: {
    userId,
    questionId: sourceQuestion.id,
    snapshot: snapshotQuestion(sourceQuestion),
    createdAt: new Date(options.createdAt.getTime() - 60_000),
  } });
  const selected = sourceQuestion.choices[1]!;
  await database.answerAttempt.create({ data: {
    presentationId: presentation.id,
    selectedChoiceId: selected.id,
    isCorrect: false,
    submittedAt: options.createdAt,
  } });
  const report = await database.questionReport.create({ data: {
    ...(options.id ? { id: options.id } : {}),
    userId,
    questionId: sourceQuestion.id,
    presentationId: presentation.id,
    details: `PRIVATE PRACTICE ALLEGATION ${options.label} 😀\nSecond line.`,
    createdAt: options.createdAt,
    ...(options.decision ? {
      triageDecision: options.decision,
      triagedBy: options.triagedBy ?? `Practice Reviewer ${options.label}`,
      triagedAt,
    } : {}),
  } });
  return { report, presentation };
}

async function createExamReport(options: {
  label: string;
  id?: string;
  createdAt: Date;
  decision?: 'ACTION_REQUIRED' | 'NO_ACTION_REQUIRED';
  triagedBy?: string;
}) {
  const examSession = await database.examSession.create({ data: {
    userId,
    vehicleType: 'CAR',
    passingScore: 45,
    startedAt: new Date(options.createdAt.getTime() - 3_600_000),
    expiresAt: options.createdAt,
    completedAt: new Date(options.createdAt.getTime() - 1_000),
    score: 0,
    passed: false,
  } });
  const selected = sourceQuestion.choices[1]!;
  const examQuestion = await database.examQuestion.create({ data: {
    examSessionId: examSession.id,
    position: 1,
    questionId: sourceQuestion.id,
    snapshot: snapshotQuestion(sourceQuestion),
    selectedChoiceId: selected.id,
    isCorrect: false,
    answeredAt: new Date(options.createdAt.getTime() - 2_000),
  } });
  const report = await database.examQuestionReport.create({ data: {
    ...(options.id ? { id: options.id } : {}),
    userId,
    questionId: sourceQuestion.id,
    examSessionId: examSession.id,
    examQuestionId: examQuestion.id,
    details: `PRIVATE EXAM ALLEGATION ${options.label} 😀\nSecond line.`,
    createdAt: options.createdAt,
    ...(options.decision ? {
      triageDecision: options.decision,
      triagedBy: options.triagedBy ?? `Exam Reviewer ${options.label}`,
      triagedAt,
    } : {}),
  } });
  return { report, examSession, examQuestion };
}

function auditItem(
  source: { report: { id: string; createdAt: Date; questionId: string }; presentation?: { id: string }; examQuestion?: { id: string } },
  kind: 'PRACTICE' | 'EXAM',
  triage: ReportTriageAuditItem['triage'],
): ReportTriageAuditItem {
  const anchorId = kind === 'PRACTICE' ? source.presentation?.id : source.examQuestion?.id;
  if (!anchorId) throw new Error('Missing audit anchor fixture.');
  return {
    reportId: source.report.id,
    kind,
    createdAt: source.report.createdAt.toISOString(),
    questionId: source.report.questionId,
    anchorId,
    triage,
  };
}

function runCli() {
  return spawnSync(process.execPath, [cliPath], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 30_000,
    windowsHide: true,
  });
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

describe('report triage audit against isolated PostgreSQL', () => {
  it('emits all valid practice/exam states in exact order without evidence leakage or writes', async () => {
    const tiedId = randomUUID();
    const tiedCreatedAt = new Date('2026-10-01T15:00:00.000Z');
    const practiceAction = await createPracticeReport({
      label: 'action', id: tiedId, createdAt: tiedCreatedAt, decision: 'ACTION_REQUIRED', triagedBy: 'Practice Action Reviewer',
    });
    const examAction = await createExamReport({
      label: 'action', id: tiedId, createdAt: tiedCreatedAt, decision: 'ACTION_REQUIRED', triagedBy: 'Exam Action Reviewer',
    });
    const examNoAction = await createExamReport({
      label: 'no-action', createdAt: new Date('2026-10-01T14:00:00.000Z'),
      decision: 'NO_ACTION_REQUIRED', triagedBy: 'Exam No Action Reviewer',
    });
    const practiceNoAction = await createPracticeReport({
      label: 'no-action', createdAt: new Date('2026-10-01T13:00:00.000Z'),
      decision: 'NO_ACTION_REQUIRED', triagedBy: 'Practice No Action Reviewer',
    });
    const examPending = await createExamReport({ label: 'pending', createdAt: new Date('2026-10-01T12:00:00.000Z') });
    const practicePending = await createPracticeReport({ label: 'pending', createdAt: new Date('2026-10-01T11:00:00.000Z') });
    const expected = {
      version: 1 as const,
      summary: {
        total: 6, practice: 3, exam: 3, pending: 2, actionRequired: 2, noActionRequired: 2,
      },
      items: [
        auditItem(examAction, 'EXAM', { decision: 'ACTION_REQUIRED', triagedBy: 'Exam Action Reviewer', triagedAt: triagedAt.toISOString() }),
        auditItem(practiceAction, 'PRACTICE', { decision: 'ACTION_REQUIRED', triagedBy: 'Practice Action Reviewer', triagedAt: triagedAt.toISOString() }),
        auditItem(examNoAction, 'EXAM', { decision: 'NO_ACTION_REQUIRED', triagedBy: 'Exam No Action Reviewer', triagedAt: triagedAt.toISOString() }),
        auditItem(practiceNoAction, 'PRACTICE', { decision: 'NO_ACTION_REQUIRED', triagedBy: 'Practice No Action Reviewer', triagedAt: triagedAt.toISOString() }),
        auditItem(examPending, 'EXAM', null),
        auditItem(practicePending, 'PRACTICE', null),
      ],
    };
    const before = await relevantState();
    expect(await inspectReportTriage(database, commandClock)).toEqual(expected);
    expect(await inspectReportTriage(database, commandClock)).toEqual(expected);
    const cli = runCli();
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe('');
    expect(cli.stdout).toBe(`${JSON.stringify(expected)}\n`);
    const outputKeys = collectKeys(JSON.parse(cli.stdout) as unknown);
    for (const prohibited of [
      'details', 'snapshot', 'userId', 'telegramUserId', 'username', 'firstName',
      'tokenHash', 'presentationId', 'examQuestionId', 'examSessionId', 'selectedChoiceId',
      'isCorrect', 'score', 'passed', 'active', 'verificationStatus', 'reviewer',
      'sourceReference', 'correctChoiceId', 'choices', 'explanationEnglish',
    ]) expect(outputKeys).not.toContain(prohibited);
    for (const secret of [
      userId, practiceAction.report.details, examAction.report.details,
      'PRIVATE CURRENT NORMALIZED WORDING', 'PRIVATE CURRENT CHOICE',
      'PRIVATE CURRENT EXPLANATION', 'internal:private-audit-source',
    ]) expect(cli.stdout).not.toContain(secret);
    expect(await relevantState()).toEqual(before);
  }, 120_000);

  it('fails closed on corrupt evidence and every invalid stored triage state without writes', async () => {
    const practice = await createPracticeReport({ label: 'corrupt', createdAt: new Date('2026-10-01T10:00:00.000Z') });
    const originalSnapshot = snapshotQuestion(sourceQuestion);
    await database.questionPresentation.update({ where: { id: practice.presentation.id }, data: { snapshot: { version: 999 } } });
    await expectNoWriteFailure();
    await database.questionPresentation.update({
      where: { id: practice.presentation.id },
      data: { snapshot: { ...originalSnapshot, question: { ...originalSnapshot.question, id: randomUUID() } } },
    });
    await expectNoWriteFailure();
    await database.questionPresentation.update({ where: { id: practice.presentation.id }, data: { snapshot: originalSnapshot } });

    await database.$executeRawUnsafe('ALTER TABLE "QuestionReport" DROP CONSTRAINT "QuestionReport_triage_tuple_check"');
    await database.questionReport.update({ where: { id: practice.report.id }, data: { triageDecision: 'ACTION_REQUIRED' } });
    await expectNoWriteFailure();
    await database.questionReport.update({
      where: { id: practice.report.id }, data: { triageDecision: null, triagedBy: null, triagedAt: null },
    });
    await database.$executeRawUnsafe(`ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_triage_tuple_check" CHECK (
      ("triageDecision" IS NULL AND "triagedBy" IS NULL AND "triagedAt" IS NULL)
      OR ("triageDecision" IS NOT NULL AND "triagedBy" IS NOT NULL AND "triagedAt" IS NOT NULL)
    )`);

    for (const invalid of [
      { triagedBy: ' padded operator ', triagedAt },
      { triagedBy: 'Trusted Reviewer', triagedAt: new Date('2026-09-30T00:00:00.000Z') },
      { triagedBy: 'Trusted Reviewer', triagedAt: new Date('2099-01-01T00:00:00.000Z') },
    ]) {
      await database.questionReport.update({ where: { id: practice.report.id }, data: {
        triageDecision: 'ACTION_REQUIRED', triagedBy: invalid.triagedBy, triagedAt: invalid.triagedAt,
      } });
      await expectNoWriteFailure();
    }
  }, 120_000);

  it('rejects more than 500 combined reports without truncation or writes', async () => {
    const snapshot = snapshotQuestion(sourceQuestion);
    const presentations = Array.from({ length: 501 }, (_, index) => ({
      id: randomUUID(),
      userId,
      questionId: sourceQuestion.id,
      snapshot,
      createdAt: new Date(1_750_000_000_000 + index),
    }));
    await database.questionPresentation.createMany({ data: presentations });
    await database.questionReport.createMany({ data: presentations.map((presentation, index) => ({
      id: randomUUID(),
      userId,
      questionId: sourceQuestion.id,
      presentationId: presentation.id,
      details: `PRIVATE BOUNDED AUDIT ALLEGATION ${index}.`,
      createdAt: new Date(1_750_100_000_000 + index),
    })) });
    const before = await relevantState();
    await expect(inspectReportTriage(database, commandClock)).rejects.toThrow();
    const cli = runCli();
    expect(cli.status).not.toBe(0);
    expect(cli.stdout).toBe('');
    expect(cli.stderr.trim()).toBe(reportTriageInspectionFailureMessage);
    expect(await relevantState()).toEqual(before);
  }, 120_000);
});

async function expectNoWriteFailure() {
  const before = await relevantState();
  await expect(inspectReportTriage(database, commandClock)).rejects.toThrow();
  const cli = runCli();
  expect(cli.status).not.toBe(0);
  expect(cli.stdout).toBe('');
  expect(cli.stderr.trim()).toBe(reportTriageInspectionFailureMessage);
  expect(cli.stderr).not.toContain('PRIVATE');
  expect(await relevantState()).toEqual(before);
}

function collectKeys(input: unknown): string[] {
  if (Array.isArray(input)) return input.flatMap(collectKeys);
  if (input === null || typeof input !== 'object') return [];
  return Object.entries(input).flatMap(([key, value]) => [key, ...collectKeys(value)]);
}
