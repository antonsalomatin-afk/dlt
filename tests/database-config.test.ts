import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from '../tools/database/config.ts';

const valid = 'postgresql://thaidlt:local-only@127.0.0.1:55432/thaidlt';
describe('local database configuration', () => {
  it('parses explicit loopback credentials and port', () => {
    expect(parseDatabaseUrl(valid)).toEqual({ user: 'thaidlt', password: 'local-only', port: '55432', database: 'thaidlt' });
  });
  it.each([
    undefined, '', valid.replace('127.0.0.1', 'example.com'),
    valid.replace('55432', '0'), valid.replace('55432', '65536'),
    valid.replace(':55432', ''), valid.replace('local-only', ''),
    valid.replace('local-only', 'secret%0Avalue'), `${valid}?sslmode=disable`,
    valid.replace('/thaidlt', '/bad-name'), valid.replace('postgresql:', 'https:'),
  ])('rejects unsafe or malformed configuration without leaking it (%#)', (value) => {
    expect(() => parseDatabaseUrl(value)).toThrow('DATABASE_URL must specify');
    try { parseDatabaseUrl(value); } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
});
