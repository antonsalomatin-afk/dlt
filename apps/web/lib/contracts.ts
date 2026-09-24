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
export const presentedQuestionSchema = z.strictObject({
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
export type PresentedQuestion = z.infer<typeof presentedQuestionSchema>;

export const favoriteResponseSchema = z.strictObject({
  presentationId: z.uuid(), favorite: z.boolean(),
});

const trimmedNonblankString = z.string().min(1).refine((value) => value === value.trim());
const practiceCategorySchema = z.strictObject({
  id: z.uuid(),
  slug: trimmedNonblankString,
  nameThai: trimmedNonblankString,
  nameEnglish: trimmedNonblankString,
  nameRussian: trimmedNonblankString,
  questionCount: z.number().int().positive(),
});
export const practiceCategoriesSchema = z.strictObject({
  categories: z.array(practiceCategorySchema).max(100),
}).superRefine(({ categories }, context) => {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  categories.forEach((category, index) => {
    const canonicalId = category.id.toLowerCase();
    if (ids.has(canonicalId)) context.addIssue({ code: 'custom', path: ['categories', index, 'id'], message: 'Duplicate category ID' });
    if (slugs.has(category.slug)) context.addIssue({ code: 'custom', path: ['categories', index, 'slug'], message: 'Duplicate category slug' });
    ids.add(canonicalId);
    slugs.add(category.slug);
  });
});
export type PracticeCategory = z.infer<typeof practiceCategorySchema>;

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
export const mistakesResponseSchema = historyResponseSchema.superRefine((page, context) => {
  page.items.forEach((item, index) => {
    if (item.isCorrect || item.selectedChoiceId === item.correctChoiceId) {
      context.addIssue({ code: 'custom', path: ['items', index], message: 'Mistakes must contain only incorrect attempts' });
    }
  });
});
export type HistoryItem = z.infer<typeof historyItemSchema>;

const favoriteCursorPayloadSchema = z.strictObject({
  v: z.literal(1), updatedAt: canonicalTimestampSchema, favoriteId: z.uuid(),
});
const favoriteCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u).refine((value) => {
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding), (character) => character.charCodeAt(0)),
    );
    const cursor = favoriteCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
    return btoa(JSON.stringify(cursor)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '') === value;
  } catch { return false; }
});
const favoriteItemSchema = z.strictObject({
  presentationId: z.uuid(), favoritedAt: canonicalTimestampSchema, question: presentedQuestionSchema,
});
export const favoritesResponseSchema = z.strictObject({
  items: z.array(favoriteItemSchema).max(50), nextCursor: favoriteCursorSchema.nullable(),
}).superRefine(({ items }, context) => {
  const presentationIds = new Set<string>();
  const questionIds = new Set<string>();
  items.forEach((item, index) => {
    const presentationId = item.presentationId.toLowerCase();
    const questionId = item.question.id.toLowerCase();
    if (presentationIds.has(presentationId)) context.addIssue({ code: 'custom', path: ['items', index, 'presentationId'], message: 'Duplicate presentation ID' });
    if (questionIds.has(questionId)) context.addIssue({ code: 'custom', path: ['items', index, 'question', 'id'], message: 'Duplicate question ID' });
    presentationIds.add(presentationId);
    questionIds.add(questionId);
  });
});
export type FavoriteItem = z.infer<typeof favoriteItemSchema>;

const progressCountSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
export const progressResponseSchema = z.strictObject({
  answered: progressCountSchema,
  correct: progressCountSchema,
  incorrect: progressCountSchema,
  accuracyPercent: z.number().int().min(0).max(100).nullable(),
}).superRefine((progress, context) => {
  const answered = progress.correct + progress.incorrect;
  if (!Number.isSafeInteger(answered) || progress.answered !== answered) {
    context.addIssue({ code: 'custom', message: 'Progress counts are inconsistent' });
  }
  const expectedAccuracy = progress.answered === 0
    ? null
    : Math.round((progress.correct / progress.answered) * 100);
  if (progress.accuracyPercent !== expectedAccuracy) {
    context.addIssue({ code: 'custom', message: 'Progress accuracy is inconsistent' });
  }
});
export type ProgressSummary = z.infer<typeof progressResponseSchema>;

const canonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase());
const examCountSchema = z.number().int().min(0).max(50);
const examQuestionSchema = presentedQuestionSchema.superRefine((question, context) => {
  if (question.id !== question.id.toLowerCase()) context.addIssue({ code: 'custom', path: ['id'], message: 'Question ID must be canonical' });
  if (question.choices.some(({ id }) => id !== id.toLowerCase())) context.addIssue({ code: 'custom', path: ['choices'], message: 'Choice IDs must be canonical' });
});
const examStartQuestionSchema = z.strictObject({
  examQuestionId: canonicalUuidSchema,
  position: z.number().int().min(1).max(50),
  question: examQuestionSchema,
});
const currentExamQuestionSchema = examStartQuestionSchema.extend({
  selectedChoiceId: canonicalUuidSchema.nullable(),
  answeredAt: canonicalTimestampSchema.nullable(),
}).superRefine((item, context) => {
  if ((item.selectedChoiceId === null) !== (item.answeredAt === null)) context.addIssue({ code: 'custom', path: ['answeredAt'], message: 'Answer fields must be paired' });
  if (item.selectedChoiceId !== null && !item.question.choices.some(({ id }) => id === item.selectedChoiceId)) context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Selected choice is absent' });
});

