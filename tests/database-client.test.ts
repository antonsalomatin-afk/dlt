import { expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';

it.each(['', 'not a url', 'https://example.com/db', 'postgresql://localhost'])('rejects invalid database connection URLs (%#)', (url) => {
  expect(() => createDatabaseClient(url)).toThrow('A valid PostgreSQL connection URL is required.');
});
