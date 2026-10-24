import { readFileSync } from 'node:fs';
import { validateTeachingInputs } from '../packages/database/src/teaching.ts';
import { mapCandidateQuestion } from '../tools/content/candidate-import.ts';
import { quizFeedbackText, richQuizChunks } from '../apps/bot/src/chat-quiz-format.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabaseClient, Prisma } from '../packages/database/src/index.ts';
import { answerChatQuiz, bindChatQuiz, CHAT_QUIZ_LEASE_MS, requestChatQuiz, UnclaimedQuizAnswerError } from '../packages/database/src/chat-quiz.ts';
import { parsePresentationSnapshot } from '../packages/database/src/presentation.ts';
import { submitPracticeAnswer } from '../packages/database/src/answer.ts';
import { createChatQuizService, type QuizTransport, type QuizPollOptions } from '../apps/bot/src/chat-quiz.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

const url = process.env.DATABASE_URL;
parseDatabaseUrl(url); // Refuse a remote/production connection before creating an isolated database.
const admin = new pg.Client({ connectionString: url });
const name = `chat_quiz_test_${randomBytes(8).toString('hex')}`;
const isolated = new URL(url!); isolated.pathname = `/${name}`;
const db = createDatabaseClient(isolated.toString());
const categoryId = randomUUID();
const conceptId = randomUUID();
let nextId = 80000;
const now = new Date('2026-10-21T14:00:00Z');
const learner = () => ({ id: nextId++, is_bot: false as const, first_name: 'Synthetic' });
type Learner = ReturnType<typeof learner>;
const identity = (from: Learner) => ({ from, chat: { id: from.id, type: 'private' } });
const callback = (from: Learner, data: string) => ({ id: 'callback', from, message: { chat: { id: from.id, type: 'private' } }, data });
const vote = (user: Learner, poll_id: string, option_ids = [2]) => ({ user, poll_id, option_ids });
const start = (from: Learner) => requestChatQuiz(db, from, { kind: 'start' }, now, () => 0);
async function saved(from: Learner, vehicle: 'CAR' | 'MOTORCYCLE' = 'CAR') {
  return db.user.create({ data: { telegramUserId: BigInt(from.id), selectedVehicleType: vehicle, preferredLanguage: 'RUSSIAN', dailyQuestionReminderEnabled: true } });
}
async function current(from: Learner) {
  const user = await db.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(from.id) } });
  return db.chatQuizSession.findUniqueOrThrow({ where: { userId: user.id }, include: { presentation: { include: { answer: true } } } });
}
function transport() {
  const messages: Array<{ chatId: number; text: string; options: unknown }> = [];
  const polls: Array<{ chatId: number; question: string; options: Array<{ text: string }>; other: QuizPollOptions; id: string }> = [];
  let failSend = false;
  let failFeedback = false;
  let malformed = false;
  const api: QuizTransport = {
    sendMessage: vi.fn(async (chatId, text, options) => { if (failFeedback && options?.reply_markup?.inline_keyboard[0]?.[0]?.callback_data.startsWith('cq:n:')) throw new Error('Synthetic feedback failure'); messages.push({ chatId, text, options }); return {}; }),
    sendPhoto: vi.fn(async () => ({})),
    sendPoll: vi.fn(async (chatId, question, options, other) => {
      const id = randomUUID(); polls.push({ chatId, question, options, other, id });
      if (failSend) throw new Error('Synthetic uncertain transport');
      if (malformed) return { message_id: 1, chat: { id: chatId + 1, type: 'private' } };
      return { message_id: polls.length, chat: { id: chatId, type: 'private' }, poll: { id, type: 'quiz', is_anonymous: false, options } };
    }),
  };
  return { api, messages, polls, failSending: () => { failSend = true; }, restore: () => { failSend = false; failFeedback = false; malformed = false; }, failFeedback: () => { failFeedback = true; }, malformed: () => { malformed = true; } };
}
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: isolated.toString() }, stdio: 'pipe', windowsHide: true });
  await db.category.create({ data: { id: categoryId, slug: categoryId, nameThai: 'test', nameEnglish: 'test', nameRussian: 'test' } });
  await db.concept.create({ data: { id: conceptId, slug: conceptId, nameThai: 'test', nameEnglish: 'test', nameRussian: 'test' } });
  for (const vehicleType of ['CAR', 'MOTORCYCLE'] as const) await db.question.create({ data: {
    categoryId, conceptId, vehicleType, active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL',
    textEnglish: `${vehicleType} full English question`, textRussian: 'Только перевод вопроса', explanationEnglish: 'Full explanation\nwith reasoning', trapExplanationEnglish: 'Avoid this misunderstanding',
    choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({ key, textEnglish: `Answer ${key}`, isCorrect: key === 'C' })) },
  } });
});
afterAll(async () => { await db.$disconnect(); await admin.query(`DROP DATABASE "${name}"`); await admin.end(); });

