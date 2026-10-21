import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { overlayRussianStems } from './russian-stems.ts';
import { runRussianStemsCli } from './russian-stems-cli.ts';

process.exitCode = await runRussianStemsCli({
  args: process.argv.slice(2), clock: new Date(),
  readDatabaseUrl: () => process.env.DATABASE_URL,
  validateDatabaseUrl: parseDatabaseUrl, createDatabaseClient,
  overlay: overlayRussianStems,
  writeStdout: (message) => process.stdout.write(message),
  writeStderr: (message) => process.stderr.write(message),
});
