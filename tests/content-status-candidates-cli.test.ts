import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../tools/content/status-candidates.ts', import.meta.url));
const batchPath = fileURLToPath(new URL('../content/imports/example-candidate-batch.json', import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thaidlt-candidate-status-'));
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
  expect(result.stderr.trim()).toBe('Candidate status failed. No status report was produced.');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('candidate status CLI boundary', () => {
  it('rejects missing, blank and extra paths with one generic failure', () => {
    const url = 'postgresql://candidate:secret@remote.invalid:5432/candidate';
    for (const args of [[], ['--'], [' '], [batchPath, 'extra'], ['--', batchPath, 'extra']]) {
      expectGenericFailure(runCli(url, ...args));
    }
  }, 15_000);

  it('rejects unreadable, oversized, malformed and invalid batches before usable database configuration', () => {
    const directory = temporaryDirectory();
    const missing = join(directory, 'private-missing-path.json');
    const oversized = join(directory, 'private-oversized-path.json');
    const malformed = join(directory, 'private-malformed-path.json');
    const invalid = join(directory, 'private-invalid-path.json');
    writeFileSync(oversized, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));
    writeFileSync(malformed, '{"private":"source-wording-must-not-print"');
    writeFileSync(invalid, JSON.stringify({ private: 'source-wording-must-not-print' }));
    const url = 'postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate';

    for (const path of [missing, oversized, malformed, invalid]) {
      const result = runCli(url, path);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain(path);
      expect(result.stderr).not.toContain('source-wording-must-not-print');
      expect(result.stderr).not.toContain('credential-must-not-print');
    }
  }, 15_000);

  it('rejects non-loopback configuration and unavailable PostgreSQL safely', () => {
    for (const url of [
      'postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate',
      'postgresql://candidate:credential-must-not-print@127.0.0.1:65534/candidate',
    ]) {
      const result = runCli(url, batchPath);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('credential-must-not-print');
      expect(result.stderr).not.toContain(batchPath);
    }
  });
});
