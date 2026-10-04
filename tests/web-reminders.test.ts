import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { reminderPreferenceSchema } from '../apps/web/lib/contracts.ts';

describe('Mini App reminder preference contract', () => {
  it('accepts only the exact one-boolean server shape', () => {
    expect(reminderPreferenceSchema.parse({ dailyQuestionReminderEnabled: false })).toEqual({
      dailyQuestionReminderEnabled: false,
    });
    expect(reminderPreferenceSchema.parse({ dailyQuestionReminderEnabled: true })).toEqual({
      dailyQuestionReminderEnabled: true,
    });

    for (const invalid of [
      {},
      { dailyQuestionReminderEnabled: null },
      { dailyQuestionReminderEnabled: 0 },
      { dailyQuestionReminderEnabled: 'true' },
      { dailyQuestionReminderEnabled: true, userId: '550e8400-e29b-41d4-a716-446655440000' },
    ]) expect(reminderPreferenceSchema.safeParse(invalid).success).toBe(false);
  });

  it('keeps the reminder API behind one explicit Next rewrite', async () => {
    const source = await readFile(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
    expect(source.match(/'\/me\/reminders'/gu)).toHaveLength(1);
    expect(source).not.toContain('/me/:path');
    expect(source).not.toContain('/me/:path*');
  });
});
