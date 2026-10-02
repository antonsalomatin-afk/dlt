import type { ReportTriageManifest, ReportTriageSummary } from './report-triage.ts';

export const reportTriageFailureMessage = 'Report triage failed. No triage decisions were applied.';

interface DisconnectableDatabase {
  $disconnect(): Promise<void>;
}

export interface ReportTriageCliDependencies<Database extends DisconnectableDatabase> {
  args: string[];
  parsePath: (args: string[]) => string | undefined;
  now: () => Date;
  readManifest: (path: string, commandClock: Date) => ReportTriageManifest;
  readDatabaseUrl: () => string | undefined;
  validateDatabaseUrl: (value: string | undefined) => unknown;
  createDatabaseClient: (databaseUrl: string) => Database;
  apply: (database: Database, manifest: ReportTriageManifest) => Promise<ReportTriageSummary>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

export async function runReportTriageCli<Database extends DisconnectableDatabase>(
  dependencies: ReportTriageCliDependencies<Database>,
): Promise<0 | 1> {
  try {
    const path = dependencies.parsePath(dependencies.args);
    if (path === undefined) throw new Error('Invalid arguments.');
    const manifest = dependencies.readManifest(path, dependencies.now());
    const databaseUrl = dependencies.readDatabaseUrl();
    dependencies.validateDatabaseUrl(databaseUrl);
    const database = dependencies.createDatabaseClient(databaseUrl ?? '');
    let output: string;
    try {
      output = JSON.stringify(await dependencies.apply(database, manifest));
    } finally {
      await database.$disconnect();
    }
    dependencies.writeStdout(`${output}\n`);
    return 0;
  } catch {
    dependencies.writeStderr(`${reportTriageFailureMessage}\n`);
    return 1;
  }
}
