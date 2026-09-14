import { z } from 'zod';

export const vehicleSchema = z.enum(['CAR', 'MOTORCYCLE']);
export type Vehicle = z.infer<typeof vehicleSchema>;
export const userSchema = z.strictObject({
  id: z.uuid(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  selectedVehicleType: vehicleSchema.nullable(),
});
export const loginSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  expiresAt: z.iso.datetime(),
  user: userSchema,
});
export type Session = z.infer<typeof loginSchema>;

const text = z.string().refine((value) => value.trim().length > 0);
const translation = z.string().nullable();
export const presentationSchema = z.strictObject({
  presentationId: z.uuid(),
  question: z.strictObject({
    id: z.uuid(), textThai: translation, textExamEnglish: translation, textEnglish: text, textRussian: translation,
    choices: z.array(z.strictObject({ id: z.uuid(), key: z.enum(['A', 'B', 'C', 'D']), textThai: translation, textEnglish: text, textRussian: translation })).length(4)
      .refine((choices) => new Set(choices.map((choice) => choice.id)).size === 4 && new Set(choices.map((choice) => choice.key)).size === 4),
  }),
});
export const answerSchema = z.strictObject({
  presentationId: z.uuid(), selectedChoiceId: z.uuid(), correctChoiceId: z.uuid(), isCorrect: z.boolean(),
  explanationThai: translation, explanationEnglish: translation, explanationRussian: translation,
  trapExplanationThai: translation, trapExplanationEnglish: translation, trapExplanationRussian: translation,
});
export type Presentation = z.infer<typeof presentationSchema>;
export type Answer = z.infer<typeof answerSchema>;
