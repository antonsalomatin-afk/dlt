import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';
import { inspectQuestionReports } from '../tools/content/report-inspection.ts';
import {
  applyReportTriage,
  parseReportTriageManifest,
  type ReportTriageManifest,
} from '../tools/content/report-triage.ts';
import { reportTriageFailureMessage } from '../tools/content/report-triage-cli.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });
const databaseName = `report_triage_test_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const cliPath = fileURLToPath(new URL('../tools/content/triage-reports.ts', import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'thaidlt-report-triage-integration-'));
const commandClock = new Date('2026-10-05T00:00:00.000Z');
const triagedAt = '2026-10-01T00:00:00.000Z';
const triagedBy = 'Trusted Integration Reviewer';
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
  if (migration.status !== 0 || migration.error) throw new Error('Isolated report triage migration failed.');
  await database.user.create({ data: {
    id: userId,
    telegramUserId: 157_001n,
    username: 'private_triage_user',
    firstName: 'Private Triage User',
  } });
  await database.category.create({ data: {
    id: categoryId,
    slug: 'report-triage-test',
    nameThai: 'หมวดการคัดแยก',
    nameEnglish: 'Report triage test',
    nameRussian: 'Проверка маршрутизации жалоб',
  } });
  sourceQuestion = await createSourceQuestion();
}, 150_000);

afterAll(async () => {
  try {
    await database.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
    rmSync(temporaryDirectory, { recursive: true, force: true });
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
      sourceReference: 'internal:triage-test-source',
      textThai: 'คำถามสำหรับการคัดแยก',
      textExamEnglish: 'Synthetic triage exam wording',
      textEnglish: 'Synthetic triage normalized wording',
      textRussian: 'Синтетический вопрос для маршрутизации',
      explanationThai: 'คำอธิบาย',
      explanationEnglish: 'Synthetic explanation',
      explanationRussian: 'Синтетическое объяснение',
      trapExplanationThai: 'กับดัก',
      trapExplanationEnglish: 'Synthetic trap explanation',
      trapExplanationRussian: 'Синтетическое объяснение ловушки',
      choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
        key,
        textThai: `ตัวเลือก ${key}`,
        textEnglish: `Choice ${key}`,
        textRussian: `Вариант ${key}`,
        isCorrect: key === 'A',
      })) },
    },
    include: { choices: { orderBy: { key: 'asc' } } },
  });
}

async function createPracticeReport(label: string) {
  const presentation = await database.questionPresentation.create({ data: {
    userId,
    questionId: sourceQuestion.id,
    snapshot: snapshotQuestion(sourceQuestion),
    createdAt: new Date('2026-09-30T09:00:00.000Z'),
  } });
  const selected = sourceQuestion.choices[1]!;
  await database.answerAttempt.create({ data: {
    presentationId: presentation.id,
    selectedChoiceId: selected.id,
    isCorrect: false,
    submittedAt: new Date('2026-09-30T09:05:00.000Z'),
  } });
  const report = await database.questionReport.create({ data: {
    userId,
    questionId: sourceQuestion.id,
    presentationId: presentation.id,
    details: `Practice allegation ${label} ภาษาไทย 😀\nSecond line.`,
    createdAt: new Date('2026-09-30T10:00:00.000Z'),
  } });
  return { report, presentation };
}

async function createExamReport(label: string) {
  const examSession = await database.examSession.create({ data: {
    userId,
    vehicleType: 'CAR',
    passingScore: 45,
    startedAt: new Date('2026-09-30T08:00:00.000Z'),
    expiresAt: new Date('2026-09-30T09:00:00.000Z'),
    completedAt: new Date('2026-09-30T08:45:00.000Z'),
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
    answeredAt: new Date('2026-09-30T08:15:00.000Z'),
  } });
  const report = await database.examQuestionReport.create({ data: {
    userId,
    questionId: sourceQuestion.id,
    examSessionId: examSession.id,
    examQuestionId: examQuestion.id,
    details: `Exam allegation ${label} по-русски 😀\nSecond line.`,
    createdAt: new Date('2026-09-30T10:00:00.000Z'),
  } });
  return { report, examSession, examQuestion };
}

async function manifestFor(entries: Array<{
  kind: 'PRACTICE' | 'EXAM';
  reportId: string;
  decision: 'ACTION_REQUIRED' | 'NO_ACTION_REQUIRED';
}>, overrides: Partial<Pick<ReportTriageManifest, 'triagedBy' | 'triagedAt'>> = {}) {
  const inventory = await inspectQuestionReports(database);
  return parseReportTriageManifest({
    version: 1,
    triagedBy: overrides.triagedBy ?? triagedBy,
    triagedAt: overrides.triagedAt ?? triagedAt,
    decisions: entries.map(({ kind, reportId, decision }) => {
      const evidence = inventory.items.find((item) => item.kind === kind && item.reportId === reportId);
      if (!evidence) throw new Error('Missing report evidence fixture.');
      return { ...evidence, decision };
    }),
  }, commandClock);
}

function runCli(path: string) {
  return spawnSync(process.execPath, [cliPath, '--', path], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 30_000,
    windowsHide: true,
  });
}

function stripTriage<T extends { triageDecision: unknown; triagedBy: unknown; triagedAt: unknown }>(row: T) {
  const { triageDecision: _decision, triagedBy: _by, triagedAt: _at, ...evidence } = row;
  void _decision;
  void _by;
  void _at;
  return evidence;
}

describe('offline report triage against isolated PostgreSQL', () => {
  it('applies both decisions, preserves evidence/state, enforces CHECKs and replays or mixes exactly', async () => {
    const practice = await createPracticeReport('initial');
    const exam = await createExamReport('initial');
    expect(practice.report).toMatchObject({ triageDecision: null, triagedBy: null, triagedAt: null });
    expect(exam.report).toMatchObject({ triageDecision: null, triagedBy: null, triagedAt: null });
    const enumLabels = await database.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'ReportTriageDecision'
      ORDER BY enumsortorder
    `;
    expect(enumLabels.map(({ enumlabel }) => enumlabel)).toEqual(['ACTION_REQUIRED', 'NO_ACTION_REQUIRED']);
    await expect(database.questionReport.update({
      where: { id: practice.report.id },
      data: { triageDecision: 'ACTION_REQUIRED' },
    })).rejects.toThrow();
    await expect(database.examQuestionReport.update({
      where: { id: exam.report.id },
      data: { triageDecision: 'NO_ACTION_REQUIRED' },
    })).rejects.toThrow();
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: practice.report.id } }))
      .toMatchObject({ triageDecision: null, triagedBy: null, triagedAt: null });

    const manifest = await manifestFor([
      { kind: 'PRACTICE', reportId: practice.report.id, decision: 'ACTION_REQUIRED' },
      { kind: 'EXAM', reportId: exam.report.id, decision: 'NO_ACTION_REQUIRED' },
    ]);
    const before = {
      user: await database.user.findUniqueOrThrow({ where: { id: userId } }),
      question: await database.question.findUniqueOrThrow({ where: { id: sourceQuestion.id } }),
      choices: await database.questionChoice.findMany({ where: { questionId: sourceQuestion.id }, orderBy: { id: 'asc' } }),
      presentation: await database.questionPresentation.findUniqueOrThrow({ where: { id: practice.presentation.id } }),
      attempt: await database.answerAttempt.findUniqueOrThrow({ where: { presentationId: practice.presentation.id } }),
      examSession: await database.examSession.findUniqueOrThrow({ where: { id: exam.examSession.id } }),
      examQuestion: await database.examQuestion.findUniqueOrThrow({ where: { id: exam.examQuestion.id } }),
      practiceEvidence: stripTriage(await database.questionReport.findUniqueOrThrow({ where: { id: practice.report.id } })),
      examEvidence: stripTriage(await database.examQuestionReport.findUniqueOrThrow({ where: { id: exam.report.id } })),
    };

    expect(await applyReportTriage(database, manifest)).toEqual({
      version: 1,
      summary: { total: 2, actionRequired: 1, noActionRequired: 1, applied: 2, matched: 0 },
    });
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: practice.report.id } })).toMatchObject({
      triageDecision: 'ACTION_REQUIRED', triagedBy, triagedAt: new Date(triagedAt),
    });
    expect(await database.examQuestionReport.findUniqueOrThrow({ where: { id: exam.report.id } })).toMatchObject({
      triageDecision: 'NO_ACTION_REQUIRED', triagedBy, triagedAt: new Date(triagedAt),
    });
    expect(await applyReportTriage(database, manifest)).toEqual({
      version: 1,
      summary: { total: 2, actionRequired: 1, noActionRequired: 1, applied: 0, matched: 2 },
    });

    const path = join(temporaryDirectory, 'exact-replay.json');
    writeFileSync(path, JSON.stringify(manifest));
    const cli = runCli(path);
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe('');
    expect(cli.stdout).toBe(`${JSON.stringify({
      version: 1,
      summary: { total: 2, actionRequired: 1, noActionRequired: 1, applied: 0, matched: 2 },
    })}\n`);
    for (const secret of [triagedBy, practice.report.id, exam.report.id, practice.report.details, exam.report.details, path]) {
      expect(cli.stdout).not.toContain(secret);
    }

    const additional = await createPracticeReport('mixed');
    const mixed = await manifestFor([
      { kind: 'PRACTICE', reportId: practice.report.id, decision: 'ACTION_REQUIRED' },
      { kind: 'PRACTICE', reportId: additional.report.id, decision: 'NO_ACTION_REQUIRED' },
    ]);
    expect(await applyReportTriage(database, mixed)).toEqual({
      version: 1,
      summary: { total: 2, actionRequired: 1, noActionRequired: 1, applied: 1, matched: 1 },
    });

    expect({
      user: await database.user.findUniqueOrThrow({ where: { id: userId } }),
      question: await database.question.findUniqueOrThrow({ where: { id: sourceQuestion.id } }),
      choices: await database.questionChoice.findMany({ where: { questionId: sourceQuestion.id }, orderBy: { id: 'asc' } }),
      presentation: await database.questionPresentation.findUniqueOrThrow({ where: { id: practice.presentation.id } }),
      attempt: await database.answerAttempt.findUniqueOrThrow({ where: { presentationId: practice.presentation.id } }),
      examSession: await database.examSession.findUniqueOrThrow({ where: { id: exam.examSession.id } }),
      examQuestion: await database.examQuestion.findUniqueOrThrow({ where: { id: exam.examQuestion.id } }),
      practiceEvidence: stripTriage(await database.questionReport.findUniqueOrThrow({ where: { id: practice.report.id } })),
      examEvidence: stripTriage(await database.examQuestionReport.findUniqueOrThrow({ where: { id: exam.report.id } })),
    }).toEqual(before);
  }, 120_000);

  it('fails stale, wrong-kind, missing, corrupt, partial and conflicting manifests with full rollback', async () => {
    const first = await createPracticeReport('rollback-first');
    const second = await createExamReport('rollback-second');
    const exact = await manifestFor([
      { kind: 'PRACTICE', reportId: first.report.id, decision: 'ACTION_REQUIRED' },
      { kind: 'EXAM', reportId: second.report.id, decision: 'NO_ACTION_REQUIRED' },
    ]);
    const stale = parseReportTriageManifest({
      ...exact,
      decisions: exact.decisions.map((item, index) => index === 1 ? { ...item, details: `${item.details} stale` } : item),
    }, commandClock);
    await expect(applyReportTriage(database, stale)).rejects.toThrow();
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: first.report.id } }))
      .toMatchObject({ triageDecision: null, triagedBy: null, triagedAt: null });
    expect(await database.examQuestionReport.findUniqueOrThrow({ where: { id: second.report.id } }))
      .toMatchObject({ triageDecision: null, triagedBy: null, triagedAt: null });

    const wrongKind = parseReportTriageManifest({
      ...exact,
      decisions: [{ ...exact.decisions[0]!, kind: 'EXAM' }],
    }, commandClock);
    await expect(applyReportTriage(database, wrongKind)).rejects.toThrow();
    const missing = parseReportTriageManifest({
      ...exact,
      decisions: [{ ...exact.decisions[0]!, reportId: randomUUID() }],
    }, commandClock);
    await expect(applyReportTriage(database, missing)).rejects.toThrow();

    const validSnapshot = snapshotQuestion(sourceQuestion);
    await database.questionPresentation.update({ where: { id: first.presentation.id }, data: { snapshot: { version: 999 } } });
    await expect(applyReportTriage(database, exact)).rejects.toThrow();
    await database.questionPresentation.update({
      where: { id: first.presentation.id },
      data: { snapshot: { ...validSnapshot, question: { ...validSnapshot.question, id: randomUUID() } } },
    });
    await expect(applyReportTriage(database, exact)).rejects.toThrow();
    await database.questionPresentation.update({ where: { id: first.presentation.id }, data: { snapshot: validSnapshot } });

    await database.$executeRawUnsafe('ALTER TABLE "QuestionReport" DROP CONSTRAINT "QuestionReport_triage_tuple_check"');
    await database.questionReport.update({
      where: { id: first.report.id },
      data: { triageDecision: 'ACTION_REQUIRED' },
    });
    await expect(applyReportTriage(database, exact)).rejects.toThrow();
    await database.questionReport.update({
      where: { id: first.report.id },
      data: { triageDecision: null, triagedBy: null, triagedAt: null },
    });
    await database.$executeRawUnsafe(`ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_triage_tuple_check" CHECK (
      ("triageDecision" IS NULL AND "triagedBy" IS NULL AND "triagedAt" IS NULL)
      OR ("triageDecision" IS NOT NULL AND "triagedBy" IS NOT NULL AND "triagedAt" IS NOT NULL)
    )`);

    await database.examQuestionReport.update({
      where: { id: second.report.id },
      data: {
        triageDecision: 'ACTION_REQUIRED',
        triagedBy: 'Different Reviewer',
        triagedAt: new Date('2026-10-01T01:00:00.000Z'),
      },
    });
    await expect(applyReportTriage(database, exact)).rejects.toThrow();
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: first.report.id } }))
      .toMatchObject({ triageDecision: null, triagedBy: null, triagedAt: null });

    const path = join(temporaryDirectory, 'conflicting.json');
    writeFileSync(path, JSON.stringify(exact));
    const cli = runCli(path);
    expect(cli.status).not.toBe(0);
    expect(cli.stdout).toBe('');
    expect(cli.stderr.trim()).toBe(reportTriageFailureMessage);
    expect(cli.stderr).not.toContain(first.report.id);
    expect(cli.stderr).not.toContain(triagedBy);
    expect(cli.stderr).not.toContain(path);
  }, 120_000);

  it('converges identical concurrent manifests and never overwrites a competing decision', async () => {
    const identicalTarget = await createPracticeReport('concurrent-identical');
    const identical = await manifestFor([
      { kind: 'PRACTICE', reportId: identicalTarget.report.id, decision: 'ACTION_REQUIRED' },
    ]);
    const identicalResults = await Promise.all([
      applyReportTriage(database, identical),
      applyReportTriage(database, identical),
    ]);
    expect(identicalResults.map(({ summary }) => summary.applied).sort()).toEqual([0, 1]);
    expect(identicalResults.map(({ summary }) => summary.matched).sort()).toEqual([0, 1]);
    expect(await database.questionReport.findUniqueOrThrow({ where: { id: identicalTarget.report.id } })).toMatchObject({
      triageDecision: 'ACTION_REQUIRED', triagedBy, triagedAt: new Date(triagedAt),
    });

    const competingTarget = await createExamReport('concurrent-competing');
    const action = await manifestFor([
      { kind: 'EXAM', reportId: competingTarget.report.id, decision: 'ACTION_REQUIRED' },
    ]);
    const noAction = parseReportTriageManifest({
      ...action,
      decisions: [{ ...action.decisions[0]!, decision: 'NO_ACTION_REQUIRED' }],
    }, commandClock);
    const competing = await Promise.allSettled([
      applyReportTriage(database, action),
      applyReportTriage(database, noAction),
    ]);
    expect(competing.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const stored = await database.examQuestionReport.findUniqueOrThrow({ where: { id: competingTarget.report.id } });
    expect(['ACTION_REQUIRED', 'NO_ACTION_REQUIRED']).toContain(stored.triageDecision);
    expect(stored).toMatchObject({ triagedBy, triagedAt: new Date(triagedAt) });
  }, 120_000);
});