it('selects unset vehicle in chat, reuses the Telegram identity and preserves preferences', async () => {
  const from = learner(); const t = transport(); const service = createChatQuizService(db, t.api, () => now, () => 0);
  await service.command(identity(from));
  expect(t.polls).toHaveLength(0); expect(t.messages.at(-1)?.text).toContain('Choose your vehicle');
  await service.callback(callback(from, 'cq:v:MOTORCYCLE'));
  expect(t.polls[0]?.question).toContain('MOTORCYCLE');
  const user = await db.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(from.id) } });
  expect(user.selectedVehicleType).toBe('MOTORCYCLE'); expect(user.dailyQuestionReminderEnabled).toBe(false);
  await service.callback(callback(from, 'cq:v:CAR'));
  expect((await current(from)).presentationId).toBe((await db.chatQuizSession.findUniqueOrThrow({ where: { userId: user.id } })).presentationId);
  expect(t.polls).toHaveLength(1); expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).selectedVehicleType).toBe('MOTORCYCLE');
});

it.each([true, false])('records correct=%s once, recovers after restart and advances only the current answered presentation', async (correct) => {
  const from = learner(); const user = await saved(from); const t = transport();
  let service = createChatQuizService(db, t.api, () => now, () => 0);
  await Promise.all([service.command(identity(from)), service.command(identity(from))]);
  expect(t.polls).toHaveLength(1);
  const old = await current(from); expect(old.language).toBe('ENGLISH');
  await service.callback(callback(from, `cq:n:${old.presentationId}`)); expect(t.polls).toHaveLength(1);
  expect(t.polls[0]?.other).toMatchObject({ correct_option_ids: [2], allow_adding_options: false });
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } }))).toMatchObject({ preferredLanguage: 'RUSSIAN', dailyQuestionReminderEnabled: true });
  service = createChatQuizService(db, t.api, () => now, () => 0);
  await service.command(identity(from)); expect(t.polls).toHaveLength(1);
  const poll = old.pollId!;
  await Promise.all([service.answer(vote(from, poll, [correct ? 2 : 0])), service.answer(vote(from, poll, [correct ? 2 : 0]))]);
  expect((await current(from)).presentation.answer?.isCorrect).toBe(correct);
  expect(await db.answerAttempt.count({ where: { presentationId: old.presentationId } })).toBe(1);
  expect(await db.conceptLearningState.findUniqueOrThrow({ where: { userId_conceptId: { userId: user.id, conceptId } } })).toMatchObject({ practiceAnswered: 1, practiceCorrect: correct ? 1 : 0, examAnswered: 0 });
  await service.answer(vote(from, poll, [correct ? 0 : 2]));
  expect((await current(from)).presentation.answer?.isCorrect).toBe(correct);
  expect(t.messages.at(-1)?.text).toContain('Full explanation\nwith reasoning');
  const snap = parsePresentationSnapshot(old.presentation.snapshot);
  expect((await current(from)).presentation.answer?.selectedChoiceId).toBe(snap.question.choices[correct ? 2 : 0]?.id);
  await service.command(identity(from)); expect(t.polls).toHaveLength(1);
  await Promise.all([service.callback(callback(from, `cq:n:${old.presentationId}`)), service.callback(callback(from, `cq:n:${old.presentationId}`))]);
  expect(t.polls).toHaveLength(2);
  expect((await current(from)).presentationId).not.toBe(old.presentationId);
  expect(await answerChatQuiz(db, vote(from, poll))).toBeNull();
  expect(await db.questionPresentation.count({ where: { userId: user.id } })).toBe(2);
});

