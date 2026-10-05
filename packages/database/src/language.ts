import { z } from 'zod';

export const preferredLanguageSchema = z.enum(['ENGLISH', 'RUSSIAN', 'THAI']);
export const languagePreferenceSchema = z.strictObject({
  preferredLanguage: preferredLanguageSchema,
});

export const languagePreferenceRequestSchema = languagePreferenceSchema;
export const languagePreferenceResponseSchema = languagePreferenceSchema;

export type LanguagePreference = z.infer<typeof languagePreferenceSchema>;
