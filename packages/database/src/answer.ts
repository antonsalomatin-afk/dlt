import { z } from 'zod';
import { Prisma } from './index.ts';

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
