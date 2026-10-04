import { expect, it } from 'vitest';
import {
  reminderPreferenceRequestSchema,
  reminderPreferenceResponseSchema,
} from '../packages/database/src/reminder.ts';

it('accepts the exact reminder request and response contract', () => {
  for (const dailyQuestionReminderEnabled of [false, true]) {
    const value = { dailyQuestionReminderEnabled };
    expect(reminderPreferenceRequestSchema.parse(value)).toEqual(value);
    expect(reminderPreferenceResponseSchema.parse(value)).toEqual(value);
  }
});

it('rejects missing, non-boolean and extra reminder members', () => {
  for (const value of [
    {},
    { dailyQuestionReminderEnabled: null },
    { dailyQuestionReminderEnabled: 0 },
    { dailyQuestionReminderEnabled: 'true' },
    { dailyQuestionReminderEnabled: true, userId: '550e8400-e29b-41d4-a716-446655440000' },
    [],
    null,
  ]) {
    expect(reminderPreferenceRequestSchema.safeParse(value).success).toBe(false);
    expect(reminderPreferenceResponseSchema.safeParse(value).success).toBe(false);
  }
});
