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
