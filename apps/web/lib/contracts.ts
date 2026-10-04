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

export const reminderPreferenceSchema = z.strictObject({
  dailyQuestionReminderEnabled: z.boolean(),
});
export type ReminderPreference = z.infer<typeof reminderPreferenceSchema>;

const text = z.string().refine((value) => value.trim().length > 0);
const translation = z.string().nullable();
export const presentedQuestionSchema = z.strictObject({
  id: z.uuid(), textThai: translation, textExamEnglish: translation, textEnglish: text, textRussian: translation,
  choices: z.array(z.strictObject({ id: z.uuid(), key: z.enum(['A', 'B', 'C', 'D']), textThai: translation, textEnglish: text, textRussian: translation })).length(4)
    .refine((choices) => new Set(choices.map((choice) => choice.id)).size === 4 && new Set(choices.map((choice) => choice.key)).size === 4),
});
export const presentationSchema = z.strictObject({ presentationId: z.uuid(), question: presentedQuestionSchema });
const dailyPracticeDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString() === `${value}T00:00:00.000Z`;
});
export const dailyPracticeResponseSchema = z.strictObject({
  day: dailyPracticeDaySchema,
  presentationId: z.uuid().refine((value) => value === value.toLowerCase()),
  answered: z.boolean(),
  question: presentedQuestionSchema,
}).superRefine(({ question }, context) => {
  if (question.id !== question.id.toLowerCase()) context.addIssue({ code: 'custom', path: ['question', 'id'], message: 'Question ID must be canonical' });
  if (question.choices.some(({ id }) => id !== id.toLowerCase())) context.addIssue({ code: 'custom', path: ['question', 'choices'], message: 'Choice IDs must be canonical' });
});
export const retryMistakeErrorSchema = z.strictObject({
  error: z.enum([
    'Unauthorized',
    'Vehicle selection required',
    'Mistake not found',
    'Mistake has no concept',
    'No questions available',
    'Internal Server Error',
  ]),
});
export const answerSchema = z.strictObject({
  presentationId: z.uuid(), selectedChoiceId: z.uuid(), correctChoiceId: z.uuid(), isCorrect: z.boolean(),
  explanationThai: translation, explanationEnglish: translation, explanationRussian: translation,
  trapExplanationThai: translation, trapExplanationEnglish: translation, trapExplanationRussian: translation,
});
export type Presentation = z.infer<typeof presentationSchema>;
export type DailyPractice = z.infer<typeof dailyPracticeResponseSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type PresentedQuestion = z.infer<typeof presentedQuestionSchema>;

export function consumePracticeHandoff(current: Presentation | null, consumedPresentationId: string) {
  return current?.presentationId === consumedPresentationId ? null : current;
}

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
const canonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase());
const reportDetailsSchema = z.string().superRefine((value, context) => {
  const scalarLength = [...value].length;
  if (scalarLength < 3 || scalarLength > 1000) context.addIssue({ code: 'custom', message: 'Details must contain 3–1000 Unicode characters' });
  if (value !== value.trim()) context.addIssue({ code: 'custom', message: 'Details must already be trimmed' });
  if (new TextEncoder().encode(value).byteLength > 4000) context.addIssue({ code: 'custom', message: 'Details exceed the UTF-8 byte limit' });
  if (/[\uD800-\uDFFF]/u.test(value)) context.addIssue({ code: 'custom', message: 'Details contain an unpaired surrogate' });
  if ([...value].some((character) => character !== '\n' && /\p{Cc}/u.test(character))) context.addIssue({ code: 'custom', message: 'Details contain a disallowed control character' });
});
export const practiceReportRequestSchema = z.strictObject({
  presentationId: canonicalUuidSchema,
  details: reportDetailsSchema,
});
export const practiceReportResponseSchema = z.strictObject({
  reportId: canonicalUuidSchema,
  presentationId: canonicalUuidSchema,
  createdAt: canonicalTimestampSchema,
});
export const examQuestionReportRequestSchema = z.strictObject({
  examQuestionId: canonicalUuidSchema,
  details: reportDetailsSchema,
});
export const examQuestionReportResponseSchema = z.strictObject({
  reportId: canonicalUuidSchema,
  examQuestionId: canonicalUuidSchema,
  createdAt: canonicalTimestampSchema,
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

const conceptProgressCursorPayloadSchema = z.strictObject({
  v: z.literal(1), lastActivityAt: canonicalTimestampSchema, conceptId: canonicalUuidSchema,
});
export const conceptProgressCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u).refine((value) => {
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding), (character) => character.charCodeAt(0)),
    );
    const cursor = conceptProgressCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
    return btoa(JSON.stringify(cursor)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '') === value;
  } catch { return false; }
});

