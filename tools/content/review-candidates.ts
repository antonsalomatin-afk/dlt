import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import {
  applyCandidateReview,
  candidateReviewPathArguments,
  readCandidateReviewManifestFile,
} from './candidate-review.ts';
import { readCandidateBatchFile } from './candidates.ts';

const failureMessage = 'Candidate review failed. No review decisions were applied.';

try {
  const paths = candidateReviewPathArguments(process.argv.slice(2));
  if (paths === undefined) throw new Error('Invalid arguments.');
  const [candidatePath, manifestPath] = paths;
  const batch = readCandidateBatchFile(candidatePath);
  const manifest = readCandidateReviewManifestFile(manifestPath, batch, new Date());
  parseDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    const result = await applyCandidateReview(database, batch, manifest);
    console.log(`Reviewed batch ${result.batchId}: ${result.appliedVerified} VERIFIED applied, ${result.appliedRejected} REJECTED applied, ${result.matchedVerified} VERIFIED matched and ${result.matchedRejected} REJECTED matched; all inactive.`);
  } finally {
    await database.$disconnect();
  }
} catch {
  console.error(failureMessage);
  process.exitCode = 1;
}
