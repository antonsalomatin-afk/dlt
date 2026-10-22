import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from './index.ts';
import { isRetryableDailyPracticeConflict, retryDailyPractice } from './daily-practice.ts';
import { parsePresentationSnapshot, selectPracticeQuestion } from './presentation.ts';
import { practiceAnswerResponse, submitPracticeAnswer } from './answer.ts';

export const CHAT_QUIZ_LEASE_MS = 60_000;
/** Safe sentinel: polling must fail before its next offset acknowledgement. */
export class UnclaimedQuizAnswerError extends Error {
  constructor() { super('Native quiz answer could not be durably claimed.'); this.name = 'UnclaimedQuizAnswerError'; }
}
export const telegramLearnerSchema = z.object({ id: z.number().int().positive().max(2 ** 52 - 1).refine(Number.isSafeInteger), is_bot: z.literal(false), first_name: z.string().min(1).max(256), username: z.string().min(1).max(64).optional() });
const uuid = z.uuid();
const pollIdSchema = z.string().min(1).max(256);
export const chatQuizActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start') }),
  z.strictObject({ kind: z.literal('vehicle'), vehicle: z.enum(['CAR', 'MOTORCYCLE']) }),
  z.strictObject({ kind: z.literal('next'), presentationId: uuid }),
  z.strictObject({ kind: z.literal('replace'), presentationId: uuid }),
]);
const include = { presentation: { include: { answer: true, question: { select: { active: true, verificationStatus: true } } } } } as const;
export type ChatQuiz = Prisma.ChatQuizSessionGetPayload<{ include: typeof include }>;

