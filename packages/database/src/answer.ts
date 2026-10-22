import { z } from 'zod';
import { Prisma } from './index.ts';
import { parsePresentationSnapshot } from './presentation.ts';

export const answerRequestSchema = z.strictObject({ presentationId: z.uuid(), choiceId: z.uuid() });
export const answerResponseSchema = z.strictObject({
  presentationId: z.uuid(), selectedChoiceId: z.uuid(), correctChoiceId: z.uuid(), isCorrect: z.boolean(),
  explanationThai: z.string().nullable(), explanationEnglish: z.string().nullable(), explanationRussian: z.string().nullable(),
  trapExplanationThai: z.string().nullable(), trapExplanationEnglish: z.string().nullable(), trapExplanationRussian: z.string().nullable(),
});

// Prisma's PostgreSQL adapter reports the named index through its driver cause.
const duplicateMetadata = z.object({
  modelName: z.literal('AnswerAttempt'),
  driverAdapterError: z.object({ cause: z.object({
    originalCode: z.literal('23505'), kind: z.literal('UniqueConstraintViolation'),
    table: z.literal('AnswerAttempt'),
    constraint: z.object({ index: z.literal('AnswerAttempt_presentationId_key') }),
  }) }),
});
export function isDuplicateAnswer(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    && duplicateMetadata.safeParse(error.meta).success;
}

export function practiceAnswerResponse(presentationId: string, snapshotInput: unknown, answer: { selectedChoiceId: string; isCorrect: boolean }) {
  const snapshot = parsePresentationSnapshot(snapshotInput);
  if (!snapshot.question.choices.some(({ id }) => id === answer.selectedChoiceId)
    || answer.isCorrect !== (answer.selectedChoiceId === snapshot.correctChoiceId)) throw new Error('Stored practice answer is inconsistent');
  return answerResponseSchema.parse({
    presentationId, ...answer, correctChoiceId: snapshot.correctChoiceId,
    explanationThai: snapshot.explanationThai, explanationEnglish: snapshot.explanationEnglish, explanationRussian: snapshot.explanationRussian,
    trapExplanationThai: snapshot.trapExplanationThai, trapExplanationEnglish: snapshot.trapExplanationEnglish, trapExplanationRussian: snapshot.trapExplanationRussian,
  });
}

/** Caller owns the transaction: attempt and concept accounting must commit together. */
export async function submitPracticeAnswer(tx: Prisma.TransactionClient, userId: string, presentationId: string, choiceId: string, submittedAt: Date) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "QuestionPresentation" WHERE id = ${presentationId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`);
  const presentation = await tx.questionPresentation.findFirst({ where: { id: presentationId, userId } });
  if (!presentation) return { error: 'Presentation not found' } as const;
  const snapshot = parsePresentationSnapshot(presentation.snapshot);
  if (!snapshot.question.choices.some((choice) => choice.id === choiceId)) return { error: 'Bad Request' } as const;
  const answer = await tx.answerAttempt.create({ data: {
    presentationId, selectedChoiceId: choiceId, isCorrect: choiceId === snapshot.correctChoiceId, submittedAt,
  } });
  if (presentation.conceptId !== null) {
    const updates = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ConceptLearningState" ("userId", "conceptId", "practiceAnswered", "practiceCorrect", "lastPracticeAt")
      VALUES (${userId}::uuid, ${presentation.conceptId}::uuid, 1, ${answer.isCorrect ? 1 : 0}, ${submittedAt})
      ON CONFLICT ("userId", "conceptId") DO UPDATE SET
        "practiceAnswered" = "ConceptLearningState"."practiceAnswered" + 1,
        "practiceCorrect" = "ConceptLearningState"."practiceCorrect" + EXCLUDED."practiceCorrect",
        "lastPracticeAt" = GREATEST("ConceptLearningState"."lastPracticeAt", EXCLUDED."lastPracticeAt")
    `);
    if (updates !== 1) throw new Error('Practice learning state update cardinality is inconsistent');
  }
  return practiceAnswerResponse(presentation.id, snapshot, { selectedChoiceId: answer.selectedChoiceId, isCorrect: answer.isCorrect });
}
