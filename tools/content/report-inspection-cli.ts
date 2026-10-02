export const reportInspectionFailureMessage = 'Report inspection failed. No report inventory was produced.';

interface DisconnectableDatabase {
  $disconnect(): Promise<void>;
}

export interface ReportInspectionCliDependencies<Database extends DisconnectableDatabase> {
  args: string[];
  readDatabaseUrl: () => string | undefined;
  validateDatabaseUrl: (value: string | undefined) => unknown;
  createDatabaseClient: (databaseUrl: string) => Database;
  inspect: (database: Database) => Promise<unknown>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

export async function runReportInspectionCli<Database extends DisconnectableDatabase>(
  dependencies: ReportInspectionCliDependencies<Database>,
): Promise<0 | 1> {
  try {
    if (dependencies.args.length !== 0) throw new Error('Invalid arguments.');
    const databaseUrl = dependencies.readDatabaseUrl();
    dependencies.validateDatabaseUrl(databaseUrl);
    const database = dependencies.createDatabaseClient(databaseUrl ?? '');
    let output: string;
    try {
      output = JSON.stringify(await dependencies.inspect(database));
    } finally {
      await database.$disconnect();
    }
    dependencies.writeStdout(`${output}\n`);
    return 0;
  } catch {
    dependencies.writeStderr(`${reportInspectionFailureMessage}\n`);
    return 1;
  }
}
