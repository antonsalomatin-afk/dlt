import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../tools/content/review-candidates.ts', import.meta.url));
const batchPath = fileURLToPath(new URL('../content/imports/example-candidate-batch.json', import.meta.url));
const manifestPath = fileURLToPath(new URL('../content/imports/example-candidate-review.json', import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thaidlt-candidate-review-'));
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
  expect(result.stderr.trim()).toBe('Candidate review failed. No review decisions were applied.');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('candidate review CLI boundary', () => {
  it('rejects missing, blank and extra paths with one generic failure', () => {
    const url = 'postgresql://candidate:secret@remote.invalid:5432/candidate';
    for (const args of [[], ['--'], [batchPath], ['--', batchPath], [batchPath, ' '], ['--', batchPath, manifestPath, 'extra']]) {
      expectGenericFailure(runCli(url, ...args));
    }
  }, 20_000);

  it('fully rejects invalid candidate and manifest files before usable database configuration', () => {
    const directory = temporaryDirectory();
    const missing = join(directory, 'missing.json');
    const oversized = join(directory, 'oversized.json');
    const malformed = join(directory, 'malformed.json');
    const invalid = join(directory, 'invalid.json');
    writeFileSync(oversized, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));
    writeFileSync(malformed, '{"private":"source-and-reviewer-must-not-print"');
    writeFileSync(invalid, JSON.stringify({ reviewer: 'source-and-reviewer-must-not-print' }));
    const url = 'postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate';
    const pairs = [
      [missing, manifestPath],
      [directory, manifestPath],
      [oversized, manifestPath],
      [malformed, manifestPath],
      [invalid, manifestPath],
      [batchPath, missing],
      [batchPath, directory],
      [batchPath, oversized],
      [batchPath, malformed],
      [batchPath, invalid],
    ];

    for (const [candidate, manifest] of pairs) {
      if (candidate === undefined || manifest === undefined) throw new Error('Missing CLI test path.');
      const result = runCli(url, candidate, manifest);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('source-and-reviewer-must-not-print');
      expect(result.stderr).not.toContain('credential-must-not-print');
      expect(result.stderr).not.toContain(candidate);
      expect(result.stderr).not.toContain(manifest);
    }
  }, 30_000);

  it('rejects valid files with non-loopback configuration or an unavailable loopback database safely', () => {
    const nonLoopback = runCli(
      'postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate',
      batchPath,
      manifestPath,
    );
    expectGenericFailure(nonLoopback);
    expect(nonLoopback.stderr).not.toContain('credential-must-not-print');
    expect(nonLoopback.stderr).not.toContain('Synthetic Example Reviewer');

    const unavailable = runCli(
      'postgresql://candidate:credential-must-not-print@127.0.0.1:65534/candidate',
      batchPath,
      manifestPath,
    );
    expectGenericFailure(unavailable);
    expect(unavailable.stderr).not.toContain('credential-must-not-print');
    expect(unavailable.stderr).not.toContain('Synthetic Example Reviewer');
  }, 15_000);
});
