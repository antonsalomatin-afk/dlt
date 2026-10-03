import { z } from 'zod';
import type { PrismaClient } from '../../packages/database/src/index.ts';
import { reviewerIdentitySchema } from './candidate-review.ts';
import {
  canonicalReportInstantSchema,
  createReportInspectionInventory,
  maximumReportInventorySize,
  storedExamReportEvidenceSchema,
  storedPracticeReportEvidenceSchema,
} from './report-inspection.ts';
import { reportTriageDecisionSchema } from './report-triage.ts';

const storedTriageFields = {
  triageDecision: reportTriageDecisionSchema.nullable(),
  triagedBy: z.string().nullable(),
  triagedAt: z.date().nullable(),
};

const storedPracticeTriageReportSchema = storedPracticeReportEvidenceSchema.extend(storedTriageFields);
const storedExamTriageReportSchema = storedExamReportEvidenceSchema.extend(storedTriageFields);

export interface ReportTriageAuditItem {
  reportId: string;
  kind: 'PRACTICE' | 'EXAM';
  createdAt: string;
  questionId: string;
  anchorId: string;
  triage: null | {
    decision: 'ACTION_REQUIRED' | 'NO_ACTION_REQUIRED';
    triagedBy: string;
    triagedAt: string;
  };
}

export interface ReportTriageAuditInventory {
  version: 1;
  summary: {
    total: number;
    practice: number;
    exam: number;
    pending: number;
    actionRequired: number;
    noActionRequired: number;
  };
  items: ReportTriageAuditItem[];
}

interface StoredTriageReportSet {
  counts: { practice: number; exam: number };
  practiceReports: unknown[];
  examReports: unknown[];
  commandClock: Date;
}

export function createReportTriageAuditInventory(input: StoredTriageReportSet): ReportTriageAuditInventory {
  if (Number.isNaN(input.commandClock.valueOf())) throw new Error('Invalid command clock.');
  if (input.counts.practice + input.counts.exam > maximumReportInventorySize) {
    throw new Error('Report triage audit limit exceeded.');
  }
  const practiceReports = storedPracticeTriageReportSchema.array().parse(input.practiceReports);
  const examReports = storedExamTriageReportSchema.array().parse(input.examReports);
  const evidence = createReportInspectionInventory({
    counts: input.counts,
    practiceReports: practiceReports.map((report) => ({
      id: report.id,
      userId: report.userId,
      questionId: report.questionId,
      presentationId: report.presentationId,
      details: report.details,
      createdAt: report.createdAt,
      presentation: report.presentation,
    })),
    examReports: examReports.map((report) => ({
      id: report.id,
      userId: report.userId,
      questionId: report.questionId,
      examSessionId: report.examSessionId,
      examQuestionId: report.examQuestionId,
      details: report.details,
      createdAt: report.createdAt,
      examQuestion: report.examQuestion,
      examSession: report.examSession,
    })),
  });
  const triageByReport = new Map([
    ...practiceReports.map((report) => [reportKey('PRACTICE', report.id), reportTriage(report, input.commandClock)] as const),
    ...examReports.map((report) => [reportKey('EXAM', report.id), reportTriage(report, input.commandClock)] as const),
  ]);
  const items = evidence.items.map((item): ReportTriageAuditItem => {
    const key = reportKey(item.kind, item.reportId);
    if (!triageByReport.has(key)) invalidTriageState();
    return {
      reportId: item.reportId,
      kind: item.kind,
      createdAt: item.createdAt,
      questionId: item.questionId,
      anchorId: item.anchorId,
      triage: triageByReport.get(key) ?? null,
    };
  });
  const actionRequired = items.filter(({ triage }) => triage?.decision === 'ACTION_REQUIRED').length;
  const noActionRequired = items.filter(({ triage }) => triage?.decision === 'NO_ACTION_REQUIRED').length;

  return {
    version: 1,
    summary: {
      total: items.length,
      practice: input.counts.practice,
      exam: input.counts.exam,
      pending: items.length - actionRequired - noActionRequired,
      actionRequired,
      noActionRequired,
    },
    items,
  };
}

export async function inspectReportTriage(
  database: PrismaClient,
  commandClock: Date,
): Promise<ReportTriageAuditInventory> {
  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
    const practice = await transaction.questionReport.count();
    const exam = await transaction.examQuestionReport.count();
    if (practice + exam > maximumReportInventorySize) throw new Error('Report triage audit limit exceeded.');

    const practiceReports = await transaction.questionReport.findMany({
      select: {
        id: true,
        userId: true,
        questionId: true,
        presentationId: true,
        details: true,
        createdAt: true,
        triageDecision: true,
        triagedBy: true,
        triagedAt: true,
        presentation: { select: { id: true, userId: true, questionId: true, snapshot: true } },
      },
    });
    const examReports = await transaction.examQuestionReport.findMany({
      select: {
        id: true,
        userId: true,
        questionId: true,
        examSessionId: true,
        examQuestionId: true,
        details: true,
        createdAt: true,
        triageDecision: true,
        triagedBy: true,
        triagedAt: true,
        examQuestion: { select: { id: true, examSessionId: true, questionId: true, snapshot: true } },
        examSession: { select: { id: true, userId: true } },
      },
    });

    return createReportTriageAuditInventory({
      counts: { practice, exam },
      practiceReports,
      examReports,
      commandClock,
    });
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000, maxWait: 5_000 });
}

function reportTriage(
  report: {
    createdAt: Date;
    triageDecision: 'ACTION_REQUIRED' | 'NO_ACTION_REQUIRED' | null;
    triagedBy: string | null;
    triagedAt: Date | null;
  },
  commandClock: Date,
): ReportTriageAuditItem['triage'] {
  const allNull = report.triageDecision === null && report.triagedBy === null && report.triagedAt === null;
  if (allNull) return null;
  if (report.triageDecision === null || report.triagedBy === null || report.triagedAt === null) {
    throw new Error('Stored report has a partial triage tuple.');
  }
  const triagedBy = reviewerIdentitySchema.parse(report.triagedBy);
  const triagedAt = canonicalReportInstantSchema.parse(report.triagedAt.toISOString());
  if (report.triagedAt.getTime() < report.createdAt.getTime() || report.triagedAt.getTime() > commandClock.getTime()) {
    throw new Error('Stored report triage time is invalid.');
  }
  return { decision: report.triageDecision, triagedBy, triagedAt };
}

function invalidTriageState(): never {
  throw new Error('Stored report triage state is missing.');
}

function reportKey(kind: ReportTriageAuditItem['kind'], reportId: string): string {
  return `${kind}:${reportId}`;
}
