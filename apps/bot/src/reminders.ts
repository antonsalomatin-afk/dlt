import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  claimReminderDelivery,
  isReminderTick,
  listReminderRecipients,
  markReminderDeliveryFailed,
  markReminderDeliverySent,
  reminderMessages,
  thailandReminderLocalDate,
  REMINDER_INTERVAL_MS,
} from '../../../packages/database/src/reminder-delivery.ts';
import type { PrismaClient } from '../../../packages/database/src/index.ts';

type ReminderDatabase = Pick<PrismaClient, 'dailyReminderDelivery' | 'user'>;
type ReminderApi = Pick<Api, 'sendMessage'>;

export type ReminderScheduler = {
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
};

type SchedulerOptions = {
  database: ReminderDatabase;
  api: ReminderApi;
  miniAppUrl: string;
  now?: () => Date;
  setInterval?: (handler: () => void, timeout: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  intervalMs?: number;
};

export function createReminderScheduler(options: SchedulerOptions): ReminderScheduler {
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setInterval ?? ((handler, timeout) => setInterval(handler, timeout));
  const clearIntervalFn = options.clearInterval ?? ((handle) => clearInterval(handle));
  const intervalMs = options.intervalMs ?? REMINDER_INTERVAL_MS;
  let running = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let activeTick: Promise<void> | undefined;

  const tick = async () => {
    if (!running || !isReminderTick(now())) return;
    const instant = now();
    let recipients;
    try {
      recipients = await listReminderRecipients(options.database);
    } catch {
      console.error('Daily reminder selection failed.');
      return;
    }
    const localDate = thailandReminderLocalDate(instant);
    for (const recipient of recipients) {
      if (!running) return;
      let claim;
      try {
        claim = await claimReminderDelivery(options.database, recipient.id, localDate, instant);
      } catch {
        console.error('Daily reminder claim failed.');
        continue;
      }
      if (!claim.claimed) continue;
      try {
        await options.api.sendMessage(recipient.telegramUserId.toString(), reminderMessages[recipient.preferredLanguage], {
          reply_markup: new InlineKeyboard().webApp('Open ThaiDLT', options.miniAppUrl),
        });
      } catch {
        try { await markReminderDeliveryFailed(options.database, claim.deliveryId, now()); }
        catch { console.error('Daily reminder failure recording failed.'); }
        console.error('Daily reminder delivery failed.');
        continue;
      }
      try {
        const confirmed = await markReminderDeliverySent(options.database, claim.deliveryId, now());
        if (!confirmed) console.error('Daily reminder confirmation failed.');
      } catch {
        console.error('Daily reminder confirmation failed.');
      }
    }
  };

  const scheduleTick = () => {
    if (!running) return;
    activeTick = tick().catch(() => { console.error('Daily reminder tick failed.'); });
  };

  return {
    start() {
      if (running) return;
      running = true;
      scheduleTick();
      interval = setIntervalFn(scheduleTick, intervalMs);
    },
    async stop() {
      if (!running && !activeTick) return;
      running = false;
      if (interval !== undefined) {
        clearIntervalFn(interval);
        interval = undefined;
      }
      await activeTick;
      activeTick = undefined;
    },
    tick,
  };
}
