import { EventEmitter } from 'node:events';
import fetch, { Response } from 'node-fetch';
import { z } from 'zod';
import { createBot } from '../apps/bot/src/bot.ts';
import { configureBotErrors, registerChatQuiz } from '../apps/bot/src/chat-quiz.ts';
import { runBot } from '../apps/bot/src/lifecycle.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabaseClient, Prisma } from '../packages/database/src/index.ts';
import { requestGroupQuiz, bindGroupQuiz, bindGroupControl, answerGroupQuiz, groupQuizResults, invalidateMigratedGroup, type GroupRound } from '../packages/database/src/group-chat-quiz.ts';
import { CHAT_QUIZ_LEASE_MS, requestChatQuiz, UnclaimedQuizAnswerError } from '../packages/database/src/chat-quiz.ts';
import { createGroupQuizService, type GroupQuizTransport } from '../apps/bot/src/group-chat-quiz.ts';
import { parsePresentationSnapshot } from '../packages/database/src/presentation.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

const url = process.env.DATABASE_URL; parseDatabaseUrl(url);
const admin = new pg.Client({ connectionString: url }); const name = `group_quiz_test_${randomBytes(8).toString('hex')}`;
const isolated = new URL(url!); isolated.pathname = `/${name}`; const db = createDatabaseClient(isolated.toString());
const categoryId = randomUUID(); const conceptId = randomUUID(); const now = new Date('2026-10-22T10:00:00Z');
let nextId = 99000; let nextChat = -90000;
const person = () => ({ id: nextId++, is_bot: false as const, first_name: 'Synthetic' });
const scope = (threadId = 0) => ({ telegramChatId: nextChat--, threadId });
type Person = ReturnType<typeof person>; type Scope = ReturnType<typeof scope>;
function transport() {
  const messages: Array<{ chatId: number; text: string; options: unknown }> = []; const polls: Array<{ id: string; chatId: number; question: string; options: Array<{ text: string }>; other: unknown }> = [];
  const statuses = new Map<number, string>(); let sendFailure = false; let stopFailure = false; let membershipFailure = false; let malformed = false; let count = 0;
  const api: GroupQuizTransport = {
    getChatMember: vi.fn(async (_chatId, userId) => { if (membershipFailure) throw new Error('Synthetic membership outage'); return { user: { id: userId }, status: statuses.get(userId) ?? (userId === 123 ? 'administrator' : 'member') }; }),
    sendMessage: vi.fn(async (chatId, text, options) => { messages.push({ chatId, text, options }); return { message_id: ++count, chat: { id: chatId, type: 'supergroup' }, ...(options.message_thread_id ? { message_thread_id: options.message_thread_id } : {}) }; }),
    sendPhoto: vi.fn(async () => ({})),
    stopPoll: vi.fn(async () => { if (stopFailure) throw new Error('Synthetic stop outage'); return {}; }),
    sendPoll: vi.fn(async (chatId, question, options, other) => { const id = randomUUID(); polls.push({ id, chatId, question, options, other }); if (sendFailure) throw new Error('Synthetic delivery outage'); return { message_id: ++count, chat: { id: malformed ? chatId-1 : chatId, type: 'supergroup' }, ...(other.message_thread_id ? { message_thread_id: other.message_thread_id } : {}), poll: { id, type: 'quiz', is_anonymous: false, options } }; }),
  };
  return { api, messages, polls, statuses, failSend: () => { sendFailure = true; }, restore: () => { sendFailure = false; stopFailure = false; membershipFailure = false; malformed = false; }, failStop: () => { stopFailure = true; }, failMembership: () => { membershipFailure = true; }, malformed: () => { malformed = true; } };
}
const command = (from: Person, key: Scope) => ({ from, chat: { id: key.telegramChatId, type: 'supergroup' }, ...(key.threadId ? { message_thread_id: key.threadId } : {}) });
async function current(key: Scope) { const pointer = await db.groupQuizScope.findUniqueOrThrow({ where: { telegramChatId_threadId: key } }); return db.groupQuizRound.findUniqueOrThrow({ where: { id: pointer.currentRoundId! }, include: { question: { select: { active: true, verificationStatus: true } }, initiator: { select: { telegramUserId: true } } } }); }
function service(t: ReturnType<typeof transport>, instant = now) { return createGroupQuizService(db, t.api, () => 123, () => instant, () => 0); }
async function click(s: ReturnType<typeof service>, actor: Person, key: Scope, action: 'f'|'n'|'r', suppliedRound?: GroupRound) { const round = suppliedRound ?? await current(key); await s.callback({ id: 'callback', from: actor, message: { message_id: round.controlMessageId!, chat: { id: key.telegramChatId, type: 'supergroup' }, from: { id: 123, is_bot: true }, ...(key.threadId ? { message_thread_id: key.threadId } : {}) }, data: `gq1:${action}:${round.id}` }); }
const vote = (user: Person, poll_id: string, option_ids = [2]) => ({ user, poll_id, option_ids });

beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js','--config','packages/database/prisma.config.ts','migrate','deploy'], { env: { ...process.env, DATABASE_URL: isolated.toString() }, stdio: 'pipe', windowsHide: true });
  await db.category.create({ data: { id: categoryId, slug: categoryId, nameThai: 'test', nameEnglish: 'test', nameRussian: 'test' } });
  await db.concept.create({ data: { id: conceptId, slug: conceptId, nameThai: 'test', nameEnglish: 'test', nameRussian: 'test' } });
  for (const vehicleType of ['CAR','MOTORCYCLE'] as const) await db.question.create({ data: { categoryId, conceptId, vehicleType, active: true, verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL', textEnglish: `${vehicleType} full question`, textRussian: 'Stem only', explanationEnglish: 'Complete explanation', trapExplanationEnglish: 'Avoid the trap', choices: { create: (['A','B','C','D'] as const).map((key) => ({ key, textEnglish: `Answer ${key}`, isCorrect: key === 'C' })) } } });
});
afterAll(async () => { await db.$disconnect(); await admin.query(`DROP DATABASE "${name}"`); await admin.end(); });

it('shares one poll, credits distinct real voters once and preserves all personal preferences/private state', async () => {
  const starter = person(); const second = person(); const key = scope(8); const t = transport(); const s = service(t);
  const user = await db.user.create({ data: { telegramUserId: BigInt(starter.id), selectedVehicleType: 'MOTORCYCLE', preferredLanguage: 'RUSSIAN', dailyQuestionReminderEnabled: true } });
  await requestChatQuiz(db, starter, { kind: 'start' }, now, () => 0); const privateBefore = await db.chatQuizSession.findUniqueOrThrow({ where: { userId: user.id } });
  await Promise.all([s.command(command(starter,key)),s.command(command(second,key))]);
  expect(t.polls).toHaveLength(1); const round = await current(key); expect(round.vehicleType).toBe('CAR');
  const beforeVotes = t.messages.length;
  await Promise.all([s.answer(vote(starter,round.pollId!)),s.answer(vote(second,round.pollId!,[0])),s.answer(vote(starter,round.pollId!))]);
  await s.answer(vote(starter,round.pollId!,[0]));
  expect(t.messages).toHaveLength(beforeVotes); expect(await groupQuizResults(db,round)).toEqual({ answered: 2, correct: 1 });
  const votes = await db.groupQuizVote.findMany({ where: { roundId: round.id }, include: { presentation: { include: { answer: true } } } });
  expect(new Set(votes.map(({ presentationId }) => presentationId)).size).toBe(2);
  for (const recorded of votes) { expect(recorded.presentation.snapshot).toEqual(round.snapshot); expect(recorded.presentation.answer).not.toBeNull(); const state = await db.conceptLearningState.findUniqueOrThrow({ where: { userId_conceptId: { userId: recorded.userId, conceptId } } }); expect(state.practiceAnswered).toBe(1); }
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ selectedVehicleType: 'MOTORCYCLE', preferredLanguage: 'RUSSIAN', dailyQuestionReminderEnabled: true });
  expect(await db.chatQuizSession.findUniqueOrThrow({ where: { userId: user.id } })).toEqual(privateBefore);
  expect(t.messages.every(({ chatId }) => chatId === key.telegramChatId)).toBe(true);
});