const nonblank = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim().length > 0;
export function quizLanguage(snapshotInput: unknown, preferred: 'ENGLISH' | 'RUSSIAN' | 'THAI'): ChatQuiz['language'] {
  const snapshot = parsePresentationSnapshot(snapshotInput);
  const question = snapshot.question;
  const complete = preferred === 'RUSSIAN'
    ? [question.textRussian, ...question.choices.map(({ textRussian }) => textRussian), snapshot.explanationRussian, ...(snapshot.trapExplanationEnglish ? [snapshot.trapExplanationRussian] : [])]
    : [question.textThai, ...question.choices.map(({ textThai }) => textThai), snapshot.explanationThai, ...(snapshot.trapExplanationEnglish ? [snapshot.trapExplanationThai] : [])];
  return preferred !== 'ENGLISH' && complete.every(nonblank) ? preferred : 'ENGLISH';
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`);
  if (rows.length !== 1) throw new Error('Chat learner lock is inconsistent');
}

/** Serialize each learner's transitions; network calls always happen after this commits. */
export async function requestChatQuiz(database: PrismaClient, learnerInput: unknown, actionInput: unknown, now = new Date(), randomOffset: (count: number) => unknown = randomInt) {
  const learner = telegramLearnerSchema.parse(learnerInput);
  const action = chatQuizActionSchema.parse(actionInput);
  return retryDailyPractice(() => database.$transaction(async (tx) => {
    const user = await tx.user.upsert({ where: { telegramUserId: BigInt(learner.id) },
      create: { telegramUserId: BigInt(learner.id), firstName: learner.first_name, ...(learner.username ? { username: learner.username } : {}), lastSeenAt: now },
      update: { firstName: learner.first_name, ...(learner.username ? { username: learner.username } : {}), lastSeenAt: now },
    });
    await lockUser(tx, user.id);
    if (action.kind === 'vehicle' && user.selectedVehicleType === null) {
      user.selectedVehicleType = action.vehicle;
      await tx.user.update({ where: { id: user.id }, data: { selectedVehicleType: action.vehicle } });
    }
    let current = await tx.chatQuizSession.findUnique({ where: { userId: user.id }, include });
    if (current && !current.presentation.answer && ['SENDING', 'ANSWERING'].includes(current.deliveryState) && now.getTime() - current.claimedAt.getTime() >= CHAT_QUIZ_LEASE_MS) {
      current = await tx.chatQuizSession.update({ where: { userId: user.id }, data: { deliveryState: 'UNCERTAIN', pollId: null, messageId: null }, include });
    }
    if (current?.deliveryState === 'BOUND' && (!current.presentation.question.active || current.presentation.question.verificationStatus !== 'VERIFIED') && !current.presentation.answer) {
      current = await tx.chatQuizSession.update({ where: { userId: user.id }, data: { deliveryState: 'UNCERTAIN', pollId: null, messageId: null }, include });
    }
    if (action.kind === 'next' || action.kind === 'replace') {
      if (current?.presentationId === action.presentationId && current.presentation.answer && action.kind === 'replace') return { kind: 'feedback', session: current } as const;
      if (!current || current.presentationId !== action.presentationId
        || (action.kind === 'next' ? !current.presentation.answer : current.deliveryState !== 'UNCERTAIN')) return { kind: 'stale' } as const;
    } else if (current) {
      if (current.presentation.answer) return { kind: 'feedback', session: current } as const;
      if (current.deliveryState === 'BOUND') return { kind: current.presentation.answer ? 'feedback' : 'bound', session: current } as const;
      return { kind: ['SENDING', 'ANSWERING'].includes(current.deliveryState) ? 'busy' : 'uncertain', session: current } as const;
    }
    if (!user.selectedVehicleType) return { kind: 'vehicle-required' } as const;
    const selected = await selectPracticeQuestion(tx, user.selectedVehicleType, randomOffset);
    if (!selected) return { kind: 'empty' } as const;
    const { question, snapshot } = selected;
    const presentation = await tx.questionPresentation.create({ data: { userId: user.id, questionId: question.id, conceptId: question.conceptId, snapshot, createdAt: now } });
    const data = { presentationId: presentation.id, questionId: question.id, language: quizLanguage(snapshot, user.preferredLanguage), deliveryState: 'SENDING', claimedAt: now, pollId: null, messageId: null };
    const session = await tx.chatQuizSession.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data, include });
    return { kind: 'send', session } as const;
  }, { isolationLevel: 'Serializable' }), isRetryableDailyPracticeConflict);
}

export const sentQuizSchema = z.object({
  message_id: z.number().int().positive().max(2 ** 31 - 1), chat: z.object({ id: telegramLearnerSchema.shape.id, type: z.literal('private') }),
  poll: z.object({ id: pollIdSchema, type: z.literal('quiz'), is_anonymous: z.literal(false), options: z.array(z.object({ text: z.string().min(1).max(100) })).length(4) }),
});

export async function markChatQuizUncertain(database: PrismaClient, session: ChatQuiz) {
  await database.chatQuizSession.updateMany({ where: { userId: session.userId, presentationId: session.presentationId, deliveryState: 'SENDING' }, data: { deliveryState: 'UNCERTAIN' } });
}

export async function bindChatQuiz(database: PrismaClient, session: ChatQuiz, responseInput: unknown, telegramId: number, expectedOptions: string[], now = new Date()) {
  const response = sentQuizSchema.parse(responseInput);
  if (response.chat.id !== telegramId || response.poll.options.some(({ text }, i) => text !== expectedOptions[i])) throw new Error('Quiz delivery response is inconsistent');
  return database.$transaction(async (tx) => {
    await lockUser(tx, session.userId);
    const update = await tx.chatQuizSession.updateMany({ where: { userId: session.userId, presentationId: session.presentationId, deliveryState: 'SENDING', claimedAt: { gt: new Date(now.getTime() - CHAT_QUIZ_LEASE_MS) } },
      data: { deliveryState: 'BOUND', pollId: response.poll.id, messageId: response.message_id } });
    if (update.count !== 1) throw new Error('Quiz delivery claim expired or changed');
  });
}

export const chatPollAnswerSchema = z.object({ poll_id: pollIdSchema, user: telegramLearnerSchema, voter_chat: z.never().optional(), option_ids: z.array(z.number().int().min(0).max(3)).length(1) });
export async function answerChatQuiz(database: PrismaClient, input: unknown, now = new Date()) {
  const parsed = chatPollAnswerSchema.safeParse(input);
  if (!parsed.success) return null;
  const vote = parsed.data;
  let claimed: ChatQuiz | null;
  try { claimed = await database.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { telegramUserId: BigInt(vote.user.id) } });
    if (!user) return null;
    await lockUser(tx, user.id);
    const session = await tx.chatQuizSession.findUnique({ where: { userId: user.id }, include });
    if (!session || !['BOUND', 'ANSWERING'].includes(session.deliveryState) || session.pollId !== vote.poll_id
      || !session.presentation.question.active || session.presentation.question.verificationStatus !== 'VERIFIED') return null;
    const snapshot = parsePresentationSnapshot(session.presentation.snapshot);
    if (snapshot.question.id !== session.questionId) throw new Error('Chat quiz snapshot relationship is inconsistent');
    const choice = snapshot.question.choices[vote.option_ids[0]!];
    if (!choice) return null;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "QuestionPresentation" WHERE id = ${session.presentationId}::uuid FOR UPDATE`);
    session.presentation.answer = await tx.answerAttempt.findUnique({ where: { presentationId: session.presentationId } });
    if (session.presentation.answer) return session;
    if (session.deliveryState === 'ANSWERING') return null;
    return tx.chatQuizSession.update({ where: { userId: user.id }, data: { deliveryState: 'ANSWERING', claimedAt: now }, include });
  }); } catch { throw new UnclaimedQuizAnswerError(); }
  if (!claimed || claimed.presentation.answer) return claimed;
  const claim = claimed;
  return database.$transaction(async (tx) => {
    await lockUser(tx, claim.userId);
    const session = await tx.chatQuizSession.findUnique({ where: { userId: claim.userId }, include });
    if (!session || session.presentationId !== claim.presentationId || session.pollId !== vote.poll_id
      || session.deliveryState !== 'ANSWERING' || session.claimedAt.getTime() !== claim.claimedAt.getTime()
      || !session.presentation.question.active || session.presentation.question.verificationStatus !== 'VERIFIED') return null;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "QuestionPresentation" WHERE id = ${session.presentationId}::uuid FOR UPDATE`);
    session.presentation.answer = await tx.answerAttempt.findUnique({ where: { presentationId: session.presentationId } });
    if (!session.presentation.answer) {
      const snapshot = parsePresentationSnapshot(session.presentation.snapshot);
      const choice = snapshot.question.choices[vote.option_ids[0]!];
      if (!choice) throw new Error('Claimed quiz option is inconsistent');
      const result = await submitPracticeAnswer(tx, session.userId, session.presentationId, choice.id, now);
      if ('error' in result) throw new Error('Chat quiz answer rejected');
      session.presentation.answer = await tx.answerAttempt.findUniqueOrThrow({ where: { presentationId: session.presentationId } });
    }
    return tx.chatQuizSession.update({ where: { userId: session.userId }, data: { deliveryState: 'BOUND' }, include });
  });
}

export function chatQuizFeedback(session: ChatQuiz) {
  if (!session.presentation.answer) throw new Error('Chat quiz is unanswered');
  return practiceAnswerResponse(session.presentationId, session.presentation.snapshot, {
    selectedChoiceId: session.presentation.answer.selectedChoiceId, isCorrect: session.presentation.answer.isCorrect,
  });
}
