import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../tools/content/validate.ts', import.meta.url));
const examplePath = fileURLToPath(new URL('../content/imports/example-candidate-batch.json', import.meta.url));
const developmentPath = fileURLToPath(new URL('../content/fixtures/development.json', import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thaidlt-candidate-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgresql://must-not-connect.invalid/content' },
    timeout: 10_000,
  });
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('candidate batch validation CLI', () => {
  it('prints only the safe summary and performs no database or content mutation', () => {
    const before = [digest(examplePath), digest(developmentPath)];
    const result = runCli('--', examplePath);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('Batch synthetic-sample-2026-01; version 1; questions 1; choices 4');
    expect(result.stderr).toBe('');
    expect([digest(examplePath), digest(developmentPath)]).toEqual(before);
  });

  it('rejects missing, blank and extra path arguments', () => {
    for (const args of [[], ['--'], [' '], ['--', examplePath, examplePath]]) {
      const result = runCli(...args);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Candidate batch validation failed.');
      expect(result.stderr).toContain('$file:');
    }
  });

  it('rejects missing, unreadable and oversized files safely', () => {
    const directory = temporaryDirectory();
    const oversized = join(directory, 'oversized.json');
    writeFileSync(oversized, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));
    const paths = [join(directory, 'missing.json'), directory, oversized];

    for (const path of paths) {
      const result = runCli(path);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Candidate batch validation failed.');
      expect(result.stderr).not.toContain(path);
    }
  });

  it('rejects malformed JSON and invalid batches without printing source content', () => {
    const directory = temporaryDirectory();
    const malformed = join(directory, 'malformed.json');
    const invalid = join(directory, 'invalid.json');
    writeFileSync(malformed, '{"secret":"do-not-print"');
    writeFileSync(invalid, JSON.stringify({ privatePayload: 'do-not-print' }));

    const malformedResult = runCli(malformed);
    expect(malformedResult.status).not.toBe(0);
    expect(malformedResult.stderr).toContain('$: malformed JSON.');
    expect(malformedResult.stderr).not.toContain('do-not-print');

    const invalidResult = runCli(invalid);
    expect(invalidResult.status).not.toBe(0);
    expect(invalidResult.stderr).toContain('Candidate batch validation failed.');
    expect(invalidResult.stderr).toContain('$');
    expect(invalidResult.stderr).not.toContain('privatePayload');
    expect(invalidResult.stderr).not.toContain('do-not-print');
  });

  it('bounds validation output to twenty path-based diagnostics', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'many-errors.json');
    const example: unknown = JSON.parse(readFileSync(examplePath, 'utf8'));
    if (typeof example !== 'object' || example === null || !('questions' in example) || !Array.isArray(example.questions)) {
      throw new Error('Invalid test example.');
    }
    const first = example.questions[0];
    writeFileSync(path, JSON.stringify({
      ...example,
      questions: Array.from({ length: 30 }, (_, index) => ({
        ...(typeof first === 'object' && first !== null ? first : {}),
        externalId: `cli-error-${index}`,
        [`secret-field-${index}`]: 'secret-value',
      })),
    }));

    const result = runCli(path);
    const lines = result.stderr.trim().split(/\r?\n/u);
    expect(result.status).not.toBe(0);
    expect(lines[0]).toBe('Candidate batch validation failed.');
    expect(lines).toHaveLength(21);
    expect(lines.slice(1).every((line) => line.startsWith('$.questions['))).toBe(true);
    expect(result.stderr).not.toContain('secret-field');
    expect(result.stderr).not.toContain('secret-value');
  });
});
