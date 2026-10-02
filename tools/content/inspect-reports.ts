import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { inspectQuestionReports } from './report-inspection.ts';

const failureMessage = 'Report inspection failed. No report inventory was produced.';

try {
  if (process.argv.slice(2).length !== 0) throw new Error('Invalid arguments.');
  parseDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    const output = JSON.stringify(await inspectQuestionReports(database));
    process.stdout.write(`${output}\n`);
  } finally {
    await database.$disconnect();
  }
} catch {
  console.error(failureMessage);
  process.exitCode = 1;
}
