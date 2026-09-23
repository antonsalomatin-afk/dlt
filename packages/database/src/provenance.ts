import { z } from 'zod';

/**
 * The provenance a question must carry before it may be verified.
 *
 * Learner-facing delivery requires `active` and `VERIFIED`, so verification is the gate that
 * decides what anyone can ever be shown. The accepted content decision of 2026-09-22 fixes
 * production content as original in-house work citing public Thai traffic law, and these rules
 * are the machine-checkable part of it. The database enforces the same two rules; this schema
 * exists so authoring and import tooling can explain a rejection before writing.
 */
export const questionProvenanceSchema = z.strictObject({
  verificationStatus: z.enum(['DRAFT', 'VERIFIED', 'REJECTED']),
  sourceType: z.enum(['FIXTURE', 'ORIGINAL', 'OFFICIAL', 'THIRD_PARTY']),
  legalCitation: z.string().nullable(),
}).superRefine((question, context) => {
  if (question.verificationStatus !== 'VERIFIED') return;
  if (question.sourceType !== 'ORIGINAL') {
    context.addIssue({
      code: 'custom',
      path: ['sourceType'],
      message: 'Only original in-house content may be verified',
    });
  }
  if (question.legalCitation === null || question.legalCitation.trim() === '') {
    context.addIssue({
      code: 'custom',
      path: ['legalCitation'],
      message: 'A verified question must cite the public law it teaches',
    });
  }
});

export type QuestionProvenance = z.infer<typeof questionProvenanceSchema>;

/** Throws with every provenance problem listed, for tooling that reports before writing. */
export function assertQuestionProvenance(question: unknown): QuestionProvenance {
  const result = questionProvenanceSchema.safeParse(question);
  if (result.success) return result.data;
  const reasons = result.error.issues.map((issue) => issue.message).join('; ');
  throw new Error(`Question provenance is insufficient for verification: ${reasons}`);
}
