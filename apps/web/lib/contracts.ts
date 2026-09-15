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
const presentedQuestionSchema = z.strictObject({
  id: z.uuid(), textThai: translation, textExamEnglish: translation, textEnglish: text, textRussian: translation,
  choices: z.array(z.strictObject({ id: z.uuid(), key: z.enum(['A', 'B', 'C', 'D']), textThai: translation, textEnglish: text, textRussian: translation })).length(4)
    .refine((choices) => new Set(choices.map((choice) => choice.id)).size === 4 && new Set(choices.map((choice) => choice.key)).size === 4),
});
export const presentationSchema = z.strictObject({ presentationId: z.uuid(), question: presentedQuestionSchema });
export const answerSchema = z.strictObject({
  presentationId: z.uuid(), selectedChoiceId: z.uuid(), correctChoiceId: z.uuid(), isCorrect: z.boolean(),
  explanationThai: translation, explanationEnglish: translation, explanationRussian: translation,
  trapExplanationThai: translation, trapExplanationEnglish: translation, trapExplanationRussian: translation,
});
export type Presentation = z.infer<typeof presentationSchema>;
export type Answer = z.infer<typeof answerSchema>;

const canonicalTimestampSchema = z.iso.datetime().refine((value) => {
  try { return new Date(value).toISOString() === value; }
  catch { return false; }
});
const historyCursorPayloadSchema = z.strictObject({
  v: z.literal(1), submittedAt: canonicalTimestampSchema, attemptId: z.uuid(),
});
const historyCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u).refine((value) => {
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding), (character) => character.charCodeAt(0)),
    );
    const cursor = historyCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
    return btoa(JSON.stringify(cursor)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '') === value;
  } catch { return false; }
});
const historyItemSchema = z.strictObject({
  presentationId: z.uuid(), submittedAt: canonicalTimestampSchema,
  selectedChoiceId: z.uuid(), correctChoiceId: z.uuid(), isCorrect: z.boolean(),
  question: presentedQuestionSchema,
  explanationThai: translation, explanationEnglish: translation, explanationRussian: translation,
  trapExplanationThai: translation, trapExplanationEnglish: translation, trapExplanationRussian: translation,
}).superRefine((item, context) => {
  if (!item.question.choices.some((choice) => choice.id === item.selectedChoiceId)) {
    context.addIssue({ code: 'custom', message: 'Selected choice is absent from snapshot' });
  }
  if (!item.question.choices.some((choice) => choice.id === item.correctChoiceId)) {
    context.addIssue({ code: 'custom', message: 'Correct choice is absent from snapshot' });
  }
  if (item.isCorrect !== (item.selectedChoiceId === item.correctChoiceId)) {
    context.addIssue({ code: 'custom', message: 'History correctness is inconsistent' });
  }
});
export const historyResponseSchema = z.strictObject({
  items: z.array(historyItemSchema).max(50), nextCursor: historyCursorSchema.nullable(),
});
export type HistoryItem = z.infer<typeof historyItemSchema>;
