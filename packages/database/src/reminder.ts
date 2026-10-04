import { z } from 'zod';

export const reminderPreferenceSchema = z.strictObject({
  dailyQuestionReminderEnabled: z.boolean(),
});

export const reminderPreferenceRequestSchema = reminderPreferenceSchema;
export const reminderPreferenceResponseSchema = reminderPreferenceSchema;

export type ReminderPreference = z.infer<typeof reminderPreferenceSchema>;
