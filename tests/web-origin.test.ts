import { expect, it } from 'vitest';
import { apiOrigin } from '../apps/web/lib/api-origin.ts';

it('accepts only explicit safe API origins', () => {
  expect(apiOrigin()).toBe('http://127.0.0.1:3001');
  expect(apiOrigin('https://api.example.com/')).toBe('https://api.example.com');
  for (const value of ['', 'ftp://localhost', 'http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?q=1', 'https://example.com#', ' https://example.com']) {
    expect(() => apiOrigin(value)).toThrow('API_ORIGIN');
  }
});
