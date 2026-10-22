import { z } from 'zod';
import { GrammyError } from 'grammy';
import { chatPollAnswerSchema, telegramLearnerSchema, UnclaimedQuizAnswerError } from '../../../packages/database/src/chat-quiz.ts';
import { answerGroupQuiz, bindGroupControl, bindGroupQuiz, groupPollBinding, groupQuizResults, groupScopeSchema, markGroupQuizUncertain, requestGroupQuiz, type GroupRound, type GroupScope } from '../../../packages/database/src/group-chat-quiz.ts';
import type { PrismaClient } from '../../../packages/database/src/index.ts';
import { parsePresentationSnapshot } from '../../../packages/database/src/presentation.ts';
import { buildNativeQuiz, quizTextChunks, type QuizPollOptions } from './chat-quiz.ts';

const messageId = z.number().int().positive().max(2 ** 31 - 1);
const chat = z.object({ id: groupScopeSchema.shape.telegramChatId, type: z.enum(['group','supergroup']) });
const origin = { chat, message_thread_id: messageId.optional(), sender_chat: z.never().optional(), forward_origin: z.never().optional() };
export const groupCommandSchema = z.object({ ...origin, from: telegramLearnerSchema });
const callbackSchema = z.object({ id: z.string().min(1).max(256), from: telegramLearnerSchema, data: z.string().max(64), message: z.object({ ...origin, message_id: messageId, from: z.object({ id: telegramLearnerSchema.shape.id, is_bot: z.literal(true) }) }) });
type Markup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
type GroupSendOptions = { message_thread_id?: number; protect_content: true; reply_markup?: Markup };
export type GroupQuizTransport = {
  getChatMember(chatId: number, userId: number): Promise<unknown>;
  sendMessage(chatId: number, text: string, options: GroupSendOptions): Promise<unknown>;
  sendPhoto(chatId: number, photo: string, options: GroupSendOptions): Promise<unknown>;
  sendPoll(chatId: number, question: string, choices: Array<{ text: string }>, options: QuizPollOptions & GroupSendOptions): Promise<unknown>;
  stopPoll(chatId: number, messageId: number): Promise<unknown>;
};
const membershipSchema = z.object({ user: z.object({ id: telegramLearnerSchema.shape.id }), status: z.enum(['creator','administrator','member','restricted','left','kicked']), is_member: z.boolean().optional() });
export function parseGroupMembership(input: unknown, userId: number) {
  const result = membershipSchema.parse(input);
  if (result.user.id !== userId) throw new Error('Membership identity mismatch');
  return { administrator: result.status === 'creator' || result.status === 'administrator', member: ['creator','administrator','member'].includes(result.status) || (result.status === 'restricted' && result.is_member === true) };
}
/** Only explicit membership denials are terminal; outages and unknown API errors retry. */
export function isDefinitiveMembershipDenial(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false;
  const description = error.description;
  return (error.error_code === 403 && /^Forbidden: (?:bot was kicked from the (?:group chat|supergroup chat)|bot is not a member of the (?:group chat|supergroup chat)|the group chat was deleted)$/u.test(description))
    || (error.error_code === 400 && ['Bad Request: chat not found', 'Bad Request: user not found', 'Bad Request: member not found', 'Bad Request: USER_ID_INVALID', 'Bad Request: PARTICIPANT_ID_INVALID'].includes(description));
}
const optionsFor = (scope: GroupScope): GroupSendOptions => ({ protect_content: true, ...(scope.threadId ? { message_thread_id: scope.threadId } : {}) });
const scopeFor = (input: { chat: { id: number }; message_thread_id?: number | undefined }): GroupScope => ({ telegramChatId: input.chat.id, threadId: input.message_thread_id ?? 0 });
const roundScope = (round: GroupRound): GroupScope => ({ telegramChatId: Number(round.telegramChatId), threadId: round.threadId });

