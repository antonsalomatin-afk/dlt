import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramIdentity {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidationPolicy {
  /** Integer Unix seconds. The default reads the server clock. */
  now?: () => number;
  maxAgeSeconds?: number;
  futureSkewSeconds?: number;
}

export class InvalidInitDataError extends Error {
  constructor() {
    super('Invalid Telegram authentication data');
    this.name = 'InvalidInitDataError';
  }
}

function invalid(): never {
  throw new InvalidInitDataError();
}

function wellFormed(value: string): boolean {
  try { encodeURIComponent(value); return true; } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode(value: string): string {
  try {
    // Unlike URLSearchParams, decodeURIComponent rejects broken percent escapes/UTF-8.
    const decoded = decodeURIComponent(value.replace(/\+/g, ' '));
    if (!wellFormed(decoded)) invalid();
    return decoded;
  } catch {
    return invalid();
  }
}

function parse(raw: unknown): Map<string, string> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 16384 || Buffer.byteLength(raw, 'utf8') > 16384) invalid();
  const fields = new Map<string, string>();
  for (const pair of raw.split('&')) {
    const separator = pair.indexOf('=');
    if (separator < 1) invalid();
    const key = decode(pair.slice(0, separator));
    const value = decode(pair.slice(separator + 1));
    // Reject delimiters that could make two sets of fields share one check string.
    if (key.length === 0 || /[=\r\n]/u.test(key) || /[\r\n]/u.test(value) || fields.has(key)) invalid();
    fields.set(key, value);
  }
  return fields;
}

function identity(raw: string | undefined): TelegramIdentity {
  if (raw === undefined) invalid();
  let user: unknown;
  try { user = JSON.parse(raw); } catch { return invalid(); }
  if (!isRecord(user)) invalid();
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0 || user.id > 2 ** 52 - 1) invalid();
  if (typeof user.first_name !== 'string' || user.first_name.trim().length === 0 || !wellFormed(user.first_name)) invalid();
  const result: TelegramIdentity = { id: String(user.id), first_name: user.first_name };
  for (const key of ['last_name', 'username', 'language_code'] as const) {
    if (key in user) {
      const value: unknown = user[key];
      if (typeof value !== 'string' || !wellFormed(value)) invalid();
      result[key] = value;
    }
  }
  return result;
}

/** Server-only: validates raw initData and returns only whitelisted identity fields. */
export function validateInitData(raw: unknown, botToken: string, policy: ValidationPolicy = {}): TelegramIdentity {
  const maxAge = policy.maxAgeSeconds ?? 300;
  const futureSkew = policy.futureSkewSeconds ?? 30;
  const now = (policy.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (typeof botToken !== 'string' || botToken.trim().length === 0 ||
      !Number.isSafeInteger(maxAge) || maxAge <= 0 ||
      !Number.isSafeInteger(futureSkew) || futureSkew < 0 ||
      !Number.isSafeInteger(now) || now < 0) {
    throw new Error('Invalid Telegram validation configuration');
  }
  const fields = parse(raw);
  const hash = fields.get('hash');
  if (hash === undefined || !/^[a-fA-F0-9]{64}$/u.test(hash)) invalid();
  fields.delete('hash');
  const checkString = [...fields.keys()].sort().map((key) => `${key}=${fields.get(key)}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) invalid();

  // Interpret identity and timestamp only after successful authentication.
  const dateText = fields.get('auth_date');
  if (dateText === undefined || !/^(0|[1-9][0-9]*)$/u.test(dateText)) invalid();
  const authDate = Number(dateText);
  if (!Number.isSafeInteger(authDate) || now - authDate > maxAge || authDate - now > futureSkew) invalid();
  return identity(fields.get('user'));
}
