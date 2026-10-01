import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../tools/content/activate-candidates.ts', import.meta.url));
const batchPath = fileURLToPath(new URL('../content/imports/example-candidate-batch.json', import.meta.url));
const reviewPath = fileURLToPath(new URL('../content/imports/example-candidate-review.json', import.meta.url));
const activationPath = fileURLToPath(new URL('../content/imports/example-candidate-activation.json', import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thaidlt-candidate-activation-'));
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
  expect(result.stderr.trim()).toBe('Candidate activation failed. No candidates were activated.');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('candidate activation CLI boundary', () => {
  it('rejects missing, blank and extra paths with one generic failure', () => {
    const url = 'postgresql://candidate:secret@remote.invalid:5432/candidate';
    for (const args of [
      [], ['--'], [batchPath], [batchPath, reviewPath],
      [batchPath, reviewPath, ' '], ['--', batchPath, reviewPath, activationPath, 'extra'],
    ]) expectGenericFailure(runCli(url, ...args));
  }, 15_000);

  it('rejects invalid files at each layer before usable database configuration', () => {
    const directory = temporaryDirectory();
    const missing = join(directory, 'missing.json');
    const oversized = join(directory, 'oversized.json');
    const malformed = join(directory, 'malformed.json');
    const invalid = join(directory, 'invalid.json');
    writeFileSync(oversized, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));
    writeFileSync(malformed, '{"private":"operator-reviewer-source-must-not-print"');
    writeFileSync(invalid, JSON.stringify({ private: 'operator-reviewer-source-must-not-print' }));
    const url = 'postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate';
    const triples = [
      [missing, reviewPath, activationPath],
      [oversized, reviewPath, activationPath],
      [malformed, reviewPath, activationPath],
      [invalid, reviewPath, activationPath],
      [batchPath, missing, activationPath],
      [batchPath, oversized, activationPath],
      [batchPath, malformed, activationPath],
      [batchPath, invalid, activationPath],
      [batchPath, reviewPath, missing],
      [batchPath, reviewPath, oversized],
      [batchPath, reviewPath, malformed],
      [batchPath, reviewPath, invalid],
    ];
    for (const [candidate, review, activation] of triples) {
      if (candidate === undefined || review === undefined || activation === undefined) throw new Error('Missing CLI path.');
      const result = runCli(url, candidate, review, activation);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('operator-reviewer-source-must-not-print');
      expect(result.stderr).not.toContain('credential-must-not-print');
      expect(result.stderr).not.toContain(candidate);
      expect(result.stderr).not.toContain(review);
      expect(result.stderr).not.toContain(activation);
    }
  }, 20_000);

  it('rejects valid files with non-loopback configuration or unavailable PostgreSQL safely', () => {
    for (const url of [
      'postgresql://candidate:credential-must-not-print@remote.invalid:5432/candidate',
      'postgresql://candidate:credential-must-not-print@127.0.0.1:65534/candidate',
    ]) {
      const result = runCli(url, batchPath, reviewPath, activationPath);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('credential-must-not-print');
      expect(result.stderr).not.toContain('Synthetic Example Operator');
      expect(result.stderr).not.toContain('Synthetic Example Reviewer');
    }
  });
});
