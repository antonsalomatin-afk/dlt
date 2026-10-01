import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import {
  activateCandidates,
  candidateActivationPathArguments,
  readCandidateActivationManifestFile,
} from './candidate-activation.ts';
import { readCandidateReviewManifestFile } from './candidate-review.ts';
import { readCandidateBatchFile } from './candidates.ts';

const failureMessage = 'Candidate activation failed. No candidates were activated.';

try {
  const paths = candidateActivationPathArguments(process.argv.slice(2));
  if (paths === undefined) throw new Error('Invalid arguments.');
  const [candidatePath, reviewPath, activationPath] = paths;
  const commandClock = new Date();
  const batch = readCandidateBatchFile(candidatePath);
  const review = readCandidateReviewManifestFile(reviewPath, batch, commandClock);
  const activation = readCandidateActivationManifestFile(activationPath, batch, review, commandClock);
  parseDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    const result = await activateCandidates(database, batch, review, activation);
    console.log(`Activated batch ${result.batchId}: ${result.applied} applied and ${result.matched} matched.`);
  } finally {
    await database.$disconnect();
  }
} catch {
  console.error(failureMessage);
  process.exitCode = 1;
}
