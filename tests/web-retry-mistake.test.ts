import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  consumePracticeHandoff,
  presentationSchema,
  retryMistakeErrorSchema,
  type Presentation,
} from '../apps/web/lib/contracts.ts';

const presentation: Presentation = presentationSchema.parse({
  presentationId: '550e8400-e29b-41d4-a716-446655440001',
  question: {
    id: '550e8400-e29b-41d4-a716-446655440002',
    textThai: null,
    textExamEnglish: null,
    textEnglish: 'What should you do?',
    textRussian: null,
    choices: ['A', 'B', 'C', 'D'].map((key, index) => ({
      id: `550e8400-e29b-41d4-a716-${(index + 3).toString().padStart(12, '0')}`,
      key,
      textThai: null,
      textEnglish: `Choice ${key}`,
      textRussian: null,
    })),
  },
});

describe('Mini App mistake retry boundary', () => {
  it('accepts only exact known error envelopes', () => {
    for (const error of [
      'Unauthorized',
      'Vehicle selection required',
      'Mistake not found',
      'Mistake has no concept',
      'No questions available',
      'Internal Server Error',
    ]) expect(retryMistakeErrorSchema.parse({ error })).toEqual({ error });

    for (const invalid of [
      {},
      { error: 'unknown' },
      { error: 'Mistake not found', detail: 'private' },
      { error: 404 },
    ]) expect(retryMistakeErrorSchema.safeParse(invalid).success).toBe(false);
  });

  it('consumes only the matching in-memory handoff once', () => {
    expect(consumePracticeHandoff(presentation, presentation.presentationId)).toBeNull();
    expect(consumePracticeHandoff(presentation, '550e8400-e29b-41d4-a716-446655440099')).toBe(presentation);
    expect(consumePracticeHandoff(null, presentation.presentationId)).toBeNull();
  });

  it('exposes the explicit retry route through the safe Next rewrite boundary', async () => {
    const source = await readFile(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
    expect(source).toContain("'/practice/retry-mistake'");
    expect(source).toContain('destination: `${origin}${path}`');
  });
});
