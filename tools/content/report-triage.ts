import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../../packages/database/src/index.ts';
import { reportDetailsSchema } from '../../packages/database/src/report.ts';
import { reviewerIdentitySchema } from './candidate-review.ts';
import { readBoundedJsonFile } from './candidates.ts';
import {
  canonicalReportInstantSchema,
  canonicalReportUuidSchema,
  createReportInspectionInventory,
  reportEvidenceSnapshotSchema,
  type ReportInspectionItem,
} from './report-inspection.ts';

export const reportTriageDecisionSchema = z.enum(['ACTION_REQUIRED', 'NO_ACTION_REQUIRED']);
const maximumTriageAttempts = 5;

const reportTriageItemSchema = z.strictObject({
  reportId: canonicalReportUuidSchema,
  kind: z.enum(['PRACTICE', 'EXAM']),
  createdAt: canonicalReportInstantSchema,
  details: reportDetailsSchema,
  questionId: canonicalReportUuidSchema,
  anchorId: canonicalReportUuidSchema,
  snapshot: reportEvidenceSnapshotSchema,
  decision: reportTriageDecisionSchema,
}).superRefine((item, context) => {
  if (item.snapshot.question.id !== item.questionId) {
    context.addIssue({ code: 'custom', path: ['snapshot', 'question', 'id'], message: 'must match questionId.' });
  }
});

export const reportTriageManifestSchema = z.strictObject({
  version: z.literal(1),
  triagedBy: reviewerIdentitySchema,
  triagedAt: canonicalReportInstantSchema,
  decisions: z.array(reportTriageItemSchema)
    .min(1, 'must contain at least one decision.')
    .max(500, 'must contain at most 500 decisions.'),
}).superRefine((manifest, context) => {
  if (containsUnpairedSurrogate(manifest)) {
    context.addIssue({ code: 'custom', path: [], message: 'must contain valid Unicode scalar values.' });
  }
  const seen = new Set<string>();
  const triagedAt = new Date(manifest.triagedAt).getTime();
  for (const [index, decision] of manifest.decisions.entries()) {
    const key = reportKey(decision.kind, decision.reportId);
    if (seen.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['decisions', index, 'reportId'],
        message: 'duplicates another decision for this report kind.',
      });
    }
    seen.add(key);
    if (triagedAt < new Date(decision.createdAt).getTime()) {
      context.addIssue({
        code: 'custom',
        path: ['triagedAt'],
        message: 'must not precede a selected report.',
      });
    }
  }
});

export type ReportTriageManifest = z.infer<typeof reportTriageManifestSchema>;

export interface ReportTriageSummary {
  version: 1;
  summary: {
    total: number;
    actionRequired: number;
    noActionRequired: number;
    applied: number;
    matched: number;
  };
}

export function parseReportTriageManifest(input: unknown, commandClock: Date): ReportTriageManifest {
  if (Number.isNaN(commandClock.valueOf())) throw new Error('Invalid command clock.');
  return reportTriageManifestSchema.superRefine((manifest, context) => {
    if (new Date(manifest.triagedAt).getTime() > commandClock.getTime()) {
      context.addIssue({ code: 'custom', path: ['triagedAt'], message: 'must not be later than the command clock.' });
    }
  }).parse(input);
}

export function readReportTriageManifestFile(path: string, commandClock: Date): ReportTriageManifest {
  return parseReportTriageManifest(readBoundedJsonFile(path), commandClock);
}

export function reportTriagePathArgument(rawArguments: string[]): string | undefined {
  const argumentsAfterCommand = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
  const path = argumentsAfterCommand[0];
  return argumentsAfterCommand.length === 1 && path !== undefined && path.trim().length > 0
    ? path
    : undefined;
}

export async function applyReportTriage(
  database: PrismaClient,
  manifest: ReportTriageManifest,
): Promise<ReportTriageSummary> {
  for (let attempt = 1; attempt <= maximumTriageAttempts; attempt++) {
    try {
      return await applyReportTriageOnce(database, manifest);
    } catch (error) {
      if (!isRetryableTriageConflict(error) || attempt === maximumTriageAttempts) throw error;
    }
  }
  throw new Error('Report triage retry did not resolve.');
}