it('isolates chats/topics, validates group commands and uses motorcycle only for an idle round', async () => {
  const a = person(); const t = transport(); const s = service(t); const key = scope(7); const other = { ...key, threadId: 8 };
  await s.command(command(a,key),'motorcycle'); await s.command(command(a,other),'car'); await s.command(command(a,scope()),'boat');
  expect(t.polls).toHaveLength(2); expect((await current(key)).vehicleType).toBe('MOTORCYCLE'); expect((await current(other)).vehicleType).toBe('CAR');
  await s.command(command(a,key),'car'); expect(t.polls).toHaveLength(2); expect((await current(key)).vehicleType).toBe('MOTORCYCLE');
  const r = await current(key); await s.answer(vote(a,r.pollId!)); await s.callback({ id:'x',from:a,message:{message_id:r.controlMessageId,chat:{id:key.telegramChatId,type:'supergroup'},message_thread_id:8,from:{id:123,is_bot:true}},data:`gq1:f:${r.id}` });
  expect((await current(key)).deliveryState).toBe('BOUND');
});

it('requires bot administration and current membership without writing for nonmembers/anonymous/invalid votes', async () => {
  const a = person(); const foreign = person(); const key = scope(); const t = transport(); const s = service(t);
  t.statuses.set(123,'member'); await s.command(command(a,key)); expect(t.polls).toHaveLength(0); expect(t.messages.at(-1)?.text).toContain('administrator');
  t.statuses.set(123,'administrator'); await s.command(command(a,key)); const round = await current(key);
  t.statuses.set(foreign.id,'left'); expect(await s.answer(vote(foreign,round.pollId!))).toBe(true);
  for (const invalid of [vote(a,round.pollId!,[]),vote(a,round.pollId!,[0,1]),vote(a,round.pollId!,[4]),{ ...vote(a,round.pollId!),voter_chat:{ id:key.telegramChatId } },{ ...vote(a,round.pollId!),user:undefined }]) expect(await s.answer(invalid)).toBe(false);
  expect(await groupQuizResults(db,round)).toEqual({ answered:0,correct:0 });
  t.failMembership(); await expect(s.answer(vote(a,round.pollId!))).rejects.toBeInstanceOf(UnclaimedQuizAnswerError); t.restore();
  const lookup = vi.spyOn(db.groupQuizRound,'findUnique').mockRejectedValueOnce(new Error('Synthetic lookup failure'));
  await expect(s.answer(vote(a,round.pollId!))).rejects.toBeInstanceOf(UnclaimedQuizAnswerError); lookup.mockRestore();
  t.statuses.set(123,'member'); await s.answer(vote(a,round.pollId!)); expect(await groupQuizResults(db,round)).toEqual({ answered:0,correct:0 });
});

