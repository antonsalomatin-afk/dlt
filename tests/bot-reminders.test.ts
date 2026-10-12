import { describe, expect, it, vi } from 'vitest';
import {
  createReminderScheduler,
} from '../apps/bot/src/reminders.ts';
import {
  isReminderTick,
  reminderMessages,
  thailandReminderLocalDate,
} from '../packages/database/src/reminder-delivery.ts';

type Recipient = {
  id: string;
  telegramUserId: bigint;
  preferredLanguage: 'ENGLISH' | 'RUSSIAN' | 'THAI';
  dailyQuestionReminderEnabled: boolean;
  completedDailyQuestion: boolean;
};

function fakeDatabase(recipients: Recipient[], options: { failSentConfirmation?: boolean } = {}) {
  const rows = new Map<string, { id: string; status: 'CLAIMED' | 'SENT' | 'FAILED'; attempts: number }>();
  let nextId = 1;
  return {
    user: {
      findMany: vi.fn(async ({ where }: { where: { dailyQuestionReminderEnabled: boolean } }) =>
        recipients.filter(({ dailyQuestionReminderEnabled }) => dailyQuestionReminderEnabled === where.dailyQuestionReminderEnabled)),
    },
    dailyReminderDelivery: {
      findUnique: vi.fn(async ({ where }: { where: { userId_localDate: { userId: string; localDate: Date } } }) => {
        const row = rows.get(`${where.userId_localDate.userId}:${where.userId_localDate.localDate.toISOString()}`);
        return row ? { id: row.id, status: row.status } : null;
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; localDate: Date; status: 'CLAIMED'; attempts: number } }) => {
        const key = `${data.userId}:${data.localDate.toISOString()}`;
        if (rows.has(key)) throw new Error('P2002');
        const row = { id: `delivery-${nextId++}`, status: data.status, attempts: data.attempts };
        rows.set(key, row);
        return { id: row.id };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: 'CLAIMED' | 'FAILED' }; data: { status: 'CLAIMED' | 'SENT' | 'FAILED'; attempts?: { increment: number } } }) => {
        const row = [...rows.values()].find((candidate) => candidate.id === where.id && candidate.status === where.status);
        if (!row || (data.status === 'SENT' && options.failSentConfirmation)) return { count: 0 };
        row.status = data.status;
        if (data.attempts) row.attempts += data.attempts.increment;
        return { count: 1 };
      }),
    },
    rows,
  };
}

describe('daily reminder clock policy', () => {
  it('uses fixed UTC+07:00 boundaries and local dates', () => {
    expect(isReminderTick(new Date('2026-10-11T03:59:59.000Z'))).toBe(false);
    expect(isReminderTick(new Date('2026-10-11T04:00:00.000Z'))).toBe(true);
    expect(isReminderTick(new Date('2026-10-11T04:00:59.000Z'))).toBe(true);
    expect(isReminderTick(new Date('2026-10-11T04:01:00.000Z'))).toBe(false);
    expect(thailandReminderLocalDate(new Date('2026-10-11T16:59:59.000Z'))).toBe('2026-10-11');
    expect(thailandReminderLocalDate(new Date('2026-10-11T17:00:00.000Z'))).toBe('2026-10-12');
  });
});

