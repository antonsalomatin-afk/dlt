import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { parseDatabaseUrl } from '../database/config.ts';
import { inspectQuestionReports } from './report-inspection.ts';
import { runReportInspectionCli } from './report-inspection-cli.ts';

process.exitCode = await runReportInspectionCli({
  args: process.argv.slice(2),
  readDatabaseUrl: () => process.env.DATABASE_URL,
  validateDatabaseUrl: parseDatabaseUrl,
  createDatabaseClient,
  inspect: inspectQuestionReports,
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
});