it('finishes deliberately, recovers full feedback after stop failure and makes Next one-shot', async () => {
  const a=person(); const b=person(); const key=scope(); const t=transport(); let s=service(t);
  await s.command(command(a,key)); const round=await current(key);
  await click(s,a,key,'f'); expect((await current(key)).deliveryState).toBe('BOUND');
  await s.answer(vote(a,round.pollId!)); await click(s,b,key,'f'); expect((await current(key)).deliveryState).toBe('BOUND');
  t.failStop(); await click(s,a,key,'f'); expect((await current(key)).deliveryState).toBe('CLOSED'); expect(t.messages.map(({text})=>text).join('')).toContain('Complete explanation');
  await s.answer(vote(b,round.pollId!)); expect(await groupQuizResults(db,round)).toEqual({answered:1,correct:1});
  t.restore(); s=service(t); await s.command(command(a,key)); const closed=await current(key);
  expect(t.polls).toHaveLength(1); expect(t.messages.at(-2)?.text).toContain('Correct: 100%');
  await Promise.all([click(s,a,key,'n',closed),click(s,a,key,'n',closed)]); expect(t.polls).toHaveLength(2);
  await click(s,a,key,'n',closed); expect(t.polls).toHaveLength(2);
});

it('permits a current administrator but rejects stale, copied and foreign control messages', async () => {
  const a=person();const b=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);await s.answer(vote(b,r.pollId!));
  await s.callback({id:'x',from:a,message:{message_id:r.controlMessageId!+1,chat:{id:key.telegramChatId,type:'group'},from:{id:123,is_bot:true}},data:`gq1:f:${r.id}`});expect((await current(key)).deliveryState).toBe('BOUND');
  t.statuses.set(a.id,'left');await click(s,a,key,'f');expect((await current(key)).deliveryState).toBe('BOUND');
  t.statuses.set(b.id,'administrator');await click(s,b,key,'f');expect((await current(key)).deliveryState).toBe('CLOSED');
});

it('preserves uncertain delivery and only accepts explicit current replacement after exact lease expiry', async () => {
  const a=person();const key=scope();const t=transport();t.failSend();let s=service(t);await s.command(command(a,key));const old=await current(key);expect(old.deliveryState).toBe('UNCERTAIN');
  t.restore();await s.command(command(a,key));expect(t.polls).toHaveLength(1);await click(s,a,key,'r');expect(t.polls).toHaveLength(2);expect(await s.answer(vote(a,t.polls[0]!.id))).toBe(false);
  const waiting=scope(); const claimed=await requestGroupQuiz(db,waiting,a,{kind:'start'},false,now,()=>0);if(claimed.kind!=='send')throw new Error('Expected sending');
  expect((await requestGroupQuiz(db,waiting,a,{kind:'start'},false,new Date(now.getTime()+CHAT_QUIZ_LEASE_MS-1))).kind).toBe('busy');
  expect((await requestGroupQuiz(db,waiting,a,{kind:'start'},false,new Date(now.getTime()+CHAT_QUIZ_LEASE_MS))).kind).toBe('uncertain');
  await expect(bindGroupQuiz(db,claimed.round,{message_id:1,chat:{id:waiting.telegramChatId,type:'group'},poll:{id:'late',type:'quiz',is_anonymous:false,options:['A','B','C','D'].map(text=>({text}))}},['A','B','C','D'],new Date(now.getTime()+CHAT_QUIZ_LEASE_MS))).rejects.toThrow();
  s=service(t);await s.command(command(a,key));expect(t.polls).toHaveLength(2);
});

it('fails closed on wrong delivery scope and mismatched control results', async () => {
  const a=person();const key=scope(6);const t=transport();t.malformed();const s=service(t);await s.command(command(a,key));const r=await current(key);expect(r.deliveryState).toBe('UNCERTAIN');
  await expect(bindGroupControl(db,r,{message_id:1,chat:{id:key.telegramChatId,type:'supergroup'}})).rejects.toThrow('mismatch');
  expect(await answerGroupQuiz(db,r,vote(a,t.polls[0]!.id))).toBeNull();
});

