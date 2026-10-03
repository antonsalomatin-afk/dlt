import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  reportTriageInspectionFailureMessage,
  runReportTriageInspectionCli,
} from '../tools/content/report-triage-inspection-cli.ts';

const cliPath = fileURLToPath(new URL('../tools/content/inspect-report-triage.ts', import.meta.url));

function runCli(databaseUrl: string | undefined, ...args: string[]) {
  const env = { ...process.env };
  if (databaseUrl === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = databaseUrl;
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env,
    timeout: 10_000,
    windowsHide: true,
  });
}

function expectGenericFailure(result: ReturnType<typeof runCli>) {
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim()).toBe(reportTriageInspectionFailureMessage);
}

describe('report triage inspection CLI boundary', () => {
  it('rejects every supplied argument before clock or configuration access', async () => {
    const url = 'postgresql://reports:secret@127.0.0.1:65534/reports';
    for (const args of [['--'], [' '], ['audit.json'], ['one', 'two']]) {
      const result = runCli(url, ...args);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('secret');
    }

    const events: string[] = [];
    const result = await fakeRun({
      args: ['unexpected'],
      now: () => { events.push('clock'); return new Date(); },
      readDatabaseUrl: () => { events.push('database-url'); return undefined; },
    });
    expect(result.status).toBe(1);
    expect(events).toEqual([]);
  }, 20_000);

  it('captures one command clock before reading database configuration', async () => {
    const events: string[] = [];
    const clock = new Date('2026-10-03T12:00:00.000Z');
    const result = await fakeRun({
      now: () => { events.push('clock'); return clock; },
      readDatabaseUrl: () => { events.push('database-url'); return 'postgresql://reports:secret@127.0.0.1:5432/reports'; },
      inspect: async (_database, receivedClock) => {
        events.push('inspect');
        expect(receivedClock).toBe(clock);
        return emptyInventory();
      },
    });
    expect(result.status).toBe(0);
    expect(events).toEqual(['clock', 'database-url', 'inspect']);
    expect(result.stdout).toEqual([`${JSON.stringify(emptyInventory())}\n`]);
    expect(result.stderr).toEqual([]);
  });

  it('rejects missing and non-loopback configuration with the stable no-stdout failure', () => {
    for (const databaseUrl of [
      undefined,
      '',
      'postgresql://reports:credential-must-not-print@remote.invalid:5432/reports',
      'postgresql://reports:credential-must-not-print@localhost:5432/reports',
    ]) {
      const result = runCli(databaseUrl);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('credential-must-not-print');
    }
  }, 20_000);

  it('fails safely when loopback PostgreSQL is unavailable', () => {
    const result = runCli('postgresql://reports:credential-must-not-print@127.0.0.1:65534/reports');
    expectGenericFailure(result);
    expect(result.stderr).not.toContain('credential-must-not-print');
    expect(result.stderr).not.toContain('127.0.0.1');
    expect(result.stderr).not.toContain('SQL');
  }, 15_000);

  it('withholds buffered audit output when disconnect rejects', async () => {
    const events: string[] = [];
    const result = await fakeRun({
      inspect: async () => { events.push('inspect'); return emptyInventory(); },
      disconnect: async () => {
        events.push('disconnect');
        throw new Error('synthetic disconnect failure');
      },
    });
    expect(result.status).toBe(1);
    expect(events).toEqual(['inspect', 'disconnect']);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([`${reportTriageInspectionFailureMessage}\n`]);
  });
});

function emptyInventory() {
  return {
    version: 1 as const,
    summary: {
      total: 0,
      practice: 0,
      exam: 0,
      pending: 0,
      actionRequired: 0,
      noActionRequired: 0,
    },
    items: [],
  };
}

async function fakeRun(overrides: {
  args?: string[];
  now?: () => Date;
  readDatabaseUrl?: () => string | undefined;
  inspect?: (_database: { $disconnect(): Promise<void> }, commandClock: Date) => Promise<ReturnType<typeof emptyInventory>>;
  disconnect?: () => Promise<void>;
}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const status = await runReportTriageInspectionCli({
    args: overrides.args ?? [],
    now: overrides.now ?? (() => new Date('2026-10-03T12:00:00.000Z')),
    readDatabaseUrl: overrides.readDatabaseUrl ?? (() => 'postgresql://reports:secret@127.0.0.1:5432/reports'),
    validateDatabaseUrl: () => undefined,
    createDatabaseClient: () => ({ $disconnect: overrides.disconnect ?? (async () => undefined) }),
    inspect: overrides.inspect ?? (async () => emptyInventory()),
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
  });
  return { status, stdout, stderr };
}