function validateExamQuestions(
  questions: readonly { examQuestionId: string; position: number; question: { id: string } }[],
  context: z.RefinementCtx,
) {
  if (questions.some((question, index) => question.position !== index + 1)) context.addIssue({ code: 'custom', path: ['questions'], message: 'Positions must be consecutive' });
  if (new Set(questions.map(({ examQuestionId }) => examQuestionId)).size !== 50) context.addIssue({ code: 'custom', path: ['questions'], message: 'Exam question IDs must be unique' });
  if (new Set(questions.map(({ question }) => question.id)).size !== 50) context.addIssue({ code: 'custom', path: ['questions'], message: 'Source question IDs must be unique' });
}

export const examStartResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  vehicleType: vehicleSchema,
  questionCount: z.literal(50),
  passingScore: z.literal(45),
  startedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
  questions: z.array(examStartQuestionSchema).length(50),
}).superRefine((exam, context) => {
  if (Date.parse(exam.expiresAt) - Date.parse(exam.startedAt) !== 60 * 60 * 1000) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration must be 60 minutes' });
  validateExamQuestions(exam.questions, context);
});

export const currentExamResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  vehicleType: vehicleSchema,
  questionCount: z.literal(50),
  passingScore: z.literal(45),
  startedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
  serverTime: canonicalTimestampSchema,
  expired: z.boolean(),
  answeredCount: examCountSchema,
  remainingCount: examCountSchema,
  questions: z.array(currentExamQuestionSchema).length(50),
}).superRefine((exam, context) => {
  const startedAt = Date.parse(exam.startedAt);
  const expiresAt = Date.parse(exam.expiresAt);
  const serverTime = Date.parse(exam.serverTime);
  if (expiresAt - startedAt !== 60 * 60 * 1000) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration must be 60 minutes' });
  if (serverTime < startedAt) context.addIssue({ code: 'custom', path: ['serverTime'], message: 'Server time precedes the exam' });
  if (exam.expired !== (serverTime >= expiresAt)) context.addIssue({ code: 'custom', path: ['expired'], message: 'Expiry is inconsistent' });
  if (exam.answeredCount + exam.remainingCount !== 50) context.addIssue({ code: 'custom', path: ['remainingCount'], message: 'Progress must total 50' });
  if (exam.questions.filter(({ selectedChoiceId }) => selectedChoiceId !== null).length !== exam.answeredCount) context.addIssue({ code: 'custom', path: ['answeredCount'], message: 'Answered count is inconsistent' });
  exam.questions.forEach((question, index) => {
    if (question.answeredAt !== null && (Date.parse(question.answeredAt) < startedAt || Date.parse(question.answeredAt) >= expiresAt)) context.addIssue({ code: 'custom', path: ['questions', index, 'answeredAt'], message: 'Answer time is outside the exam' });
  });
  validateExamQuestions(exam.questions, context);
});

export const examAnswerResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  examQuestionId: canonicalUuidSchema,
  selectedChoiceId: canonicalUuidSchema,
  answeredAt: canonicalTimestampSchema,
  answeredCount: z.number().int().min(1).max(50),
  remainingCount: z.number().int().min(0).max(49),
}).refine(({ answeredCount, remainingCount }) => answeredCount + remainingCount === 50, { path: ['remainingCount'], message: 'Progress must total 50' });

export const examCompletionResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  questionCount: z.literal(50),
  answeredCount: examCountSchema,
  unansweredCount: examCountSchema,
  score: examCountSchema,
  passingScore: z.literal(45),
  passed: z.boolean(),
  completedAt: canonicalTimestampSchema,
}).superRefine((result, context) => {
  if (result.answeredCount + result.unansweredCount !== 50) context.addIssue({ code: 'custom', path: ['unansweredCount'], message: 'Completion counts must total 50' });
  if (result.score > result.answeredCount) context.addIssue({ code: 'custom', path: ['score'], message: 'Score cannot exceed answered count' });
  if (result.passed !== (result.score >= 45)) context.addIssue({ code: 'custom', path: ['passed'], message: 'Pass result is inconsistent' });
});

export type ExamStart = z.infer<typeof examStartResponseSchema>;
export type CurrentExam = z.infer<typeof currentExamResponseSchema>;
export type ExamAnswerAcknowledgement = z.infer<typeof examAnswerResponseSchema>;
export type ExamCompletion = z.infer<typeof examCompletionResponseSchema>;
