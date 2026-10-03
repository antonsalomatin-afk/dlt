import type { ReportTriageAuditInventory } from './report-triage-inspection.ts';

export const reportTriageInspectionFailureMessage = 'Report triage inspection failed. No audit inventory was produced.';

interface DisconnectableDatabase {
  $disconnect(): Promise<void>;
}

export interface ReportTriageInspectionCliDependencies<Database extends DisconnectableDatabase> {
  args: string[];
  now: () => Date;
  readDatabaseUrl: () => string | undefined;
  validateDatabaseUrl: (value: string | undefined) => unknown;
  createDatabaseClient: (databaseUrl: string) => Database;
  inspect: (database: Database, commandClock: Date) => Promise<ReportTriageAuditInventory>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

export async function runReportTriageInspectionCli<Database extends DisconnectableDatabase>(
  dependencies: ReportTriageInspectionCliDependencies<Database>,
): Promise<0 | 1> {
  try {
    if (dependencies.args.length !== 0) throw new Error('Invalid arguments.');
    const commandClock = dependencies.now();
    const databaseUrl = dependencies.readDatabaseUrl();
    dependencies.validateDatabaseUrl(databaseUrl);
    const database = dependencies.createDatabaseClient(databaseUrl ?? '');
    let output: string;
    try {
      output = JSON.stringify(await dependencies.inspect(database, commandClock));
    } finally {
      await database.$disconnect();
    }
    dependencies.writeStdout(`${output}\n`);
    return 0;
  } catch {
    dependencies.writeStderr(`${reportTriageInspectionFailureMessage}\n`);
    return 1;
  }
}