it('ignores foreign, unknown, unbound, stale, retracted and malformed votes without learning writes', async () => {
  const from = learner(); const foreign = learner(); await saved(from); await saved(foreign);
  const first = await start(from); if (first.kind !== 'send') throw new Error('Expected send');
  expect(await answerChatQuiz(db, vote(from, 'unbound'))).toBeNull();
  await bindChatQuiz(db, first.session, { message_id: 2, chat: { id: from.id, type: 'private' }, poll: { id: 'owned-poll', type: 'quiz', is_anonymous: false, options: ['Answer A', 'Answer B', 'Answer C', 'Answer D'].map((text) => ({ text })) } }, from.id, ['Answer A', 'Answer B', 'Answer C', 'Answer D'], now);
  for (const input of [vote(foreign, 'owned-poll'), vote(from, 'unknown'), vote(from, 'owned-poll', []), vote(from, 'owned-poll', [4]), vote(from, 'owned-poll', [0, 1]), { ...vote(from, 'owned-poll'), user: undefined }, { ...vote(from, 'owned-poll'), voter_chat: { id: from.id } }]) expect(await answerChatQuiz(db, input)).toBeNull();
  expect(await db.answerAttempt.count({ where: { presentationId: first.session.presentationId } })).toBe(0);
});

it('makes ambiguous sends explicit replacements and expires claims at the exact lease boundary', async () => {
  const from = learner(); await saved(from); const t = transport(); t.failSending();
  const service = createChatQuizService(db, t.api, () => now, () => 0);
  await service.command(identity(from)); const old = await current(from); expect(old.deliveryState).toBe('UNCERTAIN');
  t.restore(); await service.command(identity(from)); expect(t.polls).toHaveLength(1);
  await service.callback(callback(from, `cq:r:${old.presentationId}`)); expect(t.polls).toHaveLength(2);
  const replacement = await current(from);
  await service.callback(callback(from, `cq:r:${old.presentationId}`)); expect((await current(from)).presentationId).toBe(replacement.presentationId);
  const second = learner(); await saved(second); const claimed = await start(second); if (claimed.kind !== 'send') throw new Error('Expected claim');
  expect((await requestChatQuiz(db, second, { kind: 'start' }, new Date(now.getTime() + CHAT_QUIZ_LEASE_MS - 1))).kind).toBe('busy');
  expect((await requestChatQuiz(db, second, { kind: 'start' }, new Date(now.getTime() + CHAT_QUIZ_LEASE_MS))).kind).toBe('uncertain');
  expect(await db.questionPresentation.count({ where: { userId: claimed.session.userId } })).toBe(1);
});

it('recovers persisted feedback through /quiz after a feedback transport failure', async () => {
  const from = learner(); await saved(from); const t = transport(); let service = createChatQuizService(db, t.api, () => now, () => 0);
  await service.command(identity(from)); const session = await current(from); t.failFeedback();
  await expect(service.answer(vote(from, session.pollId!))).rejects.toThrow('Synthetic feedback failure');
  expect((await current(from)).presentation.answer).not.toBeNull();
  t.restore(); service = createChatQuizService(db, t.api, () => now, () => 0); await service.command(identity(from));
  expect(t.polls).toHaveLength(1); expect(t.messages.at(-1)?.text).toContain('Correct answer: C. Answer C');
});

