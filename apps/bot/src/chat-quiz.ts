import { z } from 'zod';
import { createGroupQuizService } from './group-chat-quiz.ts';
import { invalidateMigratedGroup } from '../../../packages/database/src/group-chat-quiz.ts';
import type { Bot } from 'grammy';
import type { PrismaClient } from '../../../packages/database/src/index.ts';
import { answerChatQuiz, bindChatQuiz, chatQuizFeedback, markChatQuizUncertain, requestChatQuiz, telegramLearnerSchema, UnclaimedQuizAnswerError, type ChatQuiz } from '../../../packages/database/src/chat-quiz.ts';
import { parsePresentationSnapshot } from '../../../packages/database/src/presentation.ts';
import { publishableImageReference } from './question-post.ts';

const privateIdentitySchema = z.object({ from: telegramLearnerSchema, chat: z.object({ type: z.literal('private'), id: telegramLearnerSchema.shape.id }) }).refine(({ from, chat }) => from.id === chat.id);
const callbackSchema = z.object({ id: z.string().min(1).max(256), from: telegramLearnerSchema, message: z.object({ chat: privateIdentitySchema.shape.chat }), data: z.string().max(64) }).refine(({ from, message }) => from.id === message.chat.id);
const keyboard = (text: string, data: string) => ({ inline_keyboard: [[{ text, callback_data: data }]] });
type Markup = ReturnType<typeof keyboard>;
export type QuizPollOptions = {
  type: 'quiz'; is_anonymous: false; correct_option_ids: number[]; allows_multiple_answers: false;
  allows_revoting: false; shuffle_options: false; allow_adding_options: false; explanation?: string;
};
export type QuizTransport = {
  sendMessage(chatId: number, text: string, options?: { reply_markup: Markup }): Promise<unknown>;
  sendPhoto(chatId: number, photo: string): Promise<unknown>;
  sendPoll(chatId: number, question: string, options: Array<{ text: string }>, other: QuizPollOptions): Promise<unknown>;
};

