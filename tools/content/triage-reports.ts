import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { runReportTriageCli } from './report-triage-cli.ts';
import {
  applyReportTriage,
  readReportTriageManifestFile,
  reportTriagePathArgument,
} from './report-triage.ts';

process.exitCode = await runReportTriageCli({
  args: process.argv.slice(2),
  parsePath: reportTriagePathArgument,
  now: () => new Date(),
  readManifest: readReportTriageManifestFile,
  readDatabaseUrl: () => process.env.DATABASE_URL,
  validateDatabaseUrl: parseDatabaseUrl,
  createDatabaseClient,
  apply: applyReportTriage,
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
});