it('fails closed on malformed send responses and bind uniqueness failures', async () => {
  const from = learner(); await saved(from); const t = transport(); t.malformed();
  await createChatQuizService(db, t.api, () => now, () => 0).command(identity(from));
  expect((await current(from)).deliveryState).toBe('UNCERTAIN');
  const owner = learner(); const other = learner(); await saved(owner); await saved(other);
  const a = await start(owner); const b = await start(other); if (a.kind !== 'send' || b.kind !== 'send') throw new Error('Expected sends');
  const response = (id: number) => ({ message_id: 1, chat: { id, type: 'private' }, poll: { id: 'duplicate-bind', type: 'quiz', is_anonymous: false, options: ['A', 'B', 'C', 'D'].map((text) => ({ text })) } });
  await bindChatQuiz(db, a.session, response(owner.id), owner.id, ['A', 'B', 'C', 'D'], now);
  await expect(bindChatQuiz(db, b.session, response(other.id), other.id, ['A', 'B', 'C', 'D'], now)).rejects.toMatchObject({ code: 'P2002' });
  expect((await current(other)).pollId).toBeNull();
});

it('enforces owned session relationships and rolls back attempt, counters and related transaction writes', async () => {
  const from = learner(); const foreign = learner(); const user = await saved(from); const other = await saved(foreign);
  const result = await start(from); if (result.kind !== 'send') throw new Error('Expected send');
  await expect(db.chatQuizSession.create({ data: { userId: other.id, presentationId: result.session.presentationId, questionId: result.session.questionId, language: 'ENGLISH', deliveryState: 'SENDING', claimedAt: now } })).rejects.toThrow();
  await db.chatQuizSession.delete({ where: { userId: user.id } });
  await expect(db.chatQuizSession.create({ data: { userId: other.id, presentationId: result.session.presentationId, questionId: result.session.questionId, language: 'ENGLISH', deliveryState: 'SENDING', claimedAt: now } })).rejects.toMatchObject({ code: 'P2003' });
  const snapshot = parsePresentationSnapshot(result.session.presentation.snapshot);
  await expect(db.$transaction(async (tx) => {
    await submitPracticeAnswer(tx, user.id, result.session.presentationId, snapshot.correctChoiceId, now);
    await tx.user.update({ where: { id: user.id }, data: { firstName: 'Must roll back' } });
    throw new Error('Synthetic rollback');
  })).rejects.toThrow('Synthetic rollback');
  expect(await db.answerAttempt.count({ where: { presentationId: result.session.presentationId } })).toBe(0);
  expect(await db.conceptLearningState.findUnique({ where: { userId_conceptId: { userId: user.id, conceptId } } })).toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).firstName).toBe('Synthetic');
  // Force accounting overflow: the attempt must roll back when its concept write fails.
  await db.$executeRaw(Prisma.sql`INSERT INTO "ConceptLearningState" ("userId", "conceptId", "practiceAnswered", "practiceCorrect", "lastPracticeAt") VALUES (${user.id}::uuid, ${conceptId}::uuid, 2147483647, 0, ${now})`);
  await expect(db.$transaction((tx) => submitPracticeAnswer(tx, user.id, result.session.presentationId, snapshot.correctChoiceId, now))).rejects.toThrow();
  expect(await db.answerAttempt.count({ where: { presentationId: result.session.presentationId } })).toBe(0);
});