function decodeConceptProgressCursor(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding), (character) => character.charCodeAt(0)),
  );
  return conceptProgressCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
}

const conceptProgressCountSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
const conceptProgressChannelSchema = z.strictObject({
  answered: conceptProgressCountSchema,
  correct: conceptProgressCountSchema,
  incorrect: conceptProgressCountSchema,
  lastAnsweredAt: canonicalTimestampSchema.nullable(),
}).superRefine((channel, context) => {
  const answered = channel.correct + channel.incorrect;
  if (!Number.isSafeInteger(answered) || answered !== channel.answered) context.addIssue({ code: 'custom', message: 'Channel counts are inconsistent' });
  if ((channel.answered === 0) !== (channel.lastAnsweredAt === null)) context.addIssue({ code: 'custom', message: 'Channel timestamp is inconsistent' });
});
const masteryStatusSchema = z.enum(['NOT_STARTED', 'LEARNING', 'MASTERED']);
const conceptLabelSchema = z.string().min(1).refine((value) => value === value.trim());
const conceptProgressItemSchema = z.strictObject({
  conceptId: canonicalUuidSchema,
  slug: conceptLabelSchema,
  nameThai: conceptLabelSchema,
  nameEnglish: conceptLabelSchema,
  nameRussian: conceptLabelSchema,
  practice: conceptProgressChannelSchema,
  exam: conceptProgressChannelSchema,
  total: z.strictObject({
    answered: conceptProgressCountSchema,
    correct: conceptProgressCountSchema,
    incorrect: conceptProgressCountSchema,
    accuracyPercent: z.number().int().min(0).max(100).nullable(),
  }),
  masteryStatus: masteryStatusSchema,
  lastActivityAt: canonicalTimestampSchema,
}).superRefine((item, context) => {
  const answered = item.practice.answered + item.exam.answered;
  const correct = item.practice.correct + item.exam.correct;
  const incorrect = item.practice.incorrect + item.exam.incorrect;
  if (!Number.isSafeInteger(answered) || !Number.isSafeInteger(correct) || !Number.isSafeInteger(incorrect)
    || item.total.answered !== answered || item.total.correct !== correct || item.total.incorrect !== incorrect) {
    context.addIssue({ code: 'custom', path: ['total'], message: 'Total counts are inconsistent' });
  }
  const accuracy = answered === 0 ? null : Math.round((correct / answered) * 100);
  if (item.total.accuracyPercent !== accuracy) context.addIssue({ code: 'custom', path: ['total', 'accuracyPercent'], message: 'Accuracy is inconsistent' });
  const mastery = answered === 0 ? 'NOT_STARTED'
    : answered >= 5 && BigInt(correct) * 100n >= BigInt(answered) * 80n ? 'MASTERED' : 'LEARNING';
  if (item.masteryStatus !== mastery) context.addIssue({ code: 'custom', path: ['masteryStatus'], message: 'Mastery is inconsistent' });
  const activity = [item.practice.lastAnsweredAt, item.exam.lastAnsweredAt].filter((value): value is string => value !== null).sort().at(-1);
  if (activity === undefined || activity !== item.lastActivityAt) context.addIssue({ code: 'custom', path: ['lastActivityAt'], message: 'Latest activity is inconsistent' });
});