export function createGroupQuizService(database: PrismaClient, api: GroupQuizTransport, botId: () => number, now: () => Date = () => new Date(), randomOffset?: (count: number) => unknown) {
  const text = async (scope: GroupScope, content: string) => { for (const chunk of quizTextChunks(content)) await api.sendMessage(scope.telegramChatId, chunk, optionsFor(scope)); };
  const controls = async (round: GroupRound, content: string, action: 'f'|'n'|'r', label: string) => {
    const scope = roundScope(round);
    const sent = await api.sendMessage(scope.telegramChatId, content, { ...optionsFor(scope), reply_markup: { inline_keyboard: [[{ text: label, callback_data: `gq1:${action}:${round.id}` }]] } });
    await bindGroupControl(database, round, sent);
  };
  const membership = async (scope: GroupScope, userId: number) => {
    try { return parseGroupMembership(await api.getChatMember(scope.telegramChatId, userId), userId); }
    catch (error) { if (isDefinitiveMembershipDenial(error)) return { administrator: false, member: false }; throw error; }
  };
  const privileges = async (scope: GroupScope, userId: number) => {
    const own = await membership(scope, botId());
    if (!own.administrator) return { botAdministrator: false, administrator: false, member: false };
    return { botAdministrator: true, ...await membership(scope, userId) };
  };
  const feedback = async (round: GroupRound) => {
    const scope = roundScope(round);
    // CLOSED already prevents credit. stopPoll failure must not block explanation recovery.
    if (round.messageId) { try { await api.stopPoll(scope.telegramChatId, round.messageId); } catch { /* Retry on the next explicit /quiz recovery. */ } }
    const snapshot = parsePresentationSnapshot(round.snapshot); const result = await groupQuizResults(database, round);
    const answer = snapshot.question.choices.find(({ id }) => id === snapshot.correctChoiceId)!;
    await text(scope, [`Correct answer: ${answer.key}. ${answer.textEnglish}`, snapshot.explanationEnglish, snapshot.trapExplanationEnglish, `Answered: ${result.answered}. Correct: ${result.answered ? Math.round(result.correct / result.answered * 100) : 0}%.`].filter(Boolean).join('\n\n'));
    await controls(round, 'Round finished. The starter or a group administrator can continue.', 'n', 'Next question');
  };
  const request = async (scope: GroupScope, actor: z.infer<typeof telegramLearnerSchema>, action: unknown) => {
    const permission = await privileges(scope, actor.id);
    if (!permission.botAdministrator) { await text(scope, 'Make this bot a group administrator to enable scored group quizzes. Then send /quiz@thauto_dlt_bot.'); return; }
    if (!permission.member) return;
    const result = await requestGroupQuiz(database, scope, actor, action, permission.administrator, now(), randomOffset);
    if (result.kind === 'forbidden') { await text(scope, 'Only the starter or a group administrator can finish or advance this round.'); return; }
    if (result.kind === 'stale') { await text(scope, 'This control has expired. Send /quiz to recover the current round.'); return; }
    if (result.kind === 'no-votes') { await text(scope, 'At least one participant must answer before finishing.'); return; }
    if (result.kind === 'empty') { await text(scope, 'No verified questions are available for this vehicle.'); return; }
    if (result.kind === 'busy') { await text(scope, 'The group quiz is being sent. Send /quiz again shortly.'); return; }
    if (result.kind === 'closed') { await feedback(result.round); return; }
    if (result.kind === 'uncertain') { await controls(result.round, 'Delivery is uncertain. The starter or an administrator can explicitly replace this round; earlier polls will not count.', 'r', 'Replace quiz'); return; }
    if (result.kind === 'bound') { await controls(result.round, `Answer the current quiz above (message ${result.round.messageId}). Votes are non-anonymous and count toward personal practice. Finish when everyone is ready.`, 'f', 'Finish round'); return; }
    let round = result.round;
    try {
      const quiz = buildNativeQuiz(round.snapshot, 'ENGLISH');
      await text(scope, 'Group practice: votes are non-anonymous and count toward your personal practice. The starter or an administrator finishes the round when everyone is ready.');
      if (quiz.image) await api.sendPhoto(scope.telegramChatId, quiz.image, optionsFor(scope));
      if (quiz.context) await text(scope, quiz.context);
      const sent = await api.sendPoll(scope.telegramChatId, quiz.question, quiz.options, { ...quiz.other, ...optionsFor(scope) });
      round = await bindGroupQuiz(database, round, sent, quiz.options.map(({ text }) => text), now());
    } catch {
      await markGroupQuizUncertain(database, round);
      await text(scope, 'Quiz delivery could not be confirmed. Send /quiz to recover or explicitly replace it.');
      return;
    }
    await controls(round, 'Answer above. Finish when everyone is ready.', 'f', 'Finish round');
  };
  return {
    command: async (input: unknown, argument: unknown = '') => {
      const parsed = groupCommandSchema.safeParse(input); if (!parsed.success) return;
      const match = z.string().safeParse(argument); if (!match.success) return;
      const vehicle = match.data.trim().toLowerCase(); const scope = scopeFor(parsed.data);
      if (!['','car','motorcycle'].includes(vehicle)) { await text(scope, 'Use /quiz@thauto_dlt_bot [car|motorcycle].'); return; }
      await request(scope, parsed.data.from, { kind: 'start', ...(vehicle ? { vehicle: vehicle.toUpperCase() } : {}) });
    },
    callback: async (input: unknown) => {
      const parsed = callbackSchema.safeParse(input); if (!parsed.success || parsed.data.message.from.id !== botId()) return;
      const callback = parsed.data; const match = /^gq1:([fnr]):([0-9a-f-]{36})$/u.exec(callback.data);
      if (!match || !z.uuid().safeParse(match[2]).success) return;
      await request(scopeFor(callback.message), callback.from, { kind: match[1] === 'f' ? 'finish' : match[1] === 'n' ? 'next' : 'replace', roundId: match[2], messageId: callback.message.message_id });
    },
    /** Returns true only when this poll belongs to the durable group namespace. */
    answer: async (input: unknown) => {
      const parsed = chatPollAnswerSchema.safeParse(input); if (!parsed.success) return false;
      const round = await groupPollBinding(database, parsed.data.poll_id); if (!round) return false;
      if (round.deliveryState !== 'BOUND') return true;
      try {
        const permission = await privileges(roundScope(round), parsed.data.user.id);
        if (!permission.botAdministrator || !permission.member) return true;
        await answerGroupQuiz(database, round, parsed.data, now());
      } catch { throw new UnclaimedQuizAnswerError(); }
      return true;
    },
  };
}
