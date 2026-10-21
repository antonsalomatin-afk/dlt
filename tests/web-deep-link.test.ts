import { describe, expect, it } from 'vitest';
import { readTelegramStartParameter } from '../apps/web/lib/telegram.ts';

describe('Mini App Telegram start parameter boundary', () => {
  it('accepts only the signed daily destination field', () => {
    expect(readTelegramStartParameter('auth_date=1&start_param=daily&hash=signed')).toBe('daily');
    expect(readTelegramStartParameter('start_param=daily&start_param=daily')).toBeNull();
    expect(readTelegramStartParameter('start_param=unknown')).toBeNull();
    expect(readTelegramStartParameter('tgWebAppStartParam=daily')).toBeNull();
    expect(readTelegramStartParameter('start_param=daily%00')).toBeNull();
    expect(readTelegramStartParameter(`start_param=${'x'.repeat(16_385)}`)).toBeNull();
  });
});

it('accepts only canonical bounded question destinations and marks malformed question links for safe guidance', () => {
  const value = 'question_550e8400-e29b-41d4-a716-446655440000';
  expect(readTelegramStartParameter(`start_param=${value}`)).toBe(value);
  for (const malformed of ['question_nope', value.toUpperCase().replace('QUESTION_', 'question_'), `${value}%00`]) {
    expect(readTelegramStartParameter(`start_param=${malformed}`)).toBe('invalid-question');
  }
  expect(readTelegramStartParameter(`start_param=${value}&start_param=daily`)).toBe('invalid-question');
});
