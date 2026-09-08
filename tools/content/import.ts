import { readFileSync } from 'node:fs';
import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { importFixtures } from './fixtures.ts';

try {
  if (process.argv.length !== 2) throw new Error('This command accepts no arguments.');
  parseDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    const input: unknown = JSON.parse(readFileSync(new URL('../../content/fixtures/development.json', import.meta.url), 'utf8'));
    const result = await importFixtures(database, input);
    console.log(`Imported ${result.questions} inactive draft fixtures (${result.choices} choices).`);
  } finally { await database.$disconnect(); }
} catch {
  console.error('Development import failed. Check local configuration, fixture validation and namespace collisions; no partial import is committed.');
  process.exitCode = 1;
}
