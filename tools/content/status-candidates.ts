import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { inspectCandidateBatch } from './candidate-status.ts';
import { candidatePathArgument, readCandidateBatchFile } from './candidates.ts';

const failureMessage = 'Candidate status failed. No status report was produced.';

try {
  const path = candidatePathArgument(process.argv.slice(2));
  if (path === undefined) throw new Error('Invalid arguments.');
  const batch = readCandidateBatchFile(path);
  parseDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    console.log(JSON.stringify(await inspectCandidateBatch(database, batch)));
  } finally {
    await database.$disconnect();
  }
} catch {
  console.error(failureMessage);
  process.exitCode = 1;
}