it('rolls back all vote/attempt/counter writes on accounting failure and replays safely', async () => {
  const a=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);const user=await db.user.findUniqueOrThrow({where:{telegramUserId:BigInt(a.id)}});
  await db.$executeRaw(Prisma.sql`INSERT INTO "ConceptLearningState" ("userId","conceptId","practiceAnswered","practiceCorrect","lastPracticeAt") VALUES (${user.id}::uuid,${conceptId}::uuid,2147483647,0,${now})`);
  await expect(s.answer(vote(a,r.pollId!))).rejects.toBeInstanceOf(UnclaimedQuizAnswerError);
  expect(await db.groupQuizVote.count({where:{roundId:r.id}})).toBe(0);expect(await db.questionPresentation.count({where:{userId:user.id}})).toBe(0);
  await db.conceptLearningState.update({where:{userId_conceptId:{userId:user.id,conceptId}},data:{practiceAnswered:0,lastPracticeAt:null}});
  await service(t).answer(vote(a,r.pollId!));await service(t).answer(vote(a,r.pollId!));expect(await groupQuizResults(db,r)).toEqual({answered:1,correct:1});
});

it('scores immutable mapping, rejects retired questions and invalidates migrated group capabilities', async () => {
  const a=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);const source=await db.question.findUniqueOrThrow({where:{id:r.questionId},include:{choices:true}});
  try { await db.questionChoice.updateMany({where:{questionId:source.id},data:{isCorrect:false}});await db.questionChoice.update({where:{id:source.choices.find(c=>c.key==='A')!.id},data:{isCorrect:true}});await s.answer(vote(a,r.pollId!));expect(await groupQuizResults(db,r)).toEqual({answered:1,correct:1});
    await db.question.update({where:{id:source.id},data:{active:false}});await s.answer(vote(person(),r.pollId!));expect(await groupQuizResults(db,r)).toEqual({answered:1,correct:1});await s.command(command(a,key));expect((await current(key)).deliveryState).toBe('UNCERTAIN');
  } finally { await db.question.update({where:{id:source.id},data:{active:true}});for(const c of source.choices)await db.questionChoice.update({where:{id:c.id},data:{isCorrect:c.isCorrect}}); }
  const moved=scope();await s.command(command(a,moved));const old=await current(moved);await invalidateMigratedGroup(db,moved.telegramChatId,now);await s.answer(vote(a,old.pollId!));expect(await groupQuizResults(db,old)).toEqual({answered:0,correct:0});
  expect((await db.groupQuizRound.findUniqueOrThrow({where:{id:old.id}})).deliveryState).toBe('CLOSED');
});

it('enforces scope, owned presentation, question pairing and one-vote uniqueness constraints', async () => {
  const a=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);await s.answer(vote(a,r.pollId!));const v=await db.groupQuizVote.findFirstOrThrow({where:{roundId:r.id}});
  await expect(db.groupQuizScope.create({data:{telegramChatId:42,threadId:0}})).rejects.toThrow();
  const other=scope();await s.command(command(a,other));const r2=await current(other);
  await db.groupQuizScope.update({where:{telegramChatId_threadId:other},data:{currentRoundId:null}});
  await expect(db.groupQuizScope.update({where:{telegramChatId_threadId:key},data:{currentRoundId:r2.id}})).rejects.toMatchObject({code:'P2003'});
  await expect(db.groupQuizRound.update({where:{id:r.id},data:{messageId:null}})).rejects.toThrow();
  const b=person();const user=await db.user.create({data:{telegramUserId:BigInt(b.id)}});
  await expect(db.groupQuizVote.create({data:{...v,userId:user.id}})).rejects.toThrow();
  const wrong=await db.question.findFirstOrThrow({where:{id:{not:r.questionId}}});const snap=parsePresentationSnapshot(r.snapshot);
  const presentation=await db.questionPresentation.create({data:{userId:user.id,questionId:wrong.id,snapshot:snap}});
  await expect(db.groupQuizVote.create({data:{roundId:r.id,userId:user.id,questionId:wrong.id,presentationId:presentation.id}})).rejects.toMatchObject({code:'P2003'});
});