export const conceptProgressResponseSchema = z.strictObject({
  items: z.array(conceptProgressItemSchema).max(50),
  nextCursor: conceptProgressCursorSchema.nullable(),
}).superRefine((page, context) => {
  if (page.items.some((item, index, items) => index > 0 && (
    item.lastActivityAt > items[index - 1]!.lastActivityAt
    || (item.lastActivityAt === items[index - 1]!.lastActivityAt && item.conceptId >= items[index - 1]!.conceptId)
  ))) context.addIssue({ code: 'custom', path: ['items'], message: 'Concept progress order is invalid' });
  if (new Set(page.items.map(({ conceptId }) => conceptId)).size !== page.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Concept IDs must be unique' });
  if (page.nextCursor !== null) {
    const last = page.items.at(-1);
    if (!last) context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'Empty concept progress cannot continue' });
    else {
      const cursor = decodeConceptProgressCursor(page.nextCursor);
      if (cursor.lastActivityAt !== last.lastActivityAt || cursor.conceptId !== last.conceptId) context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'Cursor does not match the last item' });
    }
  }
});

export type ConceptProgressItem = z.infer<typeof conceptProgressItemSchema>;
export type ConceptProgressPage = z.infer<typeof conceptProgressResponseSchema>;

export function appendConceptProgressPage(existing: readonly ConceptProgressItem[], page: ConceptProgressPage): ConceptProgressItem[] {
  const parsedExisting = z.array(conceptProgressItemSchema).parse(existing);
  const parsedPage = conceptProgressResponseSchema.parse(page);
  const existingIds = new Set(parsedExisting.map(({ conceptId }) => conceptId));
  if (parsedPage.items.some(({ conceptId }) => existingIds.has(conceptId))) throw new Error('Concept progress repeats an item');
  const previous = parsedExisting.at(-1);
  const first = parsedPage.items[0];
  if (previous && first && (first.lastActivityAt > previous.lastActivityAt
    || (first.lastActivityAt === previous.lastActivityAt && first.conceptId >= previous.conceptId))) {
    throw new Error('Concept progress pages are out of order');
  }
  return [...parsedExisting, ...parsedPage.items];
}

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

const examHistoryCursorPayloadSchema = z.strictObject({
  v: z.literal(1), startedAt: canonicalTimestampSchema, examId: canonicalUuidSchema,
});
export const examHistoryCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u).refine((value) => {
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding), (character) => character.charCodeAt(0)),
    );
    const cursor = examHistoryCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
    return btoa(JSON.stringify(cursor)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '') === value;
  } catch { return false; }
});

function decodeExamHistoryCursor(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding), (character) => character.charCodeAt(0)),
  );
  return examHistoryCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
}

const examHistoryItemSchema = z.strictObject({
  examId: canonicalUuidSchema,
  vehicleType: vehicleSchema,
  questionCount: z.literal(50),
  answeredCount: examCountSchema,
  unansweredCount: examCountSchema,
  score: examCountSchema,
  passingScore: z.literal(45),
  passed: z.boolean(),
  startedAt: canonicalTimestampSchema,
  completedAt: canonicalTimestampSchema,
}).superRefine((item, context) => {
  if (item.answeredCount + item.unansweredCount !== 50) context.addIssue({ code: 'custom', path: ['unansweredCount'], message: 'Answer counts must total 50' });
  if (item.score > item.answeredCount) context.addIssue({ code: 'custom', path: ['score'], message: 'Score cannot exceed answered count' });
  if (item.passed !== (item.score >= 45)) context.addIssue({ code: 'custom', path: ['passed'], message: 'Pass result is inconsistent' });
  if (Date.parse(item.completedAt) < Date.parse(item.startedAt)) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Completion precedes start' });
});

