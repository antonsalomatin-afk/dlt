import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from './index.ts';
import { CHAT_QUIZ_LEASE_MS, chatPollAnswerSchema, telegramLearnerSchema, UnclaimedQuizAnswerError } from './chat-quiz.ts';
import { retryDailyPractice, isRetryableDailyPracticeConflict } from './daily-practice.ts';
import { parsePresentationSnapshot, selectPracticeQuestion } from './presentation.ts';
import { submitPracticeAnswer } from './answer.ts';

export const groupScopeSchema = z.object({ telegramChatId: z.number().int().min(-(2 ** 52 - 1)).max(-1).refine(Number.isSafeInteger), threadId: z.number().int().min(0).max(2 ** 31 - 1) });
export type GroupScope = z.infer<typeof groupScopeSchema>;
const control = { roundId: z.uuid(), messageId: z.number().int().positive().max(2 ** 31 - 1) };
export const groupActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), vehicle: z.enum(['CAR','MOTORCYCLE']).optional() }),
  z.strictObject({ kind: z.literal('finish'), ...control }),
  z.strictObject({ kind: z.literal('next'), ...control }),
  z.strictObject({ kind: z.literal('replace'), ...control }),
]);
const include = { question: { select: { active: true, verificationStatus: true } }, initiator: { select: { telegramUserId: true } } } as const;
export type GroupRound = Prisma.GroupQuizRoundGetPayload<{ include: typeof include }>;
const serializationMetadata = z.union([
  z.object({ code: z.enum(['40001', '40P01']) }),
  z.object({ driverAdapterError: z.object({ cause: z.object({ originalCode: z.enum(['40001', '40P01']) }) }) }),
]);
function retryable(error: unknown) {
  if (isRetryableDailyPracticeConflict(error)) return true;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2010') return serializationMetadata.safeParse(error.meta).success;
  return error.code === 'P2002' && z.object({ modelName: z.enum(['GroupQuizScope', 'User']) }).safeParse(error.meta).success;
}
async function lockScope(tx: Prisma.TransactionClient, scope: GroupScope) {
  await tx.groupQuizScope.upsert({ where: { telegramChatId_threadId: scope }, create: scope, update: {} });
  await tx.$queryRaw(Prisma.sql`SELECT "telegramChatId" FROM "GroupQuizScope" WHERE "telegramChatId"=${BigInt(scope.telegramChatId)} AND "threadId"=${scope.threadId} FOR UPDATE`);
}
async function lockRound(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "GroupQuizRound" WHERE id=${id}::uuid FOR UPDATE`);
  return tx.groupQuizRound.findUniqueOrThrow({ where: { id }, include });
}
async function learner(tx: Prisma.TransactionClient, input: z.infer<typeof telegramLearnerSchema>, now: Date) {
  const user = await tx.user.upsert({ where: { telegramUserId: BigInt(input.id) }, create: { telegramUserId: BigInt(input.id), firstName: input.first_name, ...(input.username ? { username: input.username } : {}), lastSeenAt: now }, update: { firstName: input.first_name, ...(input.username ? { username: input.username } : {}), lastSeenAt: now } });
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`);
  return user;
}
export async function requestGroupQuiz(database: PrismaClient, scopeInput: unknown, actorInput: unknown, actionInput: unknown, administrator: boolean, now = new Date(), randomOffset: (count: number) => unknown = randomInt) {
  const scope = groupScopeSchema.parse(scopeInput); const actor = telegramLearnerSchema.parse(actorInput); const action = groupActionSchema.parse(actionInput);
  return retryDailyPractice(() => database.$transaction(async (tx) => {
    await lockScope(tx, scope);
    const pointer = await tx.groupQuizScope.findUniqueOrThrow({ where: { telegramChatId_threadId: scope } });
    let current = pointer.currentRoundId ? await lockRound(tx, pointer.currentRoundId) : null;
    if (current && ((current.deliveryState === 'SENDING' && now.getTime() - current.claimedAt.getTime() >= CHAT_QUIZ_LEASE_MS) || (current.deliveryState === 'BOUND' && (!current.question.active || current.question.verificationStatus !== 'VERIFIED')))) {
      current = await tx.groupQuizRound.update({ where: { id: current.id }, data: { deliveryState: 'UNCERTAIN', pollId: null, messageId: null, controlMessageId: null }, include });
    }
    if (action.kind !== 'start') {
      if (!current || current.id !== action.roundId || current.controlMessageId !== action.messageId) return { kind: 'stale' } as const;
      if (!administrator && current.initiator.telegramUserId !== BigInt(actor.id)) return { kind: 'forbidden' } as const;
      if (action.kind === 'finish') {
        if (current.deliveryState === 'CLOSED') return { kind: 'closed', round: current } as const;
        if (current.deliveryState !== 'BOUND') return { kind: 'stale' } as const;
        if (await tx.groupQuizVote.count({ where: { roundId: current.id } }) === 0) return { kind: 'no-votes' } as const;
        const round = await tx.groupQuizRound.update({ where: { id: current.id }, data: { deliveryState: 'CLOSED', closedAt: now, controlMessageId: null }, include });
        return { kind: 'closed', round } as const;
      }
      if ((action.kind === 'next' && current.deliveryState !== 'CLOSED') || (action.kind === 'replace' && current.deliveryState !== 'UNCERTAIN')) return { kind: 'stale' } as const;
    } else if (current) {
      if (current.deliveryState === 'CLOSED' && action.vehicle) {
        if (!administrator && current.initiator.telegramUserId !== BigInt(actor.id)) return { kind: 'forbidden' } as const;
      } else {
        return { kind: current.deliveryState === 'BOUND' ? 'bound' : current.deliveryState === 'CLOSED' ? 'closed' : current.deliveryState === 'SENDING' ? 'busy' : 'uncertain', round: current } as const;
      }
    }
    const vehicleType = action.kind === 'start' ? action.vehicle ?? 'CAR' : current!.vehicleType;
    const selected = await selectPracticeQuestion(tx, vehicleType, randomOffset);
    if (!selected) return { kind: 'empty' } as const;
    if (current?.deliveryState === 'UNCERTAIN') await tx.groupQuizRound.update({ where: { id: current.id }, data: { deliveryState: 'CLOSED', closedAt: now, controlMessageId: null } });
    const user = await learner(tx, actor, now);
    const round = await tx.groupQuizRound.create({ data: { ...scope, initiatorId: user.id, questionId: selected.question.id, conceptId: selected.question.conceptId, snapshot: selected.snapshot, vehicleType, language: 'ENGLISH', deliveryState: 'SENDING', claimedAt: now, createdAt: now }, include });
    await tx.groupQuizScope.update({ where: { telegramChatId_threadId: scope }, data: { currentRoundId: round.id } });
    return { kind: 'send', round } as const;
  }, { isolationLevel: 'Serializable' }), retryable);
}
export const groupSentQuizSchema = z.object({ message_id: control.messageId, message_thread_id: control.messageId.optional(), chat: z.object({ id: groupScopeSchema.shape.telegramChatId, type: z.enum(['group','supergroup']) }), poll: z.object({ id: z.string().min(1).max(256), type: z.literal('quiz'), is_anonymous: z.literal(false), options: z.array(z.object({ text: z.string().min(1).max(100) })).length(4) }) });
export async function bindGroupQuiz(database: PrismaClient, round: GroupRound, responseInput: unknown, options: string[], now = new Date()) {
  const sent = groupSentQuizSchema.parse(responseInput);
  if (BigInt(sent.chat.id) !== round.telegramChatId || (sent.message_thread_id ?? 0) !== round.threadId || sent.poll.options.some(({ text }, i) => text !== options[i])) throw new Error('Group quiz response does not match its claim');
  return database.$transaction(async (tx) => {
    const scope = { telegramChatId: Number(round.telegramChatId), threadId: round.threadId }; await lockScope(tx, scope);
    const pointer = await tx.groupQuizScope.findUniqueOrThrow({ where: { telegramChatId_threadId: scope } });
    await lockRound(tx, round.id);
    if (pointer.currentRoundId !== round.id) throw new Error('Group round superseded');
    const update = await tx.groupQuizRound.updateMany({ where: { id: round.id, deliveryState: 'SENDING', claimedAt: round.claimedAt, AND: { claimedAt: { gt: new Date(now.getTime()-CHAT_QUIZ_LEASE_MS) } } }, data: { deliveryState: 'BOUND', pollId: sent.poll.id, messageId: sent.message_id } });
    if (update.count !== 1) throw new Error('Group quiz claim expired or changed');
    return tx.groupQuizRound.findUniqueOrThrow({ where: { id: round.id }, include });
  });
}
export async function markGroupQuizUncertain(database: PrismaClient, round: GroupRound) {
  await database.groupQuizRound.updateMany({ where: { id: round.id, deliveryState: 'SENDING' }, data: { deliveryState: 'UNCERTAIN', controlMessageId: null } });
}
export async function bindGroupControl(database: PrismaClient, round: GroupRound, responseInput: unknown) {
  const response = z.object({ message_id: control.messageId, message_thread_id: control.messageId.optional(), chat: groupSentQuizSchema.shape.chat }).parse(responseInput);
  if (BigInt(response.chat.id) !== round.telegramChatId || (response.message_thread_id ?? 0) !== round.threadId) throw new Error('Group control response mismatch');
  const updated = await database.groupQuizRound.updateMany({ where: { id: round.id, deliveryState: round.deliveryState, currentScope: { isNot: null } }, data: { controlMessageId: response.message_id } });
  if (updated.count !== 1) throw new Error('Group control is superseded');
}
export async function groupPollBinding(database: PrismaClient, pollId: string) {
  try { return await database.groupQuizRound.findUnique({ where: { pollId }, include }); }
  catch { throw new UnclaimedQuizAnswerError(); }
}
export async function answerGroupQuiz(database: PrismaClient, round: GroupRound, input: unknown, now = new Date()) {
  const parsed = chatPollAnswerSchema.safeParse(input); if (!parsed.success || parsed.data.poll_id !== round.pollId) return null;
  const vote = parsed.data;
  try {
    return await retryDailyPractice(() => database.$transaction(async (tx) => {
      const scope = { telegramChatId: Number(round.telegramChatId), threadId: round.threadId }; await lockScope(tx, scope);
      const pointer = await tx.groupQuizScope.findUniqueOrThrow({ where: { telegramChatId_threadId: scope } });
      const current = await lockRound(tx, round.id);
      if (pointer.currentRoundId !== current.id || current.deliveryState !== 'BOUND' || current.pollId !== vote.poll_id || !current.question.active || current.question.verificationStatus !== 'VERIFIED') return null;
      const snapshot = parsePresentationSnapshot(current.snapshot);
      if (snapshot.question.id !== current.questionId) throw new Error('Group snapshot relationship mismatch');
      const user = await learner(tx, vote.user, now);
      const existing = await tx.groupQuizVote.findUnique({ where: { roundId_userId: { roundId: current.id, userId: user.id } }, include: { presentation: { include: { answer: true } } } });
      if (existing) return existing.presentation.answer;
      const choice = snapshot.question.choices[vote.option_ids[0]!]!;
      const presentation = await tx.questionPresentation.create({ data: { userId: user.id, questionId: current.questionId, conceptId: current.conceptId, snapshot, createdAt: now } });
      await tx.groupQuizVote.create({ data: { roundId: current.id, userId: user.id, questionId: current.questionId, presentationId: presentation.id } });
      const result = await submitPracticeAnswer(tx, user.id, presentation.id, choice.id, now);
      if ('error' in result) throw new Error('Group answer rejected');
      return tx.answerAttempt.findUniqueOrThrow({ where: { presentationId: presentation.id } });
    }, { isolationLevel: 'Serializable' }), retryable);
  } catch { throw new UnclaimedQuizAnswerError(); }
}
export async function groupQuizResults(database: PrismaClient, round: GroupRound) {
  const votes = await database.groupQuizVote.findMany({ where: { roundId: round.id }, select: { presentation: { select: { answer: { select: { isCorrect: true } } } } } });
  return { answered: votes.length, correct: votes.filter(({ presentation }) => presentation.answer?.isCorrect).length };
}

/** Old group capabilities must stop scoring when Telegram migrates to a new chat ID. */
export async function invalidateMigratedGroup(database: PrismaClient, chatInput: unknown, now = new Date()) {
  const chat = groupScopeSchema.shape.telegramChatId.parse(chatInput);
  const scopes = await database.groupQuizScope.findMany({ where: { telegramChatId: BigInt(chat) }, orderBy: { threadId: 'asc' } });
  for (const scope of scopes) await database.$transaction(async (tx) => {
    const key = { telegramChatId: chat, threadId: scope.threadId }; await lockScope(tx, key);
    const pointer = await tx.groupQuizScope.findUniqueOrThrow({ where: { telegramChatId_threadId: key } });
    if (pointer.currentRoundId) { await lockRound(tx, pointer.currentRoundId); await tx.groupQuizRound.update({ where: { id: pointer.currentRoundId }, data: { deliveryState: 'CLOSED', closedAt: now, controlMessageId: null } }); }
    await tx.groupQuizScope.update({ where: { telegramChatId_threadId: key }, data: { currentRoundId: null } });
  });
}