it('uses complete reviewed Russian content and preserves long English context and full feedback', async () => {
  const question = await db.question.findFirstOrThrow({ where: { vehicleType: 'CAR' }, include: { choices: true } });
  try {
    await db.question.update({ where: { id: question.id }, data: { explanationRussian: 'Полное объяснение', trapExplanationRussian: 'Ловушка', choices: { updateMany: { where: {}, data: { textRussian: 'Полный ответ' } } } } });
    const from = learner(); await saved(from); const t = transport();
    const service = createChatQuizService(db, t.api, () => now, () => 0);
    await service.command(identity(from)); expect((await current(from)).language).toBe('RUSSIAN');
    expect(t.polls[0]?.question).toBe('Только перевод вопроса');
    await service.answer(vote(from, (await current(from)).pollId!));
    expect(t.messages.at(-1)?.text).toContain('Полное объяснение'); expect(t.messages.at(-1)?.text).not.toContain('Correct answer');
    const stem = 'Long context '.repeat(400); const option = 'Meaningful choice '.repeat(10); const explanation = 'Full detailed reasoning '.repeat(400);
    await db.question.update({ where: { id: question.id }, data: { textEnglish: stem, explanationEnglish: explanation, explanationRussian: null, choices: { updateMany: { where: {}, data: { textEnglish: option } } } } });
    const next = learner(); await saved(next); const long = transport(); const longService = createChatQuizService(db, long.api, () => now, () => 0);
    await longService.command(identity(next));
    expect(long.polls[0]).toMatchObject({ question: 'Choose the correct answer.', options: ['A', 'B', 'C', 'D'].map((text) => ({ text })) });
    expect(long.polls[0]?.other.explanation).toBeUndefined();
    expect(long.messages.map(({ text }) => text).join('')).toContain(stem);
    expect(long.messages.every(({ text }) => text.length <= 4000)).toBe(true);
    await longService.answer(vote(next, (await current(next)).pollId!));
    expect(long.messages.map(({ text }) => text).join('')).toContain(explanation);
  } finally {
    await db.question.update({ where: { id: question.id }, data: { textEnglish: question.textEnglish, explanationEnglish: question.explanationEnglish, explanationRussian: question.explanationRussian, trapExplanationRussian: question.trapExplanationRussian } });
    for (const choice of question.choices) await db.questionChoice.update({ where: { id: choice.id }, data: { textEnglish: choice.textEnglish, textRussian: choice.textRussian } });
  }
});

it('rejects late binding and unbound old polls after explicit replacement', async () => {
  const from = learner(); const user = await saved(from); const old = await start(from); if (old.kind !== 'send') throw new Error('Expected send');
  const expired = new Date(now.getTime() + CHAT_QUIZ_LEASE_MS);
  expect((await requestChatQuiz(db, from, { kind: 'start' }, expired)).kind).toBe('uncertain');
  const replaced = await requestChatQuiz(db, from, { kind: 'replace', presentationId: old.session.presentationId }, expired, () => 0);
  expect(replaced.kind).toBe('send');
  await expect(bindChatQuiz(db, old.session, { message_id: 1, chat: { id: from.id, type: 'private' }, poll: { id: 'late-poll', type: 'quiz', is_anonymous: false, options: ['A', 'B', 'C', 'D'].map((text) => ({ text })) } }, from.id, ['A', 'B', 'C', 'D'], expired)).rejects.toThrow('claim expired or changed');
  expect(await answerChatQuiz(db, vote(from, 'late-poll'))).toBeNull();
  expect(await db.questionPresentation.count({ where: { userId: user.id } })).toBe(2);
  expect(await db.answerAttempt.count({ where: { presentation: { userId: user.id } } })).toBe(0);
});

