import { z } from 'zod';
import {
  DailyReminderDeliveryStatus,
  Prisma,
  type PrismaClient,
  type PreferredLanguage,
} from './index.ts';
import { ICT_OFFSET_MS, REMINDER_HOUR_ICT } from './reminder-delivery.ts';

export const summaryTypeSchema = z.enum(['DAILY', 'WEEKLY']);
export type ReminderSummaryType = z.infer<typeof summaryTypeSchema>;

const userIdSchema = z.uuid().refine((value) => value === value.toLowerCase());
const validDateSchema = z.date().refine((value) => !Number.isNaN(value.getTime()));

export type SummaryPeriod = {
  summaryType: ReminderSummaryType;
  periodStart: Date;
  periodEnd: Date;
  rangeStart: Date;
  rangeEnd: Date;
};

export type SummaryMetrics = {
  answered: number;
  correct: number;
  accuracyPercent: number;
};

type SummaryDatabase = Pick<PrismaClient, 'answerAttempt' | 'reminderSummaryDelivery'>;

function shiftedDate(input: unknown): Date {
  return new Date(validDateSchema.parse(input).getTime() + ICT_OFFSET_MS);
}

function dateFromParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

export function summaryPeriodForTick(input: unknown): { daily: SummaryPeriod; weekly?: SummaryPeriod } {
  const shifted = shiftedDate(input);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const periodStart = dateFromParts(year, month, day);
  const periodEnd = dateFromParts(year, month, day + 1);
  const rangeStart = new Date(periodStart.getTime() - ICT_OFFSET_MS);
  const rangeEnd = new Date(periodEnd.getTime() - ICT_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  const daily = { summaryType: 'DAILY' as const, periodStart, periodEnd, rangeStart, rangeEnd };
  if (shifted.getUTCHours() !== REMINDER_HOUR_ICT || shifted.getUTCMinutes() !== 0) return { daily };
  if (weekday !== 1) return { daily };
  return {
    daily,
    weekly: {
      summaryType: 'WEEKLY',
      periodStart: dateFromParts(year, month, day - 7),
      periodEnd: periodStart,
      rangeStart: new Date(dateFromParts(year, month, day - 7).getTime() - ICT_OFFSET_MS),
      rangeEnd: rangeStart,
    },
  };
}

export function isWeeklySummaryTick(input: unknown): boolean {
  const shifted = shiftedDate(input);
  return shifted.getUTCHours() === REMINDER_HOUR_ICT
    && shifted.getUTCMinutes() === 0
    && shifted.getUTCDay() === 1;
}

export function summaryMessages(language: PreferredLanguage, summaryType: ReminderSummaryType, metrics: SummaryMetrics): string {
  const label = summaryType === 'DAILY'
    ? { ENGLISH: 'Daily summary', RUSSIAN: 'Итоги дня', THAI: 'สรุปรายวัน' }
    : { ENGLISH: 'Weekly summary', RUSSIAN: 'Итоги недели', THAI: 'สรุปรายสัปดาห์' };
  const templates = {
    ENGLISH: `${label.ENGLISH}: ${metrics.answered} answers, ${metrics.accuracyPercent}% correct. Keep training with ThaiDLT.`,
    RUSSIAN: `${label.RUSSIAN}: ответов — ${metrics.answered}, правильных — ${metrics.accuracyPercent}%. Продолжайте тренироваться в ThaiDLT.`,
    THAI: `${label.THAI}: ตอบ ${metrics.answered} ข้อ ถูก ${metrics.accuracyPercent}% ฝึกต่อกับ ThaiDLT`,
  };
  return templates[language];
}

export async function getSummaryMetrics(database: Pick<PrismaClient, 'answerAttempt'>, userIdInput: unknown, period: SummaryPeriod): Promise<SummaryMetrics> {
  const userId = userIdSchema.parse(userIdInput);
  const attempts = await database.answerAttempt.findMany({
    where: {
      presentation: { userId },
      submittedAt: { gte: validDateSchema.parse(period.rangeStart), lt: validDateSchema.parse(period.rangeEnd) },
    },
    select: { isCorrect: true },
  });
  const answered = attempts.length;
  const correct = attempts.filter(({ isCorrect }) => isCorrect).length;
  return { answered, correct, accuracyPercent: answered === 0 ? 0 : Math.round((correct / answered) * 100) };
}

export async function claimSummaryDelivery(database: SummaryDatabase, userIdInput: unknown, period: SummaryPeriod, nowInput: unknown): Promise<{ claimed: boolean; deliveryId: string }> {
  const userId = userIdSchema.parse(userIdInput);
  const periodStart = validDateSchema.parse(period.periodStart);
  const now = validDateSchema.parse(nowInput);
  const existing = await database.reminderSummaryDelivery.findUnique({
    where: { userId_summaryType_periodStart: { userId, summaryType: period.summaryType, periodStart } },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status !== DailyReminderDeliveryStatus.FAILED) return { claimed: false, deliveryId: existing.id };
    const retried = await database.reminderSummaryDelivery.updateMany({
      where: { id: existing.id, status: DailyReminderDeliveryStatus.FAILED },
      data: { status: DailyReminderDeliveryStatus.CLAIMED, attempts: { increment: 1 }, claimedAt: now, failedAt: null },
    });
    return { claimed: retried.count === 1, deliveryId: existing.id };
  }
  try {
    const created = await database.reminderSummaryDelivery.create({
      data: { userId, summaryType: period.summaryType, periodStart, status: DailyReminderDeliveryStatus.CLAIMED, attempts: 1, claimedAt: now },
      select: { id: true },
    });
    return { claimed: true, deliveryId: created.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await database.reminderSummaryDelivery.findUnique({
        where: { userId_summaryType_periodStart: { userId, summaryType: period.summaryType, periodStart } },
        select: { id: true },
      });
      return { claimed: false, deliveryId: concurrent?.id ?? '' };
    }
    throw error;
  }
}

export async function markSummaryDeliverySent(database: SummaryDatabase, deliveryId: string, sentAtInput: unknown): Promise<boolean> {
  const sentAt = validDateSchema.parse(sentAtInput);
  const result = await database.reminderSummaryDelivery.updateMany({ where: { id: deliveryId, status: DailyReminderDeliveryStatus.CLAIMED }, data: { status: DailyReminderDeliveryStatus.SENT, sentAt } });
  return result.count === 1;
}

export async function markSummaryDeliveryFailed(database: SummaryDatabase, deliveryId: string, failedAtInput: unknown): Promise<boolean> {
  const failedAt = validDateSchema.parse(failedAtInput);
  const result = await database.reminderSummaryDelivery.updateMany({ where: { id: deliveryId, status: DailyReminderDeliveryStatus.CLAIMED }, data: { status: DailyReminderDeliveryStatus.FAILED, failedAt } });
  return result.count === 1;
}
