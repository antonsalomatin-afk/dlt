import { describe, expect, it } from 'vitest';
import { summaryMessages, summaryPeriodForTick } from '../packages/database/src/summary.ts';

describe('learner summary periods', () => {
  it('uses ICT calendar boundaries and the preceding Monday through Sunday week', () => {
    const periods = summaryPeriodForTick(new Date('2026-10-12T04:00:00.000Z'));
    expect(periods.daily.periodStart.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(periods.daily.rangeStart.toISOString()).toBe('2026-10-11T17:00:00.000Z');
    expect(periods.daily.rangeEnd.toISOString()).toBe('2026-10-12T17:00:00.000Z');
    expect(periods.weekly?.periodStart.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(periods.weekly?.periodEnd.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(periods.weekly?.rangeStart.toISOString()).toBe('2026-10-04T17:00:00.000Z');
    expect(periods.weekly?.rangeEnd.toISOString()).toBe('2026-10-11T17:00:00.000Z');
    expect(summaryPeriodForTick(new Date('2026-10-11T04:00:00.000Z')).weekly).toBeUndefined();
  });
});

describe('learner summary messages', () => {
  it.each([
    ['ENGLISH', 'Daily summary: 3 answers, 67% correct. Keep training with ThaiDLT.'],
    ['RUSSIAN', 'Итоги недели: ответов — 3, правильных — 67%. Продолжайте тренироваться в ThaiDLT.'],
    ['THAI', 'สรุปรายวัน: ตอบ 3 ข้อ ถูก 67% ฝึกต่อกับ ThaiDLT'],
  ] as const)('renders deterministic %s text', (language, expected) => {
    const type = language === 'RUSSIAN' ? 'WEEKLY' : 'DAILY';
    expect(summaryMessages(language, type, { answered: 3, correct: 2, accuracyPercent: 67 })).toBe(expected);
  });
});
