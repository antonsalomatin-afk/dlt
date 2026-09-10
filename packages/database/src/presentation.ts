import { z } from 'zod';
import type { Prisma } from './index.ts';

const text = z.string().refine((value) => value.trim().length > 0);
const translation = z.string().nullable();
export const presentedChoiceSchema = z.strictObject({
  id: z.uuid(), key: z.enum(['A', 'B', 'C', 'D']),
  textThai: translation, textEnglish: text, textRussian: translation,
});
export const presentedQuestionSchema = z.strictObject({
  id: z.uuid(), textThai: translation, textExamEnglish: translation,
  textEnglish: text, textRussian: translation,
  choices: z.array(presentedChoiceSchema).length(4)
    .refine((choices) => new Set(choices.map((choice) => choice.id)).size === 4)
    .refine((choices) => new Set(choices.map((choice) => choice.key)).size === 4),
});
export const presentationResponseSchema = z.strictObject({ presentationId: z.uuid(), question: presentedQuestionSchema });
export const presentationSnapshotSchema = z.strictObject({
  version: z.literal(1), question: presentedQuestionSchema, correctChoiceId: z.uuid(),
  explanationThai: translation, explanationEnglish: translation, explanationRussian: translation,
  trapExplanationThai: translation, trapExplanationEnglish: translation, trapExplanationRussian: translation,
}).refine((snapshot) => snapshot.question.choices.some((choice) => choice.id === snapshot.correctChoiceId));

/** Use this boundary for persisted JSON reads as well as writes. Unknown versions fail closed. */
export function parsePresentationSnapshot(value: unknown) { return presentationSnapshotSchema.parse(value); }

export function snapshotQuestion(source: Prisma.QuestionGetPayload<{ include: { choices: true } }>) {
  const correct = source.choices.filter((choice) => choice.isCorrect);
  if (correct.length !== 1) throw new Error('Invalid question answer count');
  return parsePresentationSnapshot({
    version: 1,
    question: {
      id: source.id, textThai: source.textThai, textExamEnglish: source.textExamEnglish,
      textEnglish: source.textEnglish, textRussian: source.textRussian,
      choices: source.choices.map(({ id, key, textThai, textEnglish, textRussian }) => ({ id, key, textThai, textEnglish, textRussian })),
    },
    correctChoiceId: correct[0]?.id,
    explanationThai: source.explanationThai, explanationEnglish: source.explanationEnglish, explanationRussian: source.explanationRussian,
    trapExplanationThai: source.trapExplanationThai, trapExplanationEnglish: source.trapExplanationEnglish, trapExplanationRussian: source.trapExplanationRussian,
  });
}
