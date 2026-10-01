import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../tools/content/import-candidates.ts', import.meta.url));
const examplePath = fileURLToPath(new URL('../content/imports/example-candidate-batch.json', import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thaidlt-candidate-import-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runCli(databaseUrl: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 10_000,
  });
}

function expectGenericFailure(result: ReturnType<typeof runCli>) {
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim()).toBe('Candidate import failed. No candidate content was imported.');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('candidate import CLI input boundary', () => {
  it('rejects missing, blank and extra paths with one generic failure', () => {
    const databaseUrl = 'postgresql://candidate:secret@not-loopback.invalid:5432/candidate';
    for (const args of [[], ['--'], [' '], ['--', examplePath, examplePath]]) {
      expectGenericFailure(runCli(databaseUrl, ...args));
    }
  }, 20_000);

  it('rejects missing, unreadable, oversized, malformed and invalid files before usable database configuration', () => {
    const directory = temporaryDirectory();
    const oversized = join(directory, 'oversized.json');
    const malformed = join(directory, 'malformed.json');
    const invalid = join(directory, 'invalid.json');
    writeFileSync(oversized, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));
    writeFileSync(malformed, '{"private":"source-wording-must-not-print"');
    writeFileSync(invalid, JSON.stringify({ private: 'source-wording-must-not-print' }));
    const databaseUrl = 'postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate';

    for (const path of [join(directory, 'missing.json'), directory, oversized, malformed, invalid]) {
      const result = runCli(databaseUrl, path);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('source-wording-must-not-print');
      expect(result.stderr).not.toContain('credential-must-not-print');
      expect(result.stderr).not.toContain(path);
    }
  }, 20_000);

  it('rejects valid input with non-loopback configuration or an unavailable loopback database safely', () => {
    const nonLoopback = runCli('postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate', examplePath);
    expectGenericFailure(nonLoopback);
    expect(nonLoopback.stderr).not.toContain('credential-must-not-print');

    const unavailable = runCli('postgresql://candidate:credential-must-not-print@127.0.0.1:65534/candidate', examplePath);
    expectGenericFailure(unavailable);
    expect(unavailable.stderr).not.toContain('credential-must-not-print');
    expect(unavailable.stderr).not.toContain(readFileSync(examplePath, 'utf8'));
  }, 15_000);
});