it('uses the immutable mapping after source edits and rejects retired questions', async () => {
  const from = learner(); await saved(from); const t = transport(); const service = createChatQuizService(db, t.api, () => now, () => 0);
  await service.command(identity(from)); const session = await current(from);
  const source = await db.question.findUniqueOrThrow({ where: { id: session.questionId }, include: { choices: true } });
  try {
    await db.questionChoice.updateMany({ where: { questionId: source.id }, data: { isCorrect: false, textEnglish: 'Changed after presentation' } });
    await db.questionChoice.update({ where: { id: source.choices.find(({ key }) => key === 'A')!.id }, data: { isCorrect: true } });
    await service.answer(vote(from, session.pollId!));
    expect((await current(from)).presentation.answer?.isCorrect).toBe(true);
  } finally {
    for (const choice of source.choices) await db.questionChoice.update({ where: { id: choice.id }, data: { textEnglish: choice.textEnglish, isCorrect: choice.isCorrect } });
  }
  const retired = learner(); await saved(retired); const retiredTransport = transport(); const retiredService = createChatQuizService(db, retiredTransport.api, () => now, () => 0);
  await retiredService.command(identity(retired)); const old = await current(retired);
  try {
    await db.question.update({ where: { id: source.id }, data: { active: false } });
    expect(await answerChatQuiz(db, vote(retired, old.pollId!))).toBeNull();
    await retiredService.command(identity(retired)); expect((await current(retired)).deliveryState).toBe('UNCERTAIN');
    expect(await db.answerAttempt.count({ where: { presentationId: old.presentationId } })).toBe(0);
  } finally { await db.question.update({ where: { id: source.id }, data: { active: true } }); }
});

it('fails safely before claiming and durably recovers a rolled-back received vote after restart', async () => {
  const from = learner(); const user = await saved(from); const t = transport(); const service = createChatQuizService(db, t.api, () => now, () => 0);
  await service.command(identity(from)); const session = await current(from);
  const transaction = vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('Synthetic pre-claim outage'));
  await expect(service.answer(vote(from, session.pollId!))).rejects.toBeInstanceOf(UnclaimedQuizAnswerError);
  transaction.mockRestore();
  expect((await current(from)).deliveryState).toBe('BOUND');
  await db.$executeRaw(Prisma.sql`INSERT INTO "ConceptLearningState" ("userId", "conceptId", "practiceAnswered", "practiceCorrect", "lastPracticeAt") VALUES (${user.id}::uuid, ${conceptId}::uuid, 2147483647, 0, ${now})`);
  await expect(service.answer(vote(from, session.pollId!))).rejects.toThrow();
  expect((await current(from)).deliveryState).toBe('ANSWERING');
  expect(await db.answerAttempt.count({ where: { presentationId: session.presentationId } })).toBe(0);
  expect((await start(from)).kind).toBe('busy');
  const expired = new Date(now.getTime() + CHAT_QUIZ_LEASE_MS);
  const restarted = createChatQuizService(db, t.api, () => expired, () => 0);
  await restarted.command(identity(from)); expect((await current(from)).deliveryState).toBe('UNCERTAIN');
  await restarted.callback(callback(from, `cq:r:${session.presentationId}`)); expect(t.polls).toHaveLength(2);
  expect(await answerChatQuiz(db, vote(from, session.pollId!))).toBeNull();
});

it('recovers committed results ahead of uncertainty without another credit', async () => {
  const from = learner(); const user = await saved(from); const t = transport(); const service = createChatQuizService(db, t.api, () => now, () => 0);
  await service.command(identity(from)); const session = await current(from);
  await service.answer(vote(from, session.pollId!));
  await db.chatQuizSession.update({ where: { userId: user.id }, data: { deliveryState: 'UNCERTAIN', pollId: null, messageId: null } });
  await service.command(identity(from)); expect(t.messages.at(-1)?.text).toContain('Correct answer');
  await service.callback(callback(from, `cq:r:${session.presentationId}`)); expect(t.polls).toHaveLength(1);
  expect(await db.conceptLearningState.findUniqueOrThrow({ where: { userId_conceptId: { userId: user.id, conceptId } } })).toMatchObject({ practiceAnswered: 1, practiceCorrect: 1 });
});