/** Bound UTF-16 chunks without cutting Unicode surrogate pairs. Plain text, no parse mode. */
export function quizTextChunks(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of text) {
    if (chunk.length + character.length > 4000) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

const labels = {
  ENGLISH: { prompt: 'Choose the correct answer.', next: 'Next question', correct: 'Correct', incorrect: 'Incorrect', answer: 'Correct answer' },
  RUSSIAN: { prompt: 'Выберите правильный ответ.', next: 'Следующий вопрос', correct: 'Верно', incorrect: 'Неверно', answer: 'Правильный ответ' },
  THAI: { prompt: 'เลือกคำตอบที่ถูกต้อง', next: 'คำถามถัดไป', correct: 'ถูกต้อง', incorrect: 'ไม่ถูกต้อง', answer: 'คำตอบที่ถูกต้อง' },
};
export function buildNativeQuiz(snapshotInput: unknown, language: ChatQuiz['language']) {
  const snapshot = parsePresentationSnapshot(snapshotInput);
  const question = snapshot.question;
  const stem = language === 'RUSSIAN' ? question.textRussian : language === 'THAI' ? question.textThai : question.textEnglish;
  const choices = question.choices.map((choice) => language === 'RUSSIAN' ? choice.textRussian : language === 'THAI' ? choice.textThai : choice.textEnglish);
  if (!stem || choices.some((value) => !value)) throw new Error('Incomplete chat quiz language');
  const texts = choices.map((value) => z.string().min(1).parse(value));
  const explanation = language === 'RUSSIAN' ? snapshot.explanationRussian : language === 'THAI' ? snapshot.explanationThai : snapshot.explanationEnglish;
  const long = stem.length > 300 || texts.some((text) => text.length > 100);
  const context = long ? `${stem}\n\n${texts.map((text, i) => `${question.choices[i]!.key}. ${text}`).join('\n\n')}` : null;
  const options = (long ? question.choices.map(({ key }) => key) : texts).map((text) => ({ text }));
  const other: QuizPollOptions = { type: 'quiz', is_anonymous: false, correct_option_ids: [question.choices.findIndex(({ id }) => id === snapshot.correctChoiceId)],
    allows_multiple_answers: false, allows_revoting: false, shuffle_options: false, allow_adding_options: false,
    ...(explanation && explanation.length <= 200 && (explanation.match(/\n/gu)?.length ?? 0) <= 2 ? { explanation } : {}),
  };
  return { question: long ? labels[language].prompt : stem, options, other, context, image: publishableImageReference(snapshot.imageReference) };
}

export function createChatQuizService(database: PrismaClient, api: QuizTransport, now: () => Date = () => new Date(), randomOffset?: (count: number) => unknown) {
  const sendText = async (chatId: number, text: string, markup?: Markup) => {
    const chunks = quizTextChunks(text);
    for (const [i, chunk] of chunks.entries()) await api.sendMessage(chatId, chunk, ...(markup && i === chunks.length - 1 ? [{ reply_markup: markup }] : []));
  };
  const feedback = async (chatId: number, session: ChatQuiz) => {
    const result = chatQuizFeedback(session);
    const language = session.language;
    const wording = labels[language];
    const snapshot = parsePresentationSnapshot(session.presentation.snapshot);
    const choice = snapshot.question.choices.find(({ id }) => id === result.correctChoiceId)!;
    const answer = language === 'RUSSIAN' ? choice.textRussian : language === 'THAI' ? choice.textThai : choice.textEnglish;
    const explanation = language === 'RUSSIAN' ? result.explanationRussian : language === 'THAI' ? result.explanationThai : result.explanationEnglish;
    const trap = language === 'RUSSIAN' ? result.trapExplanationRussian : language === 'THAI' ? result.trapExplanationThai : result.trapExplanationEnglish;
    await sendText(chatId, [result.isCorrect ? wording.correct : wording.incorrect, `${wording.answer}: ${choice.key}. ${answer}`, explanation, trap].filter(Boolean).join('\n\n'), keyboard(wording.next, `cq:n:${session.presentationId}`));
  };
  const request = async (identityInput: unknown, action: unknown) => {
    const parsed = privateIdentitySchema.safeParse(identityInput);
    if (!parsed.success) return;
    const { from, chat } = parsed.data;
    const result = await requestChatQuiz(database, from, action, now(), randomOffset);
    if (result.kind === 'vehicle-required') { await api.sendMessage(chat.id, 'Choose your vehicle to practise in this chat.', { reply_markup: { inline_keyboard: [[{ text: 'Car', callback_data: 'cq:v:CAR' }, { text: 'Motorcycle', callback_data: 'cq:v:MOTORCYCLE' }]] } }); return; }
    if (result.kind === 'empty') { await api.sendMessage(chat.id, 'No questions available for this vehicle.'); return; }
    if (result.kind === 'stale') { await api.sendMessage(chat.id, 'This control has expired. Send /quiz to resume.'); return; }
    if (result.kind === 'busy') { await api.sendMessage(chat.id, 'Your quiz is being sent. Send /quiz again shortly.'); return; }
    if (result.kind === 'uncertain') { await api.sendMessage(chat.id, 'Delivery is uncertain. Replace this quiz to continue; any earlier poll will no longer count.', { reply_markup: keyboard('Replace quiz', `cq:r:${result.session.presentationId}`) }); return; }
    if (result.kind === 'bound') { await api.sendMessage(chat.id, 'Answer your current quiz above. Send /quiz after answering to recover feedback.'); return; }
    if (result.kind === 'feedback') { await feedback(chat.id, result.session); return; }
    const session = result.session;
    try {
      const quiz = buildNativeQuiz(session.presentation.snapshot, session.language);
      if (quiz.image) await api.sendPhoto(chat.id, quiz.image);
      if (quiz.context) await sendText(chat.id, quiz.context);
      const response = await api.sendPoll(chat.id, quiz.question, quiz.options, quiz.other);
      await bindChatQuiz(database, session, response, chat.id, quiz.options.map(({ text }) => text), now());
    } catch {
      await markChatQuizUncertain(database, session);
      await api.sendMessage(chat.id, 'Quiz delivery could not be confirmed. Send /quiz to recover or explicitly replace it.');
    }
  };
  return {
    command: (input: unknown) => request(input, { kind: 'start' }),
    callback: async (input: unknown) => {
      const parsed = callbackSchema.safeParse(input);
      if (!parsed.success) return;
      const callback = parsed.data;
      const match = /^cq:([nr]):([0-9a-f-]{36})$/u.exec(callback.data);
      let action: unknown;
      if (match && z.uuid().safeParse(match[2]).success) action = { kind: match[1] === 'n' ? 'next' : 'replace', presentationId: match[2] };
      else if (callback.data === 'cq:v:CAR' || callback.data === 'cq:v:MOTORCYCLE') action = { kind: 'vehicle', vehicle: callback.data.slice(5) };
      else return;
      await request({ from: callback.from, chat: callback.message.chat }, action);
    },
    answer: async (input: unknown) => {
      const session = await answerChatQuiz(database, input, now());
      if (session) {
        const learner = await database.user.findUniqueOrThrow({ where: { id: session.userId }, select: { telegramUserId: true } });
        await feedback(Number(learner.telegramUserId), session);
      }
    },
  };
}

export function registerChatQuiz(bot: Bot, database: PrismaClient) {
  const service = createChatQuizService(database, bot.api);
  const group = createGroupQuizService(database, bot.api, () => bot.botInfo.id);
  bot.on('message:migrate_to_chat_id', async (context) => { await invalidateMigratedGroup(database, context.chat.id); });
  bot.command(['quiz', 'practice'], async (context) => {
    if (context.chat.type === 'private') await service.command({ from: context.from, chat: context.chat });
    else await group.command(context.message, context.match);
  });
  bot.callbackQuery(/^gq1:/u, async (context) => { await group.callback(context.callbackQuery); await context.answerCallbackQuery(); });
  bot.callbackQuery(/^cq:/u, async (context) => {
    await service.callback(context.callbackQuery);
    await context.answerCallbackQuery();
  });
  bot.on('poll_answer', async (context) => { if (!await group.answer(context.pollAnswer)) await service.answer(context.pollAnswer); });
}

export function configureBotErrors(bot: Bot) {
  bot.catch((error) => {
    if (error.error instanceof UnclaimedQuizAnswerError) throw new UnclaimedQuizAnswerError();
    console.error('Bot update failed.');
  });
}