export const examHistoryResponseSchema = z.strictObject({
  items: z.array(examHistoryItemSchema).max(50),
  nextCursor: examHistoryCursorSchema.nullable(),
}).superRefine((page, context) => {
  if (page.items.some((item, index, items) => index > 0 && (
    item.startedAt > items[index - 1]!.startedAt
    || (item.startedAt === items[index - 1]!.startedAt && item.examId >= items[index - 1]!.examId)
  ))) context.addIssue({ code: 'custom', path: ['items'], message: 'History order is invalid' });
  if (new Set(page.items.map(({ examId }) => examId)).size !== page.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Exam IDs must be unique' });
  if (page.nextCursor !== null) {
    const last = page.items.at(-1);
    if (!last) context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'Empty history cannot continue' });
    else {
      const cursor = decodeExamHistoryCursor(page.nextCursor);
      if (cursor.startedAt !== last.startedAt || cursor.examId !== last.examId) context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'Cursor does not match the last item' });
    }
  }
});

const examReviewMistakeSchema = z.strictObject({
  examQuestionId: canonicalUuidSchema,
  position: z.number().int().min(1).max(50),
  selectedChoiceId: canonicalUuidSchema.nullable(),
  answeredAt: canonicalTimestampSchema.nullable(),
  correctChoiceId: canonicalUuidSchema,
  question: examQuestionSchema,
  explanationThai: translation,
  explanationEnglish: translation,
  explanationRussian: translation,
  trapExplanationThai: translation,
  trapExplanationEnglish: translation,
  trapExplanationRussian: translation,
}).superRefine((mistake, context) => {
  if ((mistake.selectedChoiceId === null) !== (mistake.answeredAt === null)) context.addIssue({ code: 'custom', path: ['answeredAt'], message: 'Answer fields must be paired' });
  if (!mistake.question.choices.some(({ id }) => id === mistake.correctChoiceId)) context.addIssue({ code: 'custom', path: ['correctChoiceId'], message: 'Correct choice is absent' });
  if (mistake.selectedChoiceId !== null && (
    mistake.selectedChoiceId === mistake.correctChoiceId
    || !mistake.question.choices.some(({ id }) => id === mistake.selectedChoiceId)
  )) context.addIssue({ code: 'custom', path: ['selectedChoiceId'], message: 'Selected choice must be an incorrect presented choice' });
});

export const examReviewResponseSchema = z.strictObject({
  examId: canonicalUuidSchema,
  questionCount: z.literal(50),
  score: examCountSchema,
  passingScore: z.literal(45),
  passed: z.boolean(),
  completedAt: canonicalTimestampSchema,
  mistakes: z.array(examReviewMistakeSchema).max(50),
}).superRefine((review, context) => {
  if (review.passed !== (review.score >= 45)) context.addIssue({ code: 'custom', path: ['passed'], message: 'Pass result is inconsistent' });
  if (review.mistakes.length !== 50 - review.score) context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Mistake count is inconsistent' });
  if (review.mistakes.some((mistake, index, mistakes) => index > 0 && mistake.position <= mistakes[index - 1]!.position)) context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Mistake positions must increase' });
  if (new Set(review.mistakes.map(({ examQuestionId }) => examQuestionId)).size !== review.mistakes.length) context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Exam question IDs must be unique' });
  if (new Set(review.mistakes.map(({ question }) => question.id)).size !== review.mistakes.length) context.addIssue({ code: 'custom', path: ['mistakes'], message: 'Source question IDs must be unique' });
});

export type ExamStart = z.infer<typeof examStartResponseSchema>;
export type CurrentExam = z.infer<typeof currentExamResponseSchema>;
export type ExamAnswerAcknowledgement = z.infer<typeof examAnswerResponseSchema>;
export type ExamCompletion = z.infer<typeof examCompletionResponseSchema>;
export type ExamHistoryItem = z.infer<typeof examHistoryItemSchema>;
export type ExamReview = z.infer<typeof examReviewResponseSchema>;