it('rolls back a failure after the counter write and serializes finish against another participant vote',async()=>{
  const a=person();const b=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);
  await db.$executeRaw(Prisma.sql`CREATE FUNCTION group_quiz_test_fail_counter() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic after-counter failure'; END $$`);
  await db.$executeRaw(Prisma.sql`CREATE TRIGGER group_quiz_test_counter AFTER INSERT OR UPDATE ON "ConceptLearningState" FOR EACH ROW EXECUTE FUNCTION group_quiz_test_fail_counter()`);
  try { await expect(s.answer(vote(a,r.pollId!))).rejects.toBeInstanceOf(UnclaimedQuizAnswerError);expect(await db.groupQuizVote.count({where:{roundId:r.id}})).toBe(0);expect(await db.answerAttempt.count({where:{presentation:{questionId:r.questionId,user:{telegramUserId:BigInt(a.id)}}}})).toBe(0);const user=await db.user.findUniqueOrThrow({where:{telegramUserId:BigInt(a.id)}});expect(await db.conceptLearningState.findUnique({where:{userId_conceptId:{userId:user.id,conceptId}}})).toBeNull(); }
  finally { await db.$executeRaw(Prisma.sql`DROP TRIGGER group_quiz_test_counter ON "ConceptLearningState"`);await db.$executeRaw(Prisma.sql`DROP FUNCTION group_quiz_test_fail_counter()`); }
  await s.answer(vote(a,r.pollId!));await Promise.all([s.answer(vote(b,r.pollId!)),click(s,a,key,'f')]);
  const result=await groupQuizResults(db,r);expect([1,2]).toContain(result.answered);expect(result.correct).toBe(result.answered);expect((await current(key)).deliveryState).toBe('CLOSED');
  await s.answer(vote(person(),r.pollId!));expect(await groupQuizResults(db,r)).toEqual(result);
});

function deferred(){let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
it.each(['SIGTERM','SIGINT'] as const)('%s retains pending successful group scoring and replay gives one real credit',async(signal)=>{
  const a=person();const key=scope();const t=transport();await service(t).command(command(a,key));const r=await current(key);
  const entered=deferred();const release=deferred();const stopFetch=deferred();const acknowledged=deferred();let pending=true;let firstMembership=true;let requests=0;const offsets:number[]=[];
  const update={update_id:41,poll_answer:{poll_id:r.pollId!,user:a,option_ids:[2],option_persistent_ids:['c']}};
  const info={id:123456,is_bot:true as const,first_name:'Test',username:'test_bot',can_join_groups:true,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false,has_topics_enabled:false,allows_users_to_create_topics:false,can_manage_bots:false,supports_join_request_queries:false};
  const injected=Object.assign(vi.fn(async(...[url,options]:Parameters<typeof fetch>)=>{
    const method=String(url).split('/').at(-1)!;let result:unknown=true;
    if(method==='getUpdates'){const payload=z.object({offset:z.number().optional()}).parse(JSON.parse(String(options?.body)));const offset=payload.offset??0;offsets.push(offset);if(offset>41){pending=false;acknowledged.resolve();}result=pending?[update]:[];requests++;if(requests===2)stopFetch.resolve();}
    if(method==='getChatMember'){if(firstMembership){firstMembership=false;entered.resolve();await release.promise;}const payload=z.object({user_id:z.number()}).parse(JSON.parse(String(options?.body)));result={user:{id:payload.user_id},status:payload.user_id===info.id?'administrator':'member'};}
    return new Response(JSON.stringify({ok:true,result}),{headers:{'content-type':'application/json'}});
  }),fetch);
  const build=()=>{const bot=createBot({BOT_TOKEN:'123456:synthetic_token_for_tests_only',MINI_APP_URL:'https://example.com'},{botInfo:info,client:{fetch:injected}});registerChatQuiz(bot,db);configureBotErrors(bot);return bot;};
  const signals=new EventEmitter();const running=runBot(build(),signals);await entered.promise;signals.emit(signal);await stopFetch.promise;expect(offsets.every(offset=>offset<=41)).toBe(true);expect(await groupQuizResults(db,r)).toEqual({answered:0,correct:0});release.resolve();await running;expect(await groupQuizResults(db,r)).toEqual({answered:1,correct:1});
  const restartedSignals=new EventEmitter();const restarted=runBot(build(),restartedSignals);await acknowledged.promise;restartedSignals.emit(signal);await restarted;expect(await groupQuizResults(db,r)).toEqual({answered:1,correct:1});expect(pending).toBe(false);
});


it('terminal bot removal or missing voter does not poison polling; rate limits still retry',async()=>{
  const a=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);
  const error=async(error_code:number,description:string)=>{ const injected=Object.assign(vi.fn(async()=>new Response(JSON.stringify({ok:false,error_code,description}),{headers:{'content-type':'application/json'}})),fetch); const bot=createBot({BOT_TOKEN:'123456:synthetic_token_for_tests_only',MINI_APP_URL:'https://example.com'},{client:{fetch:injected}});try{await bot.api.getChatMember(key.telegramChatId,a.id);}catch(failure){return failure;}throw new Error('Expected API failure'); };
  const lookup=vi.spyOn(t.api,'getChatMember').mockRejectedValueOnce(await error(403,'Forbidden: bot was kicked from the supergroup chat'));
  expect(await s.answer(vote(a,r.pollId!))).toBe(true);
  lookup.mockResolvedValueOnce({user:{id:123},status:'administrator'}).mockRejectedValueOnce(await error(400,'Bad Request: user not found'));expect(await s.answer(vote(a,r.pollId!))).toBe(true);
  lookup.mockRejectedValueOnce(await error(429,'Too Many Requests: retry after 1'));await expect(s.answer(vote(a,r.pollId!))).rejects.toBeInstanceOf(UnclaimedQuizAnswerError);lookup.mockRestore();
  expect(await groupQuizResults(db,r)).toEqual({answered:0,correct:0});
});


