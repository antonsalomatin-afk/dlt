import { EventEmitter } from 'node:events';
import fetch, { Response } from 'node-fetch';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createBot } from '../apps/bot/src/bot.ts';
import { configureBotErrors } from '../apps/bot/src/chat-quiz.ts';
import { runBot } from '../apps/bot/src/lifecycle.ts';
import { UnclaimedQuizAnswerError } from '../packages/database/src/chat-quiz.ts';

const environment = { BOT_TOKEN: '123456:synthetic_token_for_tests_only', MINI_APP_URL: 'https://example.com' };
const botInfo = { id: 123456, is_bot: true as const, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };
type Update = Parameters<ReturnType<typeof createBot>['handleUpdate']>[0];
const vote = (update_id: number): Update => ({ update_id, poll_answer: { poll_id: `poll-${update_id}`, user: { id: 42, is_bot: false, first_name: 'Test' }, option_ids: [2], option_persistent_ids: ['synthetic-choice-c'] } });
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Model Telegram's irreversible acknowledgement when getUpdates offset passes an ID. */
function telegram(updates: Update[]) {
  let pending = [...updates];
  const offsets: number[] = [];
  const firstFetch = deferred();
  const stopFetch = deferred();
  const acknowledged = deferred();
  const transport = Object.assign(vi.fn(async (...[url, options]: Parameters<typeof fetch>) => {
    const method = String(url).split('/').at(-1);
    let result: boolean | Update[] = true;
    if (method === 'getUpdates') {
      if (typeof options?.body !== 'string') throw new Error('Synthetic transport expected JSON');
      const payload: unknown = JSON.parse(options.body);
      const { offset = 0 } = z.object({ offset: z.number().int().nonnegative().optional() }).parse(payload);
      offsets.push(offset);
      pending = pending.filter(({ update_id }) => update_id >= offset);
      result = [...pending];
      if (offset > 41) acknowledged.resolve();
      if (offsets.length === 1) firstFetch.resolve();
      if (offsets.length === 2) stopFetch.resolve();
    }
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  }), fetch);
  const bot = () => {
    const instance = createBot(environment, { botInfo, client: { fetch: transport } });
    configureBotErrors(instance);
    return instance;
  };
  return { bot, offsets, firstFetch, stopFetch, acknowledged, pendingIds: () => pending.map(({ update_id }) => update_id) };
}

it.each(['SIGTERM', 'SIGINT'] as const)('%s cannot acknowledge a pending failed first claim; restart receives the complete batch', async (signal) => {
  const server = telegram([vote(41), vote(42)]);
  const entered = deferred(); const release = deferred(); const cleaned = deferred();
  const signals = new EventEmitter(); const bot = server.bot();
  const attempted: number[] = [];
  bot.on('poll_answer', async (context) => { attempted.push(context.update.update_id); entered.resolve(); await release.promise; throw new UnclaimedQuizAnswerError(); });
  const scheduler = { start: vi.fn(), stop: vi.fn(() => cleaned.promise) };
  let settled = false;
  const result = runBot(bot, signals, scheduler).catch((error: unknown) => error).finally(() => { settled = true; });
  await entered.promise;
  signals.emit(signal); signals.emit(signal);
  // Observe stop's actual transport request before failing the suspended transaction.
  await server.stopFetch.promise;
  expect(server.offsets.every((offset) => offset <= 41)).toBe(true);
  expect(server.pendingIds()).toEqual([41, 42]);
  release.resolve(); await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  cleaned.resolve();
  expect(await result).toBeInstanceOf(UnclaimedQuizAnswerError);
  expect(attempted).toEqual([41]);
  expect(scheduler.stop).toHaveBeenCalledTimes(1);
  expect(signals.listenerCount(signal)).toBe(0);
  const restarted = server.bot(); const restartSignals = new EventEmitter(); const processed: number[] = [];
  restarted.on('poll_answer', (context) => { processed.push(context.update.update_id); });
  const restart = runBot(restarted, restartSignals);
  await server.acknowledged.promise;
  restartSignals.emit(signal);
  await restart;
  expect(processed).toEqual([41, 42]);
  expect(server.pendingIds()).toEqual([]);
});

it.each(['SIGTERM', 'SIGINT'] as const)('%s preserves successful claims during shutdown and acknowledges completed replay', async (signal) => {
  const server = telegram([vote(41)]); const entered = deferred(); const release = deferred();
  const signals = new EventEmitter(); const bot = server.bot(); let credits = 0;
  bot.on('poll_answer', async () => { entered.resolve(); await release.promise; credits++; });
  const run = runBot(bot, signals);
  await entered.promise; signals.emit(signal); await server.stopFetch.promise;
  expect(server.pendingIds()).toEqual([41]);
  release.resolve(); await run;
  expect(credits).toBe(1);
  const restarted = server.bot(); const restartSignals = new EventEmitter(); let recovered = 0;
  restarted.on('poll_answer', () => { recovered++; });
  const replay = runBot(restarted, restartSignals);
  await server.acknowledged.promise; restartSignals.emit(signal); await replay;
  expect(recovered).toBe(1); expect(credits).toBe(1); expect(server.pendingIds()).toEqual([]);
});

it('keeps post-claim feedback errors recoverable without fatal polling and stops an idle poll normally', async () => {
  const server = telegram([vote(41)]); const bot = server.bot(); const signals = new EventEmitter();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let committed = false;
  bot.on('poll_answer', () => { committed = true; throw new Error('Synthetic feedback transport failure'); });
  try {
    const run = runBot(bot, signals);
    await server.acknowledged.promise; signals.emit('SIGTERM'); await run;
    expect(committed).toBe(true); expect(server.pendingIds()).toEqual([]);
    expect(log).toHaveBeenCalledExactlyOnceWith('Bot update failed.');
  } finally { log.mockRestore(); }
  const idle = telegram([]); const idleSignals = new EventEmitter();
  const run = runBot(idle.bot(), idleSignals);
  await idle.firstFetch.promise; idleSignals.emit('SIGINT'); await run;
  expect(idle.offsets).toEqual([1, 1]);
  expect(idleSignals.listenerCount('SIGINT')).toBe(0);
});

it('keeps unfinished and fatal IDs as acknowledgement barriers across concurrently injected updates', async () => {
  const server = telegram([vote(41), vote(42)]); const bot = server.bot(); const entered = deferred(); const release = deferred();
  let fail = true;
  bot.on('poll_answer', async (context) => {
    if (context.update.update_id === 41 && fail) { entered.resolve(); await release.promise; throw new UnclaimedQuizAnswerError(); }
  });
  const pending = bot.handleUpdate(vote(41)).catch((error: unknown) => error);
  await entered.promise; await bot.handleUpdate(vote(42));
  await bot.api.getUpdates({ offset: 43 });
  expect(server.pendingIds()).toEqual([41, 42]);
  release.resolve(); await pending;
  await bot.api.getUpdates({ offset: 43 });
  expect(server.pendingIds()).toEqual([41, 42]);
  fail = false; await bot.handleUpdate(vote(41));
  await bot.api.getUpdates({ offset: 43 });
  expect(server.pendingIds()).toEqual([]);
});
