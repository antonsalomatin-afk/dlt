import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { inspectReportTriage } from './report-triage-inspection.ts';
import { runReportTriageInspectionCli } from './report-triage-inspection-cli.ts';

process.exitCode = await runReportTriageInspectionCli({
  args: process.argv.slice(2),
  now: () => new Date(),
  readDatabaseUrl: () => process.env.DATABASE_URL,
  validateDatabaseUrl: parseDatabaseUrl,
  createDatabaseClient,
  inspect: inspectReportTriage,
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
});
