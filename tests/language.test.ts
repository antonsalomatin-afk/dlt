import { expect, it } from 'vitest';
import {
  languagePreferenceRequestSchema,
  languagePreferenceResponseSchema,
} from '../packages/database/src/language.ts';

it('accepts the exact supported language request and response contract', () => {
  for (const preferredLanguage of ['ENGLISH', 'RUSSIAN', 'THAI'] as const) {
    const value = { preferredLanguage };
    expect(languagePreferenceRequestSchema.parse(value)).toEqual(value);
    expect(languagePreferenceResponseSchema.parse(value)).toEqual(value);
  }
});

it('rejects missing, unsupported and extra language members', () => {
  for (const value of [
    {},
    { preferredLanguage: null },
    { preferredLanguage: 1 },
    { preferredLanguage: 'english' },
    { preferredLanguage: 'FRENCH' },
    { preferredLanguage: 'ENGLISH', userId: '550e8400-e29b-41d4-a716-446655440000' },
    [],
    null,
  ]) {
    expect(languagePreferenceRequestSchema.safeParse(value).success).toBe(false);
    expect(languagePreferenceResponseSchema.safeParse(value).success).toBe(false);
  }
});

it('classifies only the explicit language routes as no-store', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../apps/api/src/index.ts', import.meta.url), 'utf8',
  ));
  const noStoreHook = source.split(/\r?\n/u).find((line) => line.includes("reply.header('Cache-Control', 'no-store')"));
  expect(noStoreHook).toContain("'/me/language'");
  expect(noStoreHook?.match(/'\/me\/language'/gu)).toHaveLength(1);
  expect(source).not.toContain('/me/:setting');
  expect(source).not.toContain('/me/:setting*');
});
