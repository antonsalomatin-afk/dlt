import { readRussianStemInputs } from './russian-stems.ts';

export const russianStemsFailureMessage = 'Russian stem overlay failed. No translations were applied.';
interface Database { $disconnect(): Promise<void> }
export async function runRussianStemsCli<Client extends Database>(dependencies: {
  args: string[];
  clock: Date;
  readDatabaseUrl: () => string | undefined;
  validateDatabaseUrl: (url: string | undefined) => unknown;
  createDatabaseClient: (url: string) => Client;
  overlay: (database: Client, inputs: ReturnType<typeof readRussianStemInputs>, apply: boolean) => Promise<{ wouldApply: number; applied: number; matched: number }>;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
}): Promise<0 | 1> {
  try {
    const args = dependencies.args[0] === '--' ? dependencies.args.slice(1) : dependencies.args;
    const apply = args[0] === '--apply';
    const paths = apply ? args.slice(1) : args;
    const [pack, review, first, second] = paths;
    if (paths.length !== 4 || !pack?.trim() || !review?.trim() || !first?.trim() || !second?.trim()
      || paths.some((path) => path.startsWith('--'))) throw new Error('Invalid arguments.');
    const inputs = readRussianStemInputs([pack, review, first, second], dependencies.clock);
    const url = dependencies.readDatabaseUrl();
    dependencies.validateDatabaseUrl(url);
    const database = dependencies.createDatabaseClient(url ?? '');
    let result;
    try { result = await dependencies.overlay(database, inputs, apply); }
    finally { await database.$disconnect(); }
    dependencies.writeStdout(`Russian stems: ${result.wouldApply} would apply, ${result.applied} applied, ${result.matched} matched.\n`);
    return 0;
  } catch {
    dependencies.writeStderr(`${russianStemsFailureMessage}\n`);
    return 1;
  }
}