it('switches vehicle only by explicit authorized closed-round command and never replaces an open round',async()=>{
  const a=person();const b=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);await s.answer(vote(a,r.pollId!));await click(s,a,key,'f');
  await s.command(command(b,key),'motorcycle');expect(t.polls).toHaveLength(1);expect((await current(key)).id).toBe(r.id);
  await s.command(command(a,key));expect(t.polls).toHaveLength(1);
  await Promise.all([s.command(command(a,key),'motorcycle'),s.command(command(a,key),'motorcycle')]);expect(t.polls).toHaveLength(2);const second=await current(key);expect(second.vehicleType).toBe('MOTORCYCLE');
  await s.command(command(a,key),'car');expect((await current(key)).id).toBe(second.id);expect(t.polls).toHaveLength(2);
  await s.answer(vote(a,second.pollId!));await click(s,a,key,'f');t.statuses.set(b.id,'administrator');await s.command(command(b,key),'car');expect((await current(key)).vehicleType).toBe('CAR');expect(t.polls).toHaveLength(3);
});

it('recovers a closed round after explanation transport failure without recrediting',async()=>{
  const a=person();const key=scope();const t=transport();const s=service(t);await s.command(command(a,key));const r=await current(key);await s.answer(vote(a,r.pollId!));
  const send=vi.spyOn(t.api,'sendMessage').mockRejectedValueOnce(new Error('Synthetic explanation failure'));await expect(click(s,a,key,'f')).rejects.toThrow('Synthetic explanation failure');expect((await current(key)).deliveryState).toBe('CLOSED');
  send.mockRestore();await service(t).command(command(a,key));expect(t.messages.map(({text})=>text).join('')).toContain('Complete explanation');expect(await groupQuizResults(db,r)).toEqual({answered:1,correct:1});expect(t.polls).toHaveLength(1);
});
