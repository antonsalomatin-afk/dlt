import { z } from 'zod';
import { Prisma } from './index.ts';

const canonicalUtcInstant = z.string().length(24).refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
});

const reportDetails = z.string()
  .refine((value) => {
    const characterCount = [...value].length;
    return characterCount >= 3 && characterCount <= 1000;
  })
  .refine((value) => value === value.trim())
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 4000)
  .refine((value) => !/[\uD800-\uDFFF]/u.test(value))
  .refine((value) => [...value].every((character) => character === '\n' || !/\p{Cc}/u.test(character)));

export const questionReportRequestSchema = z.strictObject({
  presentationId: z.uuid(),
  details: reportDetails,
});

export const questionReportResponseSchema = z.strictObject({
  reportId: z.uuid(),
  presentationId: z.uuid(),
  createdAt: canonicalUtcInstant,
});

const duplicateMetadata = z.object({
  modelName: z.literal('QuestionReport'),
  driverAdapterError: z.object({ cause: z.object({
    originalCode: z.literal('23505'),
    kind: z.literal('UniqueConstraintViolation'),
    table: z.literal('QuestionReport'),
    constraint: z.object({ index: z.literal('QuestionReport_presentationId_key') }),
  }) }),
});

export function isDuplicateQuestionReport(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    && duplicateMetadata.safeParse(error.meta).success;
}
