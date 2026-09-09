import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidInitDataError, validateInitData } from '../packages/telegram/src/index.ts';

const token = '123456:synthetic_test_token';
const now = () => 1700000000;
const user = '{"id":4503599627370495,"first_name":"Анна ไทย 🚗","last_name":"A+B & C","username":"anna","language_code":"ru","extra":"discard"}';
// Independently calculated using .NET HMACSHA256.HashData, over this literal
// UTF-8 check string (not the production parser or signing implementation).
const checkString = `auth_date=1700000000\nquery_id=A +&=%\nsignature=synthetic+/=\nuser=${user}`;
const digest = 'ea0d711a4e02292a4def6984925fd82a6ec96dcae673e79749e0b8be2ef8124b';
const vector = `user=${encodeURIComponent(user)}&signature=synthetic%2B%2F%3D&query_id=A+%2B%26%3D%25&auth_date=1700000000&hash=${digest}`;
const base = { auth_date: '1700000000', user };

// Dynamic signatures exercise negative semantic cases; the pinned external
// vector above independently establishes the algorithm and encoding contract.
function sign(fields: Record<string, string>): string {
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const data = Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(data).digest('hex') }).toString();
}

describe('raw Telegram initData', () => {
  it('matches the independent Unicode and encoding vector, retaining signature', () => {
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    expect(createHmac('sha256', secret).update(checkString).digest('hex')).toBe(digest);
    expect(validateInitData(vector, token, { now })).toEqual({ id: '4503599627370495', first_name: 'Анна ไทย 🚗', last_name: 'A+B & C', username: 'anna', language_code: 'ru' });
    expect(validateInitData(vector.replaceAll('+', '%20').replace(digest, digest.toUpperCase()), token, { now }).id).toBe('4503599627370495');
  });

  it.each(['user', 'query_id', 'signature', 'auth_date'])('rejects tampered %s', (key) => {
    const altered = new URLSearchParams(vector);
    altered.set(key, `${altered.get(key)}x`);
    expect(() => validateInitData(altered.toString(), token, { now })).toThrow(InvalidInitDataError);
  });

  it.each(['hash', 'user', 'auth_date', '%75ser', 'query_id'])('rejects duplicate decoded %s fields', (key) => {
    expect(() => validateInitData(`${vector}&${key}=duplicate`, token, { now })).toThrow(InvalidInitDataError);
  });

  it.each(['', '&', 'missing_equals', '=value', 'x=%', 'x=%GG', 'x=%C0%AF', 'x=%ED%A0%80', 'x=\ud800', 'x%0Ay=z', 'x%3Dy=z', 'x=a%0Ab', 'x=a%0Db'])('rejects malformed pair %j', (pair) => {
    expect(() => validateInitData(`${vector}&${pair}`, token, { now })).toThrow(InvalidInitDataError);
  });

  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '00'.repeat(32)])('rejects invalid hash %j', (hash) => {
    expect(() => validateInitData(vector.replace(digest, hash), token, { now })).toThrow(InvalidInitDataError);
  });

  it('rejects missing hash, wrong token, non-string input and oversized bytes', () => {
    expect(() => validateInitData(vector.split('&hash=')[0], token, { now })).toThrow(InvalidInitDataError);
    expect(() => validateInitData(vector, 'other synthetic token', { now })).toThrow(InvalidInitDataError);
    for (const raw of [null, {}, '', 'x'.repeat(16385), `x=${'🚗'.repeat(5000)}`]) {
      expect(() => validateInitData(raw, token, { now })).toThrow(InvalidInitDataError);
    }
  });

  it.each([[-300, true], [-301, false], [30, true], [31, false]])('enforces inclusive age/skew at %i seconds', (offset, valid) => {
    const run = () => validateInitData(sign({ ...base, auth_date: String(now() + offset) }), token, { now });
    if (valid) expect(run().id).toBe('4503599627370495');
    else expect(run).toThrow(InvalidInitDataError);
  });

  it('supports explicit age/skew and zero future skew', () => {
    expect(validateInitData(sign({ ...base, auth_date: String(now() - 600) }), token, { now, maxAgeSeconds: 600, futureSkewSeconds: 0 }).id).toBeDefined();
    expect(() => validateInitData(sign({ ...base, auth_date: String(now() + 1) }), token, { now, futureSkewSeconds: 0 })).toThrow(InvalidInitDataError);
  });

  it.each(['', '-1', '1.2', '1e9', ' 1700000000', '01700000000', 'Infinity', '9007199254740992'])('rejects signed malformed auth_date %j', (auth_date) => {
    expect(() => validateInitData(sign({ ...base, auth_date }), token, { now })).toThrow(InvalidInitDataError);
  });

  it.each([{}, { user }, { auth_date: base.auth_date }])('rejects signed missing required fields', (fields) => {
    expect(() => validateInitData(sign(fields), token, { now })).toThrow(InvalidInitDataError);
  });

  it.each(['{', 'null', '[]', '{}', '{"id":1}', '{"id":"1","first_name":"A"}', ...[0, -1, 1.5, 2 ** 52, Number.MAX_SAFE_INTEGER + 1].map((id) => JSON.stringify({ id, first_name: 'A' })), ...['', '  ', null, 1].map((first_name) => JSON.stringify({ id: 1, first_name })), '{"id":1,"first_name":"\\ud800"}', '{"id":1,"first_name":"A","username":7}'])('rejects signed malformed identity %s', (user) => {
    expect(() => validateInitData(sign({ ...base, user }), token, { now })).toThrow(InvalidInitDataError);
  });

  it('accepts minimal identity and preserves unknown signed fields only for authentication', () => {
    expect(validateInitData(sign({ ...base, user: '{"id":1,"first_name":"A","admin":true}', future_field: 'value=+%' }), token, { now })).toEqual({ id: '1', first_name: 'A' });
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid configuration %s', (value) => {
    for (const policy of [{ now, maxAgeSeconds: value }, { now, futureSkewSeconds: value }, { now: () => value }]) {
      expect(() => validateInitData(vector, token, policy)).toThrow('Invalid Telegram validation configuration');
    }
  });

  it('rejects zero age and empty tokens with non-sensitive errors', () => {
    expect(() => validateInitData(vector, token, { now, maxAgeSeconds: 0 })).toThrow('Invalid Telegram validation configuration');
    expect(() => validateInitData(vector, '', { now })).toThrow('Invalid Telegram validation configuration');
    expect(() => validateInitData('secret-payload', token, { now })).toThrow('Invalid Telegram authentication data');
  });
});
