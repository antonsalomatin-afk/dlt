import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { importCandidateBatch } from './candidate-import.ts';
import { candidatePathArgument, readCandidateBatchFile } from './candidates.ts';

const failureMessage = 'Candidate import failed. No candidate content was imported.';

try {
  const path = candidatePathArgument(process.argv.slice(2));
  if (path === undefined) throw new Error('Invalid arguments.');
  const batch = readCandidateBatchFile(path);
  parseDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    const result = await importCandidateBatch(database, batch);
    console.log(`Imported batch ${result.batchId}: ${result.newQuestions} new questions, ${result.newChoices} new choices, ${result.matchedQuestions} matched questions and ${result.matchedChoices} matched choices; all inactive DRAFT.`);
  } finally {
    await database.$disconnect();
  }
} catch {
  console.error(failureMessage);
  process.exitCode = 1;
}
