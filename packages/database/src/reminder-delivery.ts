import { z } from 'zod';
import {
  DailyReminderDeliveryStatus,
  Prisma,
  type PrismaClient,
  type PreferredLanguage,
} from './index.ts';

export const ICT_OFFSET_MS = 7 * 60 * 60 * 1_000;
export const REMINDER_HOUR_ICT = 11;
export const REMINDER_INTERVAL_MS = 30_000;

const userIdSchema = z.uuid().refine((value) => value === value.toLowerCase());
export const reminderLocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === `${value}T00:00:00.000Z`;
});
const validDateSchema = z.date().refine((value) => !Number.isNaN(value.getTime()));

export type ReminderRecipient = {
  id: string;
  telegramUserId: bigint;
  preferredLanguage: PreferredLanguage;
};

type DeliveryDatabase = Pick<PrismaClient, 'dailyReminderDelivery' | 'user'>;

export function thailandReminderLocalDate(input: unknown): string {
  const instant = validDateSchema.parse(input);
  const shifted = new Date(instant.getTime() + ICT_OFFSET_MS);
  return reminderLocalDateSchema.parse(shifted.toISOString().slice(0, 10));
}

export function isReminderTick(input: unknown): boolean {
  const instant = validDateSchema.parse(input);
  const shifted = new Date(instant.getTime() + ICT_OFFSET_MS);
  return shifted.getUTCHours() === REMINDER_HOUR_ICT && shifted.getUTCMinutes() === 0;
}

export function reminderDate(input: unknown): Date {
  return new Date(`${reminderLocalDateSchema.parse(input)}T00:00:00.000Z`);
}

export const reminderMessages: Record<PreferredLanguage, string> = {
  ENGLISH: 'Keep training with ThaiDLT. Open the Mini App for more driving theory practice.',
  RUSSIAN: 'Продолжайте тренироваться в ThaiDLT. Откройте Mini App для дополнительной практики по теории вождения.',
  THAI: 'ฝึกต่อกับ ThaiDLT เปิด Mini App เพื่อฝึกทฤษฎีการขับรถเพิ่มเติม',
};

export async function listReminderRecipients(database: DeliveryDatabase): Promise<ReminderRecipient[]> {
  return database.user.findMany({
    where: { dailyQuestionReminderEnabled: true },
    select: { id: true, telegramUserId: true, preferredLanguage: true },
  });
}

export async function claimReminderDelivery(
  database: DeliveryDatabase,
  userIdInput: unknown,
  localDateInput: unknown,
  nowInput: unknown,
): Promise<{ claimed: boolean; deliveryId: string }> {
  const userId = userIdSchema.parse(userIdInput);
  const localDate = reminderDate(localDateInput);
  const now = validDateSchema.parse(nowInput);
  const existing = await database.dailyReminderDelivery.findUnique({
    where: { userId_localDate: { userId, localDate } },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status !== DailyReminderDeliveryStatus.FAILED) return { claimed: false, deliveryId: existing.id };
    const retried = await database.dailyReminderDelivery.updateMany({
      where: { id: existing.id, status: DailyReminderDeliveryStatus.FAILED },
      data: {
        status: DailyReminderDeliveryStatus.CLAIMED,
        attempts: { increment: 1 },
        claimedAt: now,
        failedAt: null,
      },
    });
    return { claimed: retried.count === 1, deliveryId: existing.id };
  }
  try {
    const created = await database.dailyReminderDelivery.create({
      data: {
        userId,
        localDate,
        status: DailyReminderDeliveryStatus.CLAIMED,
        attempts: 1,
        claimedAt: now,
      },
      select: { id: true },
    });
    return { claimed: true, deliveryId: created.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await database.dailyReminderDelivery.findUnique({
        where: { userId_localDate: { userId, localDate } },
        select: { id: true },
      });
      return { claimed: false, deliveryId: concurrent?.id ?? '' };
    }
    throw error;
  }
}

export async function markReminderDeliverySent(database: DeliveryDatabase, deliveryId: string, sentAtInput: unknown): Promise<boolean> {
  const sentAt = validDateSchema.parse(sentAtInput);
  const result = await database.dailyReminderDelivery.updateMany({
    where: { id: deliveryId, status: DailyReminderDeliveryStatus.CLAIMED },
    data: { status: DailyReminderDeliveryStatus.SENT, sentAt },
  });
  return result.count === 1;
}

export async function markReminderDeliveryFailed(database: DeliveryDatabase, deliveryId: string, failedAtInput: unknown): Promise<boolean> {
  const failedAt = validDateSchema.parse(failedAtInput);
  const result = await database.dailyReminderDelivery.updateMany({
    where: { id: deliveryId, status: DailyReminderDeliveryStatus.CLAIMED },
    data: { status: DailyReminderDeliveryStatus.FAILED, failedAt },
  });
  return result.count === 1;
}
