import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fetch, { Response } from 'node-fetch';
import { expect, it, vi } from 'vitest';
import { createBot } from '../apps/bot/src/bot.ts';
import { configureBotErrors, registerChatQuiz } from '../apps/bot/src/chat-quiz.ts';
import { createGroupQuizService, groupCommandSchema, parseGroupMembership, isDefinitiveMembershipDenial, type GroupQuizTransport } from '../apps/bot/src/group-chat-quiz.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { groupScopeSchema, groupSentQuizSchema } from '../packages/database/src/group-chat-quiz.ts';
import { UnclaimedQuizAnswerError } from '../packages/database/src/chat-quiz.ts';
import { runBot } from '../apps/bot/src/lifecycle.ts';
import { z } from 'zod';

const environment={BOT_TOKEN:'123456:synthetic_token_for_tests_only',MINI_APP_URL:'https://example.com'};
const botInfo={id:123456,is_bot:true as const,first_name:'Test',username:'test_bot',can_join_groups:true,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false,has_topics_enabled:false,allows_users_to_create_topics:false,can_manage_bots:false,supports_join_request_queries:false};
const actor={id:42,is_bot:false as const,first_name:'Test'};
const database=()=>createDatabaseClient('postgresql://test:test@127.0.0.1:19999/test');
const api=():GroupQuizTransport=>({getChatMember:vi.fn(),sendMessage:vi.fn(),sendPoll:vi.fn(),sendPhoto:vi.fn()});
function deferred(){let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}

it('validates negative chat scopes, positive topics and real users independently',()=>{
  expect(groupScopeSchema.safeParse({telegramChatId:-100123,threadId:0}).success).toBe(true);
  for(const telegramChatId of [0,42,-(2**52),NaN,-1.5])expect(groupScopeSchema.safeParse({telegramChatId,threadId:0}).success).toBe(false);
  for(const threadId of [-1,1.5,2**31])expect(groupScopeSchema.safeParse({telegramChatId:-42,threadId}).success).toBe(false);
  for(const changed of [{sender_chat:{id:-42}},{forward_origin:{}},{from:{...actor,is_bot:true}},{chat:{id:42,type:'private'}},{chat:{id:-42,type:'channel'}}])expect(groupCommandSchema.safeParse({from:actor,chat:{id:-42,type:'group'},...changed}).success).toBe(false);
  expect(groupSentQuizSchema.safeParse({message_id:1,chat:{id:42,type:'private'}}).success).toBe(false);
});

it.each(['creator','administrator','member','restricted','left','kicked'])('checks %s membership without accepting mismatched API identities',(status)=>{
  expect(parseGroupMembership({user:{id:42},status,is_member:true},42).member).toBe(!['left','kicked'].includes(status));
  if(status==='restricted')expect(parseGroupMembership({user:{id:42},status,is_member:false},42).member).toBe(false);
  expect(()=>parseGroupMembership({user:{id:43},status},42)).toThrow('identity mismatch');
});

it('rejects malformed or foreign-scope inputs before using storage/transport',async()=>{
  const db=database();const transaction=vi.spyOn(db,'$transaction');const transport=api();const s=createGroupQuizService(db,transport,()=>123456);
  for(const input of [{from:actor,chat:{id:42,type:'group'}},{from:actor,chat:{id:-42,type:'channel'}},{from:actor,chat:{id:-42,type:'group'},sender_chat:{id:-42}}])await s.command(input);
  for(const data of ['gq1:f:bad','gq1:z:'+randomUUID()])await s.callback({id:'x',from:actor,data,message:{message_id:1,from:{id:123456,is_bot:true},chat:{id:-42,type:'group'}}});
  await s.callback({id:'x',from:actor,data:'gq1:f:'+randomUUID(),message:{message_id:1,from:{id:654321,is_bot:true},chat:{id:-42,type:'group'}}});
  expect(transaction).not.toHaveBeenCalled();expect(transport.getChatMember).not.toHaveBeenCalled();await db.$disconnect();
});

it('routes actual /quiz@bot suffix into group setup and keeps private-only fallback separate',async()=>{
  const db=database();const commands:string[]=[];
  const transport=Object.assign(vi.fn(async(...[url]:Parameters<typeof fetch>)=>{const method=String(url).split('/').at(-1)!;commands.push(method);const result=method==='getChatMember'?{user:{id:123456},status:'member'}:{message_id:1,chat:{id:-42,type:'group'}};return new Response(JSON.stringify({ok:true,result}),{headers:{'content-type':'application/json'}});}),fetch);
  const bot=createBot(environment,{botInfo,client:{fetch:transport}});registerChatQuiz(bot,db);
  await bot.handleUpdate({update_id:1,message:{message_id:1,date:1,from:actor,chat:{id:-42,type:'group',title:'Synthetic'},text:'/quiz@test_bot',entities:[{type:'bot_command',offset:0,length:14}]}});
  expect(commands).toEqual(['getChatMember','sendMessage']);await db.$disconnect();
});

