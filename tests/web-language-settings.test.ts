import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { languagePreferenceSchema, preferredLanguageSchema } from '../apps/web/lib/contracts.ts';

describe('Mini App preferred-language contract', () => {
  it('accepts only the exact supported enum response', () => {
    for (const preferredLanguage of ['ENGLISH', 'RUSSIAN', 'THAI'] as const) {
      expect(languagePreferenceSchema.parse({ preferredLanguage })).toEqual({ preferredLanguage });
      expect(preferredLanguageSchema.parse(preferredLanguage)).toBe(preferredLanguage);
    }

    for (const invalid of [
      {},
      { preferredLanguage: null },
      { preferredLanguage: 0 },
      { preferredLanguage: 'english' },
      { preferredLanguage: 'GERMAN' },
      { preferredLanguage: 'ENGLISH', userId: '550e8400-e29b-41d4-a716-446655440000' },
    ]) expect(languagePreferenceSchema.safeParse(invalid).success).toBe(false);
  });

  it('keeps the language API behind one explicit Next rewrite', async () => {
    const source = await readFile(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
    expect(source.match(/'\/me\/language'/gu)).toHaveLength(1);
    expect(source).not.toContain('/me/:path');
    expect(source).not.toContain('/me/:path*');
  });

  it('keeps the settings view on the guarded request boundary', async () => {
    const source = await readFile(new URL('../apps/web/app/language-settings.tsx', import.meta.url), 'utf8');
    expect(source).toContain('AbortSignal.timeout(15000)');
    expect(source).toContain("cache: 'no-store'");
    expect(source).toContain('id !== requestId.current');
    expect(source).toContain('requested === confirmed');
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|console\./u);
  });
});