async function applyReportTriageOnce(
  database: PrismaClient,
  manifest: ReportTriageManifest,
): Promise<ReportTriageSummary> {
  return database.$transaction(async (transaction) => {
    const practiceIds = manifest.decisions
      .filter(({ kind }) => kind === 'PRACTICE')
      .map(({ reportId }) => reportId);
    const examIds = manifest.decisions
      .filter(({ kind }) => kind === 'EXAM')
      .map(({ reportId }) => reportId);
    const practiceReports = await transaction.questionReport.findMany({
      where: { id: { in: practiceIds } },
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
      where: { id: { in: examIds } },
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

    const storedInventory = createReportInspectionInventory({
      counts: { practice: practiceIds.length, exam: examIds.length },
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
    const storedEvidence = new Map(storedInventory.items.map((item) => [reportKey(item.kind, item.reportId), item]));
    const storedTriage = new Map<string, {
      triageDecision: 'ACTION_REQUIRED' | 'NO_ACTION_REQUIRED' | null;
      triagedBy: string | null;
      triagedAt: Date | null;
    }>();
    for (const report of practiceReports) storedTriage.set(reportKey('PRACTICE', report.id), report);
    for (const report of examReports) storedTriage.set(reportKey('EXAM', report.id), report);
    const triagedAt = new Date(manifest.triagedAt);
    const pending: ReportTriageManifest['decisions'] = [];
    let matched = 0;

    for (const item of manifest.decisions) {
      const key = reportKey(item.kind, item.reportId);
      const evidence = storedEvidence.get(key);
      const existing = storedTriage.get(key);
      const { decision, ...expectedEvidence } = item;
      if (evidence === undefined || existing === undefined || !isDeepStrictEqual(evidence, expectedEvidence)) {
        throw new Error('Report triage evidence is stale or inconsistent.');
      }
      const allNull = existing.triageDecision === null && existing.triagedBy === null && existing.triagedAt === null;
      if (allNull) {
        pending.push(item);
        continue;
      }
      const exact = existing.triageDecision === decision
        && existing.triagedBy === manifest.triagedBy
        && existing.triagedAt?.getTime() === triagedAt.getTime();
      if (!exact) throw new Error('Report already has a conflicting triage decision.');
      matched++;
    }

    for (const item of pending) {
      const update = {
        where: {
          id: item.reportId,
          triageDecision: null,
          triagedBy: null,
          triagedAt: null,
        },
        data: {
          triageDecision: item.decision,
          triagedBy: manifest.triagedBy,
          triagedAt,
        },
      } as const;
      const result = item.kind === 'PRACTICE'
        ? await transaction.questionReport.updateMany(update)
        : await transaction.examQuestionReport.updateMany(update);
      if (result.count !== 1) throw new TriageWriteRaceError();
    }

    return {
      version: 1,
      summary: {
        total: manifest.decisions.length,
        actionRequired: manifest.decisions.filter(({ decision }) => decision === 'ACTION_REQUIRED').length,
        noActionRequired: manifest.decisions.filter(({ decision }) => decision === 'NO_ACTION_REQUIRED').length,
        applied: pending.length,
        matched,
      },
    };
  }, { isolationLevel: 'Serializable', timeout: 30_000, maxWait: 5_000 });
}

class TriageWriteRaceError extends Error {}

function isRetryableTriageConflict(error: unknown): boolean {
  return error instanceof TriageWriteRaceError
    || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034');
}

function reportKey(kind: ReportInspectionItem['kind'], reportId: string): string {
  return `${kind}:${reportId}`;
}

function containsUnpairedSurrogate(input: unknown): boolean {
  if (typeof input === 'string') return /[\uD800-\uDFFF]/u.test(input);
  if (Array.isArray(input)) return input.some(containsUnpairedSurrogate);
  if (input === null || typeof input !== 'object') return false;
  return Object.values(input).some(containsUnpairedSurrogate);
}