it.each(['SIGTERM','SIGINT'] as const)('%s retains a real routed group vote during pending membership failure and retries after restart',async(signal)=>{
  const db=database();const roundId=randomUUID();
  const binding={id:roundId,telegramChatId:BigInt(-42),threadId:0,deliveryState:'BOUND',pollId:'group-poll',initiatorId:randomUUID(),questionId:randomUUID(),conceptId:null,snapshot:{},vehicleType:'CAR' as const,language:'ENGLISH' as const,claimedAt:new Date(),messageId:1,controlMessageId:2,createdAt:new Date(),closedAt:null};
  // No real DB is needed here: suspend the actual group service at Telegram membership,
  // after the durable-binding lookup and before any scoring transaction.
  const lookup=vi.spyOn(db.groupQuizRound,'findUnique').mockResolvedValue(binding);
  const entered=deferred();const release=deferred();const stopFetch=deferred();let pending=true;let failing=true;let updates=0;const offsets:number[]=[];
  const vote={update_id:41,poll_answer:{poll_id:'group-poll',user:actor,option_ids:[2],option_persistent_ids:['c']}};
  const transport=Object.assign(vi.fn(async(...[url,options]:Parameters<typeof fetch>)=>{
    const method=String(url).split('/').at(-1)!;let result:unknown=true;
    if(method==='getUpdates'){const payload=z.object({offset:z.number().optional()}).parse(JSON.parse(String(options?.body)));const offset=payload.offset??0;offsets.push(offset);if(offset>41)pending=false;result=pending?[vote]:[];updates++;if(updates===2)stopFetch.resolve();}
    if(method==='getChatMember'){if(failing){entered.resolve();await release.promise;return new Response(JSON.stringify({ok:false,error_code:503,description:'Synthetic membership outage'}),{headers:{'content-type':'application/json'}});}result={user:{id:123456},status:'member'};}
    return new Response(JSON.stringify({ok:true,result}),{headers:{'content-type':'application/json'}});
  }),fetch);
  const build=()=>{const bot=createBot(environment,{botInfo,client:{fetch:transport}});registerChatQuiz(bot,db);configureBotErrors(bot);return bot;};
  try{const signals=new EventEmitter();const result=runBot(build(),signals).catch((error:unknown)=>error);await entered.promise;signals.emit(signal);await stopFetch.promise;expect(offsets.every(offset=>offset<=41)).toBe(true);expect(pending).toBe(true);release.resolve();expect(await result).toBeInstanceOf(UnclaimedQuizAnswerError);
    failing=false;const restartSignals=new EventEmitter();const bot=build();const acknowledged=deferred();bot.api.config.use(async(previous,method,payload,abort)=>{const response=await previous(method,payload,abort);if(method==='getUpdates'&&'offset'in payload&&typeof payload.offset==='number'&&payload.offset>41)acknowledged.resolve();return response;});const restarted=runBot(bot,restartSignals);await acknowledged.promise;restartSignals.emit(signal);await restarted;expect(pending).toBe(false);
  }finally{lookup.mockRestore();await db.$disconnect();}
});


it('classifies only explicit Telegram membership denials as terminal',async()=>{
  const error=async(error_code:number,description:string)=>{
    const transport=Object.assign(vi.fn(async()=>new Response(JSON.stringify({ok:false,error_code,description}),{headers:{'content-type':'application/json'}})),fetch);
    const bot=createBot(environment,{botInfo,client:{fetch:transport}});
    try{await bot.api.getChatMember(-42,42);}catch(failure){return failure;}throw new Error('Expected API error');
  };
  expect(isDefinitiveMembershipDenial(await error(403,'Forbidden: bot was kicked from the supergroup chat'))).toBe(true);
  expect(isDefinitiveMembershipDenial(await error(400,'Bad Request: user not found'))).toBe(true);
  for(const value of [await error(429,'Too Many Requests: retry after 1'),await error(503,'Unavailable'),await error(400,'Bad Request: unexpected future error'),new Error('Network error'),{error_code:403,description:'Forbidden: bot was kicked from the supergroup chat'}])expect(isDefinitiveMembershipDenial(value)).toBe(false);
});

it('routes private polls after a negative group binding and never consumes a failed group lookup',async()=>{
  const db=database();const bot=createBot(environment,{botInfo});registerChatQuiz(bot,db);
  const lookup=vi.spyOn(db.groupQuizRound,'findUnique').mockResolvedValueOnce(null);
  const transaction=vi.spyOn(db,'$transaction').mockRejectedValueOnce(new Error('Synthetic private preclaim failure'));
  const update={update_id:51,poll_answer:{poll_id:'private-poll',user:actor,option_ids:[2],option_persistent_ids:['c']}};
  await expect(bot.handleUpdate(update)).rejects.toMatchObject({error:expect.any(UnclaimedQuizAnswerError)});expect(transaction).toHaveBeenCalledTimes(1);
  lookup.mockRejectedValueOnce(new Error('Synthetic group namespace outage'));
  await expect(bot.handleUpdate({...update,update_id:52})).rejects.toMatchObject({error:expect.any(UnclaimedQuizAnswerError)});expect(transaction).toHaveBeenCalledTimes(1);
  lookup.mockRestore();transaction.mockRestore();await db.$disconnect();
});
