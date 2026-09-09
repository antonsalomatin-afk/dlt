import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fetch, { Response } from 'node-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createBot } from '../apps/bot/src/bot.ts';
import { readBotConfig } from '../apps/bot/src/config.ts';
import { runBot } from '../apps/bot/src/lifecycle.ts';

const environment = { BOT_TOKEN: '123456:synthetic_token_for_tests_only', MINI_APP_URL: 'https://example.com/mini-app' };
const botInfo = { id: 123456, is_bot: true as const, first_name: 'ThaiDLT', username: 'thaidlt_test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('bot entry', () => {
  it.each(['private', 'group', 'supergroup'] as const)('handles %s /start through mocked transport', async (type) => {
    const requests: unknown[] = [];
    const transport = Object.assign(vi.fn(async (...[, options]: Parameters<typeof fetch>) => {
      if (typeof options?.body !== 'string') throw new Error('Expected JSON payload');
      const body: unknown = JSON.parse(options.body);
      requests.push(body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 2, date: 0, chat: { id: 42, type }, text: 'Mock reply' } }), { headers: { 'content-type': 'application/json' } });
    }), fetch);
    const bot = createBot(environment, { botInfo, client: { fetch: transport } });
    expect(transport).not.toHaveBeenCalled();
    const chat = type === 'private' ? { id: 42, type, first_name: 'Test' } : { id: 42, type, title: 'Test group' };
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0, chat, from: { id: 42, is_bot: false, first_name: 'Test' }, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] } });
    expect(requests).toHaveLength(1);
    if (type === 'private') expect(requests[0]).toMatchObject({ chat_id: 42, reply_markup: { inline_keyboard: [[{ text: 'Open ThaiDLT', web_app: { url: environment.MINI_APP_URL } }]] } });
    else {
      expect(requests[0]).toMatchObject({ text: expect.stringContaining('private chat') });
      expect(requests[0]).not.toHaveProperty('reply_markup');
    }
  });
  it.each([
    {}, { ...environment, BOT_TOKEN: 'secret-invalid' }, { ...environment, MINI_APP_URL: '' },
    { ...environment, MINI_APP_URL: 'http://example.com' }, { ...environment, MINI_APP_URL: 'https://user:secret@example.com' },
  ])('rejects invalid config without exposing values (%#)', (invalid) => {
    expect(() => readBotConfig(invalid)).toThrow();
    try { readBotConfig(invalid); } catch (error) { expect(String(error)).not.toContain('secret'); }
  });
  it('exits nonzero on missing server configuration without a network call', () => {
    const result = spawnSync(process.execPath, ['apps/bot/src/main.ts'], {
      env: { ...process.env, BOT_TOKEN: '', MINI_APP_URL: '' }, encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Bot startup or polling failed');
  });
});

describe('graceful lifecycle', () => {
  it('stops once on repeated signals, waits for completion and removes handlers', async () => {
    const signals = new EventEmitter();
    const polling = deferred();
    const started = deferred();
    const bot = { init: vi.fn(async () => {}), start: vi.fn(() => { started.resolve(); return polling.promise; }), isRunning: () => true,
      stop: vi.fn(async () => { polling.resolve(); }) };
    const run = runBot(bot, signals);
    await started.promise;
    signals.emit('SIGINT'); signals.emit('SIGTERM');
    await run;
    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
  it('cancels initialization without starting polling', async () => {
    const signals = new EventEmitter();
    const bot = { init: (signal?: Parameters<ReturnType<typeof createBot>['init']>[0]) => new Promise<void>((_resolve, reject) => { signal?.addEventListener('abort', () => reject(new Error('Cancelled'))); }), start: vi.fn(async () => {}), stop: vi.fn(async () => {}), isRunning: () => false };
    const run = runBot(bot, signals);
    signals.emit('SIGTERM');
    await run;
    expect(bot.start).not.toHaveBeenCalled();
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
});
