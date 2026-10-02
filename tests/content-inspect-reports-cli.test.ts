import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../tools/content/inspect-reports.ts', import.meta.url));
const failureMessage = 'Report inspection failed. No report inventory was produced.';

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
  expect(result.stderr.trim()).toBe(failureMessage);
}

describe('report inspection CLI boundary', () => {
  it('accepts exactly zero arguments and rejects all supplied arguments before database access', () => {
    const unavailable = 'postgresql://reports:secret@127.0.0.1:65534/reports';
    for (const args of [['--'], [' '], ['report.json'], ['one', 'two']]) {
      const result = runCli(unavailable, ...args);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('secret');
      if (args.join(' ').trim().length > 0) expect(result.stderr).not.toContain(args.join(' '));
    }
  }, 20_000);

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

  it('fails safely when the loopback database is unavailable', () => {
    const result = runCli('postgresql://reports:credential-must-not-print@127.0.0.1:65534/reports');
    expectGenericFailure(result);
    expect(result.stderr).not.toContain('credential-must-not-print');
    expect(result.stderr).not.toContain('127.0.0.1');
    expect(result.stderr).not.toContain('SQL');
  }, 15_000);
});
