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

export const EXAM_QUESTION_COUNT = 50;
export const EXAM_PASSING_SCORE = 45;
export const EXAM_DURATION_MS = 60 * 60 * 1000;
const examCountSchema = z.number().int().min(0).max(EXAM_QUESTION_COUNT);
export const examStartSchema = z.strictObject({
  examId: z.uuid(),
  vehicleType: vehicleSchema,
  questionCount: z.literal(EXAM_QUESTION_COUNT),
  passingScore: z.literal(EXAM_PASSING_SCORE),
  startedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
  questions: z.array(z.strictObject({
    examQuestionId: z.uuid(), position: z.number().int().min(1).max(EXAM_QUESTION_COUNT), question: presentedQuestionSchema,
  })).length(EXAM_QUESTION_COUNT),
}).superRefine((exam, context) => {
  if (Date.parse(exam.expiresAt) - Date.parse(exam.startedAt) !== EXAM_DURATION_MS) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration is invalid' });
  }
  if (exam.questions.some((item, index) => item.position !== index + 1)) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Exam positions must be consecutive' });
  }
  if (new Set(exam.questions.map((item) => item.examQuestionId.toLowerCase())).size !== EXAM_QUESTION_COUNT) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Exam question IDs must be unique' });
  }
  if (new Set(exam.questions.map((item) => item.question.id.toLowerCase())).size !== EXAM_QUESTION_COUNT) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Source question IDs must be unique' });
  }
});
export const examAnswerSchema = z.strictObject({
  examId: z.uuid(), examQuestionId: z.uuid(), selectedChoiceId: z.uuid(), answeredAt: canonicalTimestampSchema,
  answeredCount: examCountSchema.min(1), remainingCount: examCountSchema.max(EXAM_QUESTION_COUNT - 1),
}).refine((answer) => answer.answeredCount + answer.remainingCount === EXAM_QUESTION_COUNT, { path: ['remainingCount'], message: 'Exam answer counts must total 50' });
export const examCompleteSchema = z.strictObject({
  examId: z.uuid(), questionCount: z.literal(EXAM_QUESTION_COUNT), answeredCount: examCountSchema, unansweredCount: examCountSchema,
  score: examCountSchema, passingScore: z.literal(EXAM_PASSING_SCORE), passed: z.boolean(), completedAt: canonicalTimestampSchema,
}).superRefine((result, context) => {
  if (result.answeredCount + result.unansweredCount !== EXAM_QUESTION_COUNT) {
    context.addIssue({ code: 'custom', path: ['unansweredCount'], message: 'Exam completion counts must total 50' });
  }
  if (result.score > result.answeredCount) context.addIssue({ code: 'custom', path: ['score'], message: 'Exam score cannot exceed answered count' });
  if (result.passed !== (result.score >= result.passingScore)) context.addIssue({ code: 'custom', path: ['passed'], message: 'Exam pass result is inconsistent' });
});
export type ExamStart = z.infer<typeof examStartSchema>;
export type ExamAnswer = z.infer<typeof examAnswerSchema>;
export type ExamComplete = z.infer<typeof examCompleteSchema>;

const examHistoryCursorPayloadSchema = z.strictObject({ v: z.literal(1), startedAt: canonicalTimestampSchema, examId: z.uuid() });
const examHistoryCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u).refine((value) => {
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding), (character) => character.charCodeAt(0)),
    );
    const cursor = examHistoryCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
    return btoa(JSON.stringify(cursor)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '') === value;
  } catch { return false; }
});
const examHistoryItemSchema = z.strictObject({
  examId: z.uuid(), vehicleType: vehicleSchema, status: z.enum(['IN_PROGRESS', 'EXPIRED', 'COMPLETED']),
  questionCount: z.literal(EXAM_QUESTION_COUNT), passingScore: z.literal(EXAM_PASSING_SCORE), answeredCount: examCountSchema,
  startedAt: canonicalTimestampSchema, expiresAt: canonicalTimestampSchema, completedAt: canonicalTimestampSchema.nullable(),
  score: examCountSchema.nullable(), passed: z.boolean().nullable(),
}).superRefine((item, context) => {
  if (Date.parse(item.expiresAt) - Date.parse(item.startedAt) !== EXAM_DURATION_MS) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration is invalid' });
  const completed = item.status === 'COMPLETED';
  if ((item.completedAt !== null) !== completed || (item.score !== null) !== completed || (item.passed !== null) !== completed) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Exam completion tuple must match status' });
  }
  if (item.score !== null && item.score > item.answeredCount) context.addIssue({ code: 'custom', path: ['score'], message: 'Exam score cannot exceed answered count' });
  if (item.score !== null && item.passed !== (item.score >= item.passingScore)) context.addIssue({ code: 'custom', path: ['passed'], message: 'Exam pass result is inconsistent' });
});
export const examHistoryResponseSchema = z.strictObject({
  items: z.array(examHistoryItemSchema).max(50), nextCursor: examHistoryCursorSchema.nullable(),
}).superRefine(({ items }, context) => {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    const id = item.examId.toLowerCase();
    if (ids.has(id)) context.addIssue({ code: 'custom', path: ['items', index, 'examId'], message: 'Duplicate exam ID' });
    ids.add(id);
  });
});
export type ExamHistoryItem = z.infer<typeof examHistoryItemSchema>;

