import { describe, expect, it } from 'vitest';
import { readQuestionPostConfig } from '../apps/bot/src/config.ts';
import { buildQuestionPost, publishableImageReference } from '../apps/bot/src/question-post.ts';

const config = { enabled: true, botUsername: 'thaidlt_test_bot' } as const;
const id = '550e8400-e29b-41d4-a716-446655440000';
const input = { presentationId: id, question: { textEnglish: 'When should you stop?', textRussian: 'Когда нужно остановиться?' } };

describe('private bilingual question post construction', () => {
  it('has a strict disabled rollout default and validates public identity only when enabled', () => {
    expect(readQuestionPostConfig({})).toEqual({ enabled: false });
    expect(readQuestionPostConfig({ DAILY_QUESTION_POSTS_ENABLED: 'false', TELEGRAM_MINI_APP_BOT_USERNAME: 'invalid' })).toEqual({ enabled: false });
    for (const value of ['', '1', 'TRUE', ' true']) expect(() => readQuestionPostConfig({ DAILY_QUESTION_POSTS_ENABLED: value })).toThrow();
    expect(() => readQuestionPostConfig({ DAILY_QUESTION_POSTS_ENABLED: 'true' })).toThrow();
    expect(readQuestionPostConfig({ DAILY_QUESTION_POSTS_ENABLED: 'true', TELEGRAM_MINI_APP_BOT_USERNAME: config.botUsername })).toEqual(config);
    for (const username of ['@invalid_bot', 'user:secret@host', 'thing', 'hello/bot', 'hello_bot?x']) {
      expect(() => readQuestionPostConfig({ DAILY_QUESTION_POSTS_ENABLED: 'true', TELEGRAM_MINI_APP_BOT_USERNAME: username })).toThrow();
    }
    expect(() => readQuestionPostConfig({ DAILY_QUESTION_POSTS_ENABLED: 'true', TELEGRAM_MINI_APP_BOT_USERNAME: config.botUsername, TELEGRAM_MINI_APP_SHORT_NAME: '../bad' })).toThrow();
  });
  it('posts full English and stored Russian with only an owned presentation navigation ID', () => {
    const result = buildQuestionPost(input, 'https://images.example.org/q.png', config);
    expect(result).toEqual({ text: 'English\nWhen should you stop?\n\nРусский\nКогда нужно остановиться?', image: 'https://images.example.org/q.png', url: `https://t.me/thaidlt_test_bot?startapp=question_${id}` });
    expect(buildQuestionPost(input, null, { ...config, shortName: 'practice' })?.url).toBe(`https://t.me/thaidlt_test_bot/practice?startapp=question_${id}`);
    expect(JSON.stringify(result)).not.toMatch(/correct|explanation|token|userId/iu);
  });
  it('keeps full text when captions do not fit and rejects overlong or absent bilingual text', () => {
    const long = { ...input, question: { ...input.question, textEnglish: 'x'.repeat(1100) } };
    expect(buildQuestionPost(long, 'https://images.example.org/q.png', config)).toMatchObject({ image: null });
    expect(buildQuestionPost({ ...long, question: { ...long.question, textEnglish: 'x'.repeat(4096) } }, null, config)).toBeNull();
    for (const textRussian of [null, '', '   ', 'unsafe\u0000', 'unsafe\u202e']) {
      expect(() => buildQuestionPost({ ...input, question: { ...input.question, textRussian } }, null, config)).toThrow();
    }
  });
  it('rejects unsafe or local image metadata and leaves a complete text-only post', () => {
    for (const image of ['http://example.org/x', 'file:///tmp/x', '/local.png', 'https://user:pass@example.org/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://example.org/%00x', 'https://example.org/x\n', 'https://example.org/\\x']) {
      expect(publishableImageReference(image)).toBeNull();
      expect(buildQuestionPost(input, image, config)).toMatchObject({ image: null });
    }
  });
});
