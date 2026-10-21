import { InlineKeyboard } from 'grammy';
import { prepareQuestionPost } from './question-post.ts';
import type { QuestionPostConfig } from './config.ts';
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
import {
  claimSummaryDelivery,
  getSummaryMetrics,
  markSummaryDeliveryFailed,
  markSummaryDeliverySent,
  summaryMessages,
  summaryPeriodForTick,
  type SummaryPeriod,
} from '../../../packages/database/src/summary.ts';

type ReminderDatabase = Pick<PrismaClient, 'answerAttempt' | 'dailyReminderDelivery' | 'reminderSummaryDelivery' | 'user'>;
type ReminderApi = {
  sendMessage(chatId: string, text: string, options: { reply_markup: InlineKeyboard }): Promise<unknown>;
};
type QuestionPostOptions = { config: Extract<QuestionPostConfig, { enabled: true }>; database: Parameters<typeof prepareQuestionPost>[0];
  sendPhoto(chatId: string, image: string, options: { caption: string; reply_markup: InlineKeyboard }): Promise<unknown>;
};

export type ReminderScheduler = {
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
};

type SchedulerOptions = {
  database: ReminderDatabase;
  api: ReminderApi;
  miniAppUrl: string;
  questionPosts?: QuestionPostOptions;
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

  const deliverSummary = async (
    recipient: { id: string; telegramUserId: bigint; preferredLanguage: 'ENGLISH' | 'RUSSIAN' | 'THAI' },
    period: SummaryPeriod,
    instant: Date,
  ) => {
    let claim;
    try {
      claim = await claimSummaryDelivery(options.database, recipient.id, period, instant);
    } catch {
      console.error('Summary delivery claim failed.');
      return;
    }
    if (!claim.claimed) return;
    let metrics;
    try {
      metrics = await getSummaryMetrics(options.database, recipient.id, period);
    } catch {
      try { await markSummaryDeliveryFailed(options.database, claim.deliveryId, now()); }
      catch { console.error('Summary failure recording failed.'); }
      console.error('Summary metrics failed.');
      return;
    }
    try {
      await options.api.sendMessage(recipient.telegramUserId.toString(), summaryMessages(recipient.preferredLanguage, period.summaryType, metrics), {
        reply_markup: new InlineKeyboard().webApp('Open ThaiDLT', options.miniAppUrl),
      });
    } catch {
      try { await markSummaryDeliveryFailed(options.database, claim.deliveryId, now()); }
      catch { console.error('Summary failure recording failed.'); }
      console.error('Summary delivery failed.');
      return;
    }
    try {
      const confirmed = await markSummaryDeliverySent(options.database, claim.deliveryId, now());
      if (!confirmed) console.error('Summary confirmation failed.');
    } catch {
      console.error('Summary confirmation failed.');
    }
  };

  const runTick = async () => {
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
    const periods = summaryPeriodForTick(instant);
    for (const recipient of recipients) {
      if (!running) return;
      let claim;
      try {
        claim = await claimReminderDelivery(options.database, recipient.id, localDate, instant);
      } catch {
        console.error('Daily reminder claim failed.');
        claim = { claimed: false, deliveryId: '' };
      }
      if (claim.claimed) {
        let delivered = false;
        try {
          let post: Awaited<ReturnType<typeof prepareQuestionPost>> = null;
          if (options.questionPosts) {
            try { post = await prepareQuestionPost(options.questionPosts.database, recipient.id, instant, options.questionPosts.config); }
            catch { console.error('Daily question preparation failed; using training invitation.'); }
          }
          if (post) {
            const reply_markup = new InlineKeyboard().url('Answer / Ответить', post.url);
            if (post.image && options.questionPosts) {
              await options.questionPosts.sendPhoto(recipient.telegramUserId.toString(), post.image, { caption: post.text, reply_markup });
            } else {
              await options.api.sendMessage(recipient.telegramUserId.toString(), post.text, { reply_markup });
            }
          } else {
            await options.api.sendMessage(recipient.telegramUserId.toString(), reminderMessages[recipient.preferredLanguage], {
              reply_markup: new InlineKeyboard().webApp('Open ThaiDLT', options.miniAppUrl),
            });
          }
          delivered = true;
        } catch {
          try { await markReminderDeliveryFailed(options.database, claim.deliveryId, now()); }
          catch { console.error('Daily reminder failure recording failed.'); }
          console.error('Daily reminder delivery failed.');
        }
        if (delivered) {
          try {
            const confirmed = await markReminderDeliverySent(options.database, claim.deliveryId, now());
            if (!confirmed) console.error('Daily reminder confirmation failed.');
          } catch {
            console.error('Daily reminder confirmation failed.');
          }
        }
      }
      await deliverSummary(recipient, periods.daily, instant);
      if (periods.weekly) await deliverSummary(recipient, periods.weekly, instant);
    }
  };

  const tick = async () => {
    if (!running || activeTick) return;
    const current = runTick().catch(() => { console.error('Daily reminder tick failed.'); });
    activeTick = current;
    try { await current; }
    finally {
      if (activeTick === current) activeTick = undefined;
    }
  };

  const scheduleTick = () => {
    if (!running || activeTick) return;
    void tick();
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
