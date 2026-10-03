import { z } from 'zod';
import type { PrismaClient } from '../../packages/database/src/index.ts';
import {
  parsePresentationSnapshot,
  presentationSnapshotSchema,
} from '../../packages/database/src/presentation.ts';
import { reportDetailsSchema } from '../../packages/database/src/report.ts';

export const maximumReportInventorySize = 500;

export const canonicalReportUuidSchema = z.uuid().refine((value) => value === value.toLowerCase());
export const canonicalReportInstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
  });
const storedDateSchema = z.date()
  .refine((value) => canonicalReportInstantSchema.safeParse(value.toISOString()).success);

export const reportEvidenceSnapshotSchema = presentationSnapshotSchema.superRefine((snapshot, context) => {
  for (const [path, id] of [
    [['question', 'id'], snapshot.question.id],
    [['correctChoiceId'], snapshot.correctChoiceId],
    ...snapshot.question.choices.map(({ id }, index) => [['question', 'choices', index, 'id'], id] as const),
  ] as const) {
    if (!canonicalReportUuidSchema.safeParse(id).success) {
      context.addIssue({ code: 'custom', path: [...path], message: 'must be a canonical UUID.' });
    }
  }
});

export const storedPracticeReportEvidenceSchema = z.strictObject({
  id: canonicalReportUuidSchema,
  userId: canonicalReportUuidSchema,
  questionId: canonicalReportUuidSchema,
  presentationId: canonicalReportUuidSchema,
  details: reportDetailsSchema,
  createdAt: storedDateSchema,
  presentation: z.strictObject({
    id: canonicalReportUuidSchema,
    userId: canonicalReportUuidSchema,
    questionId: canonicalReportUuidSchema,
    snapshot: z.unknown(),
  }),
});

export const storedExamReportEvidenceSchema = z.strictObject({
  id: canonicalReportUuidSchema,
  userId: canonicalReportUuidSchema,
  questionId: canonicalReportUuidSchema,
  examSessionId: canonicalReportUuidSchema,
  examQuestionId: canonicalReportUuidSchema,
  details: reportDetailsSchema,
  createdAt: storedDateSchema,
  examQuestion: z.strictObject({
    id: canonicalReportUuidSchema,
    examSessionId: canonicalReportUuidSchema,
    questionId: canonicalReportUuidSchema,
    snapshot: z.unknown(),
  }),
  examSession: z.strictObject({
    id: canonicalReportUuidSchema,
    userId: canonicalReportUuidSchema,
  }),
});

export interface ReportInspectionSummary {
  total: number;
  practice: number;
  exam: number;
}

export interface ReportInspectionItem {
  reportId: string;
  kind: 'PRACTICE' | 'EXAM';
  createdAt: string;
  details: string;
  questionId: string;
  anchorId: string;
  snapshot: ReturnType<typeof parsePresentationSnapshot>;
}

export interface ReportInspectionInventory {
  version: 1;
  summary: ReportInspectionSummary;
  items: ReportInspectionItem[];
}

interface StoredReportSet {
  counts: { practice: number; exam: number };
  practiceReports: unknown[];
  examReports: unknown[];
}

export function createReportInspectionInventory(input: StoredReportSet): ReportInspectionInventory {
  validateCount(input.counts.practice);
  validateCount(input.counts.exam);
  const countedTotal = input.counts.practice + input.counts.exam;
  if (countedTotal > maximumReportInventorySize) throw new Error('Report inventory limit exceeded.');
  if (input.practiceReports.length !== input.counts.practice || input.examReports.length !== input.counts.exam) {
    throw new Error('Report inventory count mismatch.');
  }

  const practiceReports = storedPracticeReportEvidenceSchema.array().parse(input.practiceReports);
  const examReports = storedExamReportEvidenceSchema.array().parse(input.examReports);
  rejectDuplicateIds(practiceReports);
  rejectDuplicateIds(examReports);

  const items: ReportInspectionItem[] = [
    ...practiceReports.map((report): ReportInspectionItem => {
      if (report.presentationId !== report.presentation.id
        || report.userId !== report.presentation.userId
        || report.questionId !== report.presentation.questionId) {
        throw new Error('Practice report ownership tuple mismatch.');
      }
      return {
        reportId: report.id,
        kind: 'PRACTICE',
        createdAt: report.createdAt.toISOString(),
        details: report.details,
        questionId: report.questionId,
        anchorId: report.presentationId,
        snapshot: parseStoredSnapshot(report.presentation.snapshot, report.questionId),
      };
    }),
    ...examReports.map((report): ReportInspectionItem => {
      if (report.examQuestionId !== report.examQuestion.id
        || report.examSessionId !== report.examQuestion.examSessionId
        || report.questionId !== report.examQuestion.questionId
        || report.examSessionId !== report.examSession.id
        || report.userId !== report.examSession.userId) {
        throw new Error('Exam report ownership tuple mismatch.');
      }
      return {
        reportId: report.id,
        kind: 'EXAM',
        createdAt: report.createdAt.toISOString(),
        details: report.details,
        questionId: report.questionId,
        anchorId: report.examQuestionId,
        snapshot: parseStoredSnapshot(report.examQuestion.snapshot, report.questionId),
      };
    }),
  ];

  items.sort(compareItems);
  return {
    version: 1,
    summary: { total: countedTotal, practice: input.counts.practice, exam: input.counts.exam },
    items,
  };
}

export async function inspectQuestionReports(database: PrismaClient): Promise<ReportInspectionInventory> {
  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
    const practice = await transaction.questionReport.count();
    const exam = await transaction.examQuestionReport.count();
    if (practice + exam > maximumReportInventorySize) throw new Error('Report inventory limit exceeded.');

    const practiceReports = await transaction.questionReport.findMany({
      select: {
        id: true,
        userId: true,
        questionId: true,
        presentationId: true,
        details: true,
        createdAt: true,
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
        examQuestion: { select: { id: true, examSessionId: true, questionId: true, snapshot: true } },
        examSession: { select: { id: true, userId: true } },
      },
    });

    return createReportInspectionInventory({
      counts: { practice, exam },
      practiceReports,
      examReports,
    });
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000, maxWait: 5_000 });
}

function parseStoredSnapshot(input: unknown, questionId: string) {
  const snapshot = reportEvidenceSnapshotSchema.parse(input);
  if (snapshot.question.id !== questionId) throw new Error('Snapshot question identity mismatch.');
  return snapshot;
}

function validateCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid report count.');
}

function rejectDuplicateIds(reports: { id: string }[]) {
  if (new Set(reports.map(({ id }) => id)).size !== reports.length) {
    throw new Error('Duplicate report identity.');
  }
}

function compareItems(left: ReportInspectionItem, right: ReportInspectionItem): number {
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  if (left.reportId !== right.reportId) return left.reportId > right.reportId ? -1 : 1;
  if (left.kind === right.kind) return 0;
  return left.kind < right.kind ? -1 : 1;
}
