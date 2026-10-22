import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import fetch, { Response } from 'node-fetch';
import { createBot } from '../apps/bot/src/bot.ts';
import { buildNativeQuiz, configureBotErrors, createChatQuizService, quizTextChunks, type QuizTransport } from '../apps/bot/src/chat-quiz.ts';
import { chatPollAnswerSchema, quizLanguage, sentQuizSchema, UnclaimedQuizAnswerError } from '../packages/database/src/chat-quiz.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';

const ids = Array.from({ length: 5 }, () => randomUUID());
const snapshot = {
  version: 1 as const, question: { id: randomUUID(), textThai: null, textRussian: 'Русский вопрос', textExamEnglish: null, textEnglish: 'English question',
    choices: (['A', 'B', 'C', 'D'] as const).map((key, i) => ({ id: ids[i]!, key, textEnglish: `English ${key}`, textThai: null, textRussian: null })),
  }, correctChoiceId: ids[2]!, explanationEnglish: 'English explanation', explanationRussian: null, explanationThai: null,
  trapExplanationEnglish: 'English trap', trapExplanationRussian: null, trapExplanationThai: null,
};
const learner = { id: 42, is_bot: false, first_name: 'Test' };

it('keeps the immutable option order, answer key and all native quiz restrictions', () => {
  const quiz = buildNativeQuiz(snapshot, 'ENGLISH');
  expect(quiz.options.map(({ text }) => text)).toEqual(['English A', 'English B', 'English C', 'English D']);
  expect(quiz.other).toEqual({ type: 'quiz', is_anonymous: false, correct_option_ids: [2], allows_multiple_answers: false, allows_revoting: false, shuffle_options: false, allow_adding_options: false, explanation: 'English explanation' });
});

it('uses full preferred content only and falls back coherently for stem-only RU', () => {
  expect(quizLanguage(snapshot, 'RUSSIAN')).toBe('ENGLISH');
  const full = { ...snapshot, explanationRussian: 'Объяснение', trapExplanationRussian: 'Ловушка', question: { ...snapshot.question, choices: snapshot.question.choices.map((choice) => ({ ...choice, textRussian: `Ответ ${choice.key}` })) } };
  expect(quizLanguage(full, 'RUSSIAN')).toBe('RUSSIAN');
  expect(buildNativeQuiz(full, 'RUSSIAN')).toMatchObject({ question: 'Русский вопрос', options: [{ text: 'Ответ A' }, { text: 'Ответ B' }, { text: 'Ответ C' }, { text: 'Ответ D' }], other: { explanation: 'Объяснение' } });
  expect(quizLanguage(snapshot, 'THAI')).toBe('ENGLISH');
});

it.each([['stem', 300, false], ['stem', 301, true], ['option', 100, false], ['option', 101, true]] as const)('preserves %s at length %i without truncation', (field, length, long) => {
  const text = 'x'.repeat(length);
  const changed = { ...snapshot, question: { ...snapshot.question, ...(field === 'stem' ? { textEnglish: text } : { choices: snapshot.question.choices.map((choice) => ({ ...choice, textEnglish: text })) }) } };
  const quiz = buildNativeQuiz(changed, 'ENGLISH');
  expect(quiz.context !== null).toBe(long);
  if (long) { expect(quiz.context).toContain(text); expect(quiz.options).toEqual(['A', 'B', 'C', 'D'].map((text) => ({ text }))); }
  else expect(field === 'stem' ? quiz.question : quiz.options[0]?.text).toBe(text);
});

it.each(['x'.repeat(201), 'one\ntwo\nthree\nfour'])('omits overflowing native explanation and preserves snapshot feedback', (explanationEnglish) => {
  expect(buildNativeQuiz({ ...snapshot, explanationEnglish }, 'ENGLISH').other.explanation).toBeUndefined();
});
it('retains the exact 200 character / two newline explanation and chunks Unicode losslessly', () => {
  const explanationEnglish = `a\nb\n${'c'.repeat(196)}`;
  expect(buildNativeQuiz({ ...snapshot, explanationEnglish }, 'ENGLISH').other.explanation).toBe(explanationEnglish);
  const text = '😀'.repeat(5000);
  const chunks = quizTextChunks(text);
  expect(chunks.join('')).toBe(text);
  expect(chunks.every((chunk) => chunk.length <= 4000 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(chunk))).toBe(true);
});

it('rejects anonymous, malformed and multiple/retracted/out-of-range votes', () => {
  for (const vote of [{ option_ids: [] }, { option_ids: [0, 1] }, { option_ids: [4] }, { option_ids: [-1] }, { option_ids: [0.5] }, { user: undefined }, { user: { ...learner, is_bot: true } }, { voter_chat: { id: 42 } }]) {
    expect(chatPollAnswerSchema.safeParse({ poll_id: 'poll', user: learner, option_ids: [0], ...vote }).success).toBe(false);
  }
  expect(sentQuizSchema.safeParse({ message_id: -1 }).success).toBe(false);
});

it('rejects private identity mismatches and malformed callbacks before database or transport use', async () => {
  const database = createDatabaseClient('postgresql://test:test@127.0.0.1:19999/test');
  const transaction = vi.spyOn(database, '$transaction');
  const api: QuizTransport = { sendMessage: vi.fn(), sendPoll: vi.fn(), sendPhoto: vi.fn() };
  const service = createChatQuizService(database, api);
  for (const identity of [{ from: learner, chat: { id: 43, type: 'private' } }, { from: learner, chat: { id: 42, type: 'group' } }, { from: { ...learner, is_bot: true }, chat: { id: 42, type: 'private' } }, { from: { ...learner, id: 0 }, chat: { id: 0, type: 'private' } }]) await service.command(identity);
  for (const data of ['cq:n:bad', 'cq:v:BOAT', `cq:r:${'x'.repeat(70)}`]) await service.callback({ id: '1', from: learner, message: { chat: { id: 42, type: 'private' } }, data });
  expect(transaction).not.toHaveBeenCalled();
  expect(api.sendMessage).not.toHaveBeenCalled();
  await database.$disconnect();
});

it('fails actual injected grammY polling before the next offset acknowledgement on an unclaimed vote', async () => {
  const methods: string[] = [];
  const transport = Object.assign(vi.fn(async (...[url]: Parameters<typeof fetch>) => {
    const method = String(url).split('/').at(-1)!; methods.push(method);
    const result = method === 'getUpdates' ? [{ update_id: 41, poll_answer: { poll_id: 'poll', user: learner, option_ids: [2] } }] : true;
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  }), fetch);
  const bot = createBot({ BOT_TOKEN: '123456:synthetic_token_for_tests_only', MINI_APP_URL: 'https://example.com' }, { botInfo: { id: 123456, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false }, client: { fetch: transport } });
  configureBotErrors(bot);
  bot.on('poll_answer', () => { throw new UnclaimedQuizAnswerError(); });
  await expect(bot.start({ allowed_updates: ['poll_answer'] })).rejects.toThrow('could not be durably claimed');
  expect(methods.filter((method) => method === 'getUpdates')).toHaveLength(1);
});