const examResultQuestionSchema = z.strictObject({
  examQuestionId: z.uuid(), position: z.number().int().min(1).max(EXAM_QUESTION_COUNT), question: presentedQuestionSchema,
  selectedChoiceId: z.uuid().nullable(), correctChoiceId: z.uuid(), isCorrect: z.boolean().nullable(), answeredAt: canonicalTimestampSchema.nullable(),
  explanationThai: translation, explanationEnglish: translation, explanationRussian: translation,
  trapExplanationThai: translation, trapExplanationEnglish: translation, trapExplanationRussian: translation,
}).superRefine((row, context) => {
  if (!row.question.choices.some((choice) => choice.id === row.correctChoiceId)) context.addIssue({ code: 'custom', path: ['correctChoiceId'], message: 'Correct choice is absent from snapshot' });
  const nullCount = [row.selectedChoiceId, row.isCorrect, row.answeredAt].filter((value) => value === null).length;
  if (nullCount !== 0 && nullCount !== 3) context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Exam answer tuple must be all null or all present' });
  if (row.selectedChoiceId !== null) {
    if (!row.question.choices.some((choice) => choice.id === row.selectedChoiceId)) context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Selected choice is absent from snapshot' });
    if (row.isCorrect !== (row.selectedChoiceId === row.correctChoiceId)) context.addIssue({ code: 'custom', path: ['isCorrect'], message: 'Exam correctness is inconsistent' });
  }
});
export const examResultSchema = z.strictObject({
  examId: z.uuid(), vehicleType: vehicleSchema, questionCount: z.literal(EXAM_QUESTION_COUNT), answeredCount: examCountSchema, unansweredCount: examCountSchema,
  score: examCountSchema, passingScore: z.literal(EXAM_PASSING_SCORE), passed: z.boolean(),
  startedAt: canonicalTimestampSchema, expiresAt: canonicalTimestampSchema, completedAt: canonicalTimestampSchema,
  questions: z.array(examResultQuestionSchema).length(EXAM_QUESTION_COUNT),
}).superRefine((result, context) => {
  if (Date.parse(result.expiresAt) - Date.parse(result.startedAt) !== EXAM_DURATION_MS) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Exam duration is invalid' });
  if (result.questions.some((row, index) => row.position !== index + 1)) context.addIssue({ code: 'custom', path: ['questions'], message: 'Exam positions must be consecutive' });
  if (new Set(result.questions.map((row) => row.examQuestionId.toLowerCase())).size !== EXAM_QUESTION_COUNT) context.addIssue({ code: 'custom', path: ['questions'], message: 'Exam question IDs must be unique' });
  const answeredCount = result.questions.filter((row) => row.selectedChoiceId !== null).length;
  const score = result.questions.filter((row) => row.isCorrect === true).length;
  if (result.answeredCount !== answeredCount || result.unansweredCount !== EXAM_QUESTION_COUNT - answeredCount) context.addIssue({ code: 'custom', path: ['answeredCount'], message: 'Exam counts must match the reviewed rows' });
  if (result.score !== score) context.addIssue({ code: 'custom', path: ['score'], message: 'Exam score must match the reviewed rows' });
  if (result.passed !== (result.score >= result.passingScore)) context.addIssue({ code: 'custom', path: ['passed'], message: 'Exam pass result is inconsistent' });
});
export type ExamResult = z.infer<typeof examResultSchema>;
