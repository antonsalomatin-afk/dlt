import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CandidateFileError } from '../tools/content/candidates.ts';
import {
  reportTriageFailureMessage,
  runReportTriageCli,
} from '../tools/content/report-triage-cli.ts';
import { parseReportTriageManifest } from '../tools/content/report-triage.ts';

const cliPath = fileURLToPath(new URL('../tools/content/triage-reports.ts', import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'thaidlt-report-triage-'));
  temporaryDirectories.push(directory);
  return directory;
}

function validManifest() {
  const questionId = '00000000-0000-4000-8000-000000000001';
  return {
    version: 1,
    triagedBy: 'Trusted CLI Reviewer',
    triagedAt: '2020-01-01T01:00:00.000Z',
    decisions: [{
      reportId: '00000000-0000-4000-8000-000000000002',
      kind: 'PRACTICE',
      createdAt: '2020-01-01T00:00:00.000Z',
      details: 'Confidential allegation text.',
      questionId,
      anchorId: '00000000-0000-4000-8000-000000000003',
      snapshot: {
        version: 1,
        question: {
          id: questionId,
          textThai: null,
          textExamEnglish: null,
          textEnglish: 'Synthetic wording',
          textRussian: null,
          choices: (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
            id: `00000000-0000-4000-8000-${(10 + index).toString().padStart(12, '0')}`,
            key,
            textThai: null,
            textEnglish: `Choice ${key}`,
            textRussian: null,
          })),
        },
        correctChoiceId: '00000000-0000-4000-8000-000000000010',
        explanationThai: null,
        explanationEnglish: 'Explanation',
        explanationRussian: null,
        trapExplanationThai: null,
        trapExplanationEnglish: 'Trap explanation',
        trapExplanationRussian: null,
      },
      decision: 'ACTION_REQUIRED',
    }],
  };
}

function runCli(databaseUrl: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 10_000,
    windowsHide: true,
  });
}

function expectGenericFailure(result: ReturnType<typeof runCli>) {
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim()).toBe(reportTriageFailureMessage);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('report triage CLI boundary', () => {
  it('rejects missing, blank and extra paths before configuration access', () => {
    const url = 'postgresql://reports:secret@remote.invalid:5432/reports';
    for (const args of [[], ['--'], [' '], ['one.json', 'two.json'], ['--', 'one.json', 'two.json']]) {
      const result = runCli(url, ...args);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('secret');
    }
  }, 20_000);

  it('rejects unreadable, oversized, malformed and invalid confidential files before configuration', () => {
    const directory = temporaryDirectory();
    const missing = join(directory, 'missing-private.json');
    const oversized = join(directory, 'oversized-private.json');
    const malformed = join(directory, 'malformed-private.json');
    const invalid = join(directory, 'invalid-private.json');
    writeFileSync(oversized, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));
    writeFileSync(malformed, '{"triagedBy":"private-operator"');
    writeFileSync(invalid, JSON.stringify({ triagedBy: 'private-operator', evidence: 'private-allegation' }));
    const url = 'postgresql://reports:credential-must-not-print@remote.invalid:5432/reports';
    for (const path of [missing, directory, oversized, malformed, invalid]) {
      const result = runCli(url, path);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain(path);
      expect(result.stderr).not.toContain('private-operator');
      expect(result.stderr).not.toContain('private-allegation');
      expect(result.stderr).not.toContain('credential-must-not-print');
    }
  }, 25_000);

  it('rejects non-loopback configuration and unavailable PostgreSQL without evidence leakage', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'confidential-triage.json');
    writeFileSync(path, JSON.stringify(validManifest()));
    for (const url of [
      'postgresql://reports:credential-must-not-print@remote.invalid:5432/reports',
      'postgresql://reports:credential-must-not-print@127.0.0.1:65534/reports',
    ]) {
      const result = runCli(url, path);
      expectGenericFailure(result);
      expect(result.stderr).not.toContain('credential-must-not-print');
      expect(result.stderr).not.toContain('Trusted CLI Reviewer');
      expect(result.stderr).not.toContain('Confidential allegation text');
      expect(result.stderr).not.toContain(path);
    }
  }, 15_000);

  it('treats a changing file as a generic pre-database failure', async () => {
    const events: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await runReportTriageCli({
      args: ['changing.json'],
      parsePath: (args) => args[0],
      now: () => new Date('2026-10-03T12:00:00.000Z'),
      readManifest: () => {
        events.push('read-manifest');
        throw new CandidateFileError('changed');
      },
      readDatabaseUrl: () => { events.push('read-database-url'); return undefined; },
      validateDatabaseUrl: () => events.push('validate-database-url'),
      createDatabaseClient: () => ({ $disconnect: async () => undefined }),
      apply: async () => ({
        version: 1,
        summary: { total: 0, actionRequired: 0, noActionRequired: 0, applied: 0, matched: 0 },
      }),
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    });
    expect(result).toBe(1);
    expect(events).toEqual(['read-manifest']);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`${reportTriageFailureMessage}\n`]);
  });

  it('buffers success until disconnect and emits only the generic failure when disconnect rejects', async () => {
    const parsed = parseReportTriageManifest(validManifest(), new Date('2026-10-03T12:00:00.000Z'));
    const events: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await runReportTriageCli({
      args: ['triage.json'],
      parsePath: (args) => args[0],
      now: () => new Date('2026-10-03T12:00:00.000Z'),
      readManifest: () => parsed,
      readDatabaseUrl: () => 'postgresql://reports:secret@127.0.0.1:5432/reports',
      validateDatabaseUrl: () => events.push('validate'),
      createDatabaseClient: () => ({
        $disconnect: async () => {
          events.push('disconnect');
          throw new Error('synthetic disconnect failure');
        },
      }),
      apply: async () => {
        events.push('apply');
        return {
          version: 1,
          summary: { total: 1, actionRequired: 1, noActionRequired: 0, applied: 1, matched: 0 },
        };
      },
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    });
    expect(result).toBe(1);
    expect(events).toEqual(['validate', 'apply', 'disconnect']);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`${reportTriageFailureMessage}\n`]);
  });
});