async function installTeachingQuestion() {
  const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as unknown;
  const inputs = validateTeachingInputs({
    pack: read('content/imports/launch-20261023-bilingual-teaching.json'), review: read('.agent/reviews/TASK-084-content-review-01.json'),
    car: read('content/imports/launch-20261016-car-candidates.json'), motorcycle: read('content/imports/launch-20261016-motorcycle-candidates.json'),
    stems: read('content/imports/launch-20261021-russian-stems.json'),
  });
  const mapped = mapCandidateQuestion(inputs.car, inputs.car.questions[0]!, categoryId, conceptId);
  const entry = inputs.pack.entries.find((item) => item.batchId === inputs.car.batchId && item.externalId === inputs.car.questions[0]!.externalId)!;
  const row = await db.question.create({ data: { ...mapped.question, active: true, verificationStatus: 'VERIFIED', textRussian: entry.textRussian, choices: { create: mapped.choices.map(({ id, key, textThai, textEnglish, textRussian, isCorrect }) => ({ id, key, textThai, textEnglish, textRussian, isCorrect })) } } });
  const candidates = await db.question.findMany({ where: { vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED' }, orderBy: { id: 'asc' } });
  return { row, offset: candidates.findIndex(({ id }) => id === row.id) };
}

it('sends accepted bilingual cards and complete personal teaching, recovering a failed send through /quiz and Next',async()=>{
  const {row,offset}=await installTeachingQuestion();const from=learner();const user=await saved(from);const t=transport();
  const service=createChatQuizService(db,t.api,()=>now,()=>offset);
  try{
    await service.command(identity(from));const session=await current(from);const snapshot=parsePresentationSnapshot(session.presentation.snapshot);
    expect(snapshot.teaching).toBeDefined();expect(t.polls[0]?.options.map(({text})=>text)).toEqual(['A','B','C','D']);
    expect(t.polls[0]?.question).toBe('Choose the correct answer.');expect(t.polls[0]?.other.explanation).toBeUndefined();
    const preanswer=t.messages.map(({text})=>text).join('');
    expect(preanswer).toContain(snapshot.question.textEnglish);expect(preanswer).toContain(snapshot.question.textRussian);
    expect(preanswer).not.toContain(snapshot.teaching!.safetyReasonEnglish);expect(preanswer).not.toContain(snapshot.teaching!.guidanceCitation);
    const correctIndex=snapshot.question.choices.findIndex(({id})=>id===snapshot.correctChoiceId);
    const send=vi.spyOn(t.api,'sendMessage').mockRejectedValueOnce(new Error('Synthetic rich feedback failure'));
    await expect(service.answer(vote(from,session.pollId!,[correctIndex]))).rejects.toThrow('Synthetic rich feedback failure');send.mockRestore();
    expect((await current(from)).presentation.answer?.isCorrect).toBe(true);
    const before=t.messages.length;await createChatQuizService(db,t.api,()=>now,()=>offset).command(identity(from));
    const expected=richQuizChunks(quizFeedbackText(snapshot,true,session.language));
    expect(t.messages.slice(before).map(({text})=>text)).toEqual(expected.map(({text})=>text));
    for(const [index,sent] of t.messages.slice(before).entries())expect(sent.options).toMatchObject({entities:expected[index]!.entities,link_preview_options:{is_disabled:true}});
    expect(t.messages.at(-1)?.options).toMatchObject({reply_markup:{inline_keyboard:[[{text:'Next question',callback_data:`cq:n:${session.presentationId}`}]]}});
    expect(await db.answerAttempt.count({where:{presentationId:session.presentationId}})).toBe(1);
    expect(await db.user.findUniqueOrThrow({where:{id:user.id}})).toMatchObject({preferredLanguage:'RUSSIAN',dailyQuestionReminderEnabled:true});
    await service.callback(callback(from,`cq:n:${session.presentationId}`));expect(t.polls).toHaveLength(2);
  }finally{await db.question.update({where:{id:row.id},data:{active:false}});}
});
