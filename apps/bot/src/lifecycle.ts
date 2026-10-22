import { AbortController } from 'abort-controller';
import type { Bot } from 'grammy';
import { UnclaimedQuizAnswerError } from '../../../packages/database/src/chat-quiz.ts';

type Signals = {
  on(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
  off(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
};
type PollingBot = Pick<Bot, 'init' | 'start' | 'stop' | 'isRunning'>;
type Scheduler = { start(): void; stop(): Promise<void> };

/**
 * Install before handlers: grammY stop() also sends an acknowledging getUpdates.
 * Its simple poller processes returned batches sequentially. Pending/failed IDs
 * remain barriers even if an injected caller delivers updates concurrently.
 */
export function protectPollingAcknowledgements(bot: Bot) {
  let highestCompletedId = 0;
  const pending = new Set<number>();
  const failed = new Set<number>();
  bot.api.config.use((previous, method, payload, signal) => {
    if (method !== 'getUpdates') return previous(method, payload, signal);
    const requested = 'offset' in payload && typeof payload.offset === 'number' && Number.isSafeInteger(payload.offset) && payload.offset >= 0 ? payload.offset : 0;
    let offset = Math.min(requested, highestCompletedId + 1);
    for (const id of pending) offset = Math.min(offset, id);
    for (const id of failed) offset = Math.min(offset, id);
    return previous(method, Object.assign({}, payload, { offset }), signal);
  });
  bot.use(async (context, next) => {
    const id = context.update.update_id;
    const validId = Number.isSafeInteger(id) && id > 0 && id < Number.MAX_SAFE_INTEGER;
    if (validId) pending.add(id);
    let safe = true;
    try { await next(); }
    catch (error) {
      safe = !(error instanceof UnclaimedQuizAnswerError);
      if (!safe && validId) failed.add(id);
      throw error;
    }
    finally {
      if (validId) {
        pending.delete(id);
        if (safe) { highestCompletedId = Math.max(highestCompletedId, id); failed.delete(id); }
      }
    }
  });
}

/** Waits for polling and pending middleware to finish, and removes signal handlers. */
export async function runBot(bot: PollingBot, signals: Signals = process, scheduler?: Scheduler) {
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let stopFailed = false;
  let schedulerStop: Promise<void> | undefined;
  const initialization = new AbortController();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    initialization.abort();
    if (scheduler) schedulerStop = scheduler.stop().catch(() => { stopFailed = true; });
    if (bot.isRunning()) stopPromise = bot.stop().catch(() => { stopFailed = true; });
  };
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  try {
    try { await bot.init(initialization.signal); } catch (error) {
      if (stopping) return;
      throw error;
    }
    if (!stopping) {
      scheduler?.start();
      await bot.start({ allowed_updates: ['message', 'callback_query', 'poll_answer'] });
    }
  } finally {
    try {
      await stopPromise;
      if (schedulerStop) await schedulerStop;
      else if (scheduler) await scheduler.stop();
    } finally {
      signals.off('SIGINT', stop);
      signals.off('SIGTERM', stop);
    }
  }
  if (stopFailed) throw new Error('Bot shutdown failed.');
}
