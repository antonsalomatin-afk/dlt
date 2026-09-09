import { AbortController } from 'abort-controller';
import type { Bot } from 'grammy';

type Signals = {
  on(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
  off(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
};
type PollingBot = Pick<Bot, 'init' | 'start' | 'stop' | 'isRunning'>;

/** Waits for polling and pending middleware to finish, and removes signal handlers. */
export async function runBot(bot: PollingBot, signals: Signals = process) {
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let stopFailed = false;
  const initialization = new AbortController();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    initialization.abort();
    if (bot.isRunning()) stopPromise = bot.stop().catch(() => { stopFailed = true; });
  };
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  try {
    try { await bot.init(initialization.signal); } catch (error) {
      if (stopping) return;
      throw error;
    }
    if (!stopping) await bot.start();
    await stopPromise;
    if (stopFailed) throw new Error('Bot shutdown failed.');
  } finally {
    signals.off('SIGINT', stop);
    signals.off('SIGTERM', stop);
  }
}