describe('daily reminder scheduler', () => {
  it('sends one localized further-training invitation with the exact Mini App button', async () => {
    const database = fakeDatabase([
      { id: '550e8400-e29b-41d4-a716-446655440000', telegramUserId: 761001n, preferredLanguage: 'ENGLISH', dailyQuestionReminderEnabled: true, completedDailyQuestion: false },
      { id: '550e8400-e29b-41d4-a716-446655440001', telegramUserId: 761002n, preferredLanguage: 'RUSSIAN', dailyQuestionReminderEnabled: true, completedDailyQuestion: false },
      { id: '550e8400-e29b-41d4-a716-446655440002', telegramUserId: 761003n, preferredLanguage: 'THAI', dailyQuestionReminderEnabled: true, completedDailyQuestion: true },
      { id: '550e8400-e29b-41d4-a716-446655440003', telegramUserId: 761004n, preferredLanguage: 'THAI', dailyQuestionReminderEnabled: false, completedDailyQuestion: false },
    ]);
    const sendMessage = vi.fn(async (chatId: string, message: string, options: unknown) => {
      void chatId; void message; void options;
      return undefined;
    });
    const scheduler = createReminderScheduler({
      database: database as unknown as Parameters<typeof createReminderScheduler>[0]['database'],
      api: { sendMessage } as unknown as Parameters<typeof createReminderScheduler>[0]['api'],
      miniAppUrl: 'https://example.com/app',
      now: () => new Date('2026-10-11T04:00:00.000Z'),
      intervalMs: 60_000,
    });

    scheduler.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await scheduler.stop();
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage.mock.calls.map(([chatId, message]) => [chatId, message])).toEqual([
      ['761001', reminderMessages.ENGLISH],
      ['761002', reminderMessages.RUSSIAN],
      ['761003', reminderMessages.THAI],
    ]);
    expect(sendMessage.mock.calls[2]?.[1]).not.toMatch(/unfinished|not completed/i);
    expect(sendMessage.mock.calls[0]?.[2]).toEqual({
      reply_markup: { inline_keyboard: [[{ text: 'Open ThaiDLT', web_app: { url: 'https://example.com/app' } }]] },
    });
    expect(database.user.findMany).toHaveBeenCalledWith({ where: { dailyQuestionReminderEnabled: true }, select: { id: true, telegramUserId: true, preferredLanguage: true } });
    scheduler.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await scheduler.stop();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('isolates a failed send, records it for retry, and stops cleanly', async () => {
    const database = fakeDatabase([
      { id: '550e8400-e29b-41d4-a716-446655440011', telegramUserId: 761002n, preferredLanguage: 'ENGLISH', dailyQuestionReminderEnabled: true, completedDailyQuestion: false },
      { id: '550e8400-e29b-41d4-a716-446655440012', telegramUserId: 761003n, preferredLanguage: 'RUSSIAN', dailyQuestionReminderEnabled: true, completedDailyQuestion: false },
    ]);
    let failed = true;
    const sendMessage = vi.fn(async (chatId: string) => {
      if (chatId === '761002' && failed) { failed = false; throw new Error('transport'); }
    });
    const intervalHandle = setInterval(() => undefined, 1_000_000);
    const interval = vi.fn(() => intervalHandle);
    const clearInterval = vi.fn();
    const scheduler = createReminderScheduler({
      database: database as unknown as Parameters<typeof createReminderScheduler>[0]['database'],
      api: { sendMessage } as unknown as Parameters<typeof createReminderScheduler>[0]['api'],
      miniAppUrl: 'https://example.com/app',
      now: () => new Date('2026-10-11T04:00:00.000Z'),
      setInterval: interval,
      clearInterval,
    });

    scheduler.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await scheduler.stop();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(database.rows.get('550e8400-e29b-41d4-a716-446655440011:2026-10-11T00:00:00.000Z')?.status).toBe('FAILED');
    expect(database.rows.get('550e8400-e29b-41d4-a716-446655440012:2026-10-11T00:00:00.000Z')?.status).toBe('SENT');
    scheduler.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await scheduler.stop();
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(database.rows.get('550e8400-e29b-41d4-a716-446655440011:2026-10-11T00:00:00.000Z')?.status).toBe('SENT');
    expect(clearInterval).toHaveBeenCalledWith(intervalHandle);
  });

  it('does not retry after Telegram accepted the message but SENT confirmation failed', async () => {
    const database = fakeDatabase([
      { id: '550e8400-e29b-41d4-a716-446655440013', telegramUserId: 761005n, preferredLanguage: 'ENGLISH', dailyQuestionReminderEnabled: true, completedDailyQuestion: true },
    ], { failSentConfirmation: true });
    const sendMessage = vi.fn(async (chatId: string, message: string, options: unknown) => {
      void chatId; void message; void options;
      return undefined;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = createReminderScheduler({
      database: database as unknown as Parameters<typeof createReminderScheduler>[0]['database'],
      api: { sendMessage } as unknown as Parameters<typeof createReminderScheduler>[0]['api'],
      miniAppUrl: 'https://example.com/app',
      now: () => new Date('2026-10-11T04:00:00.000Z'),
    });

    scheduler.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await scheduler.stop();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(database.rows.get('550e8400-e29b-41d4-a716-446655440013:2026-10-11T00:00:00.000Z')?.status).toBe('CLAIMED');
    scheduler.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await scheduler.stop();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Daily reminder confirmation failed.');
    error.mockRestore();
  });
});
