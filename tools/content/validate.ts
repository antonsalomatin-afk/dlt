import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { ZodError } from 'zod';
import {
  formatCandidateDiagnostics,
  MAX_CANDIDATE_FILE_BYTES,
  parseCandidateBatch,
  summarizeCandidateBatch,
} from './candidates.ts';

const failureHeading = 'Candidate batch validation failed.';

function fail(diagnostics: string[]): never {
  console.error(failureHeading);
  for (const diagnostic of diagnostics) console.error(diagnostic.slice(0, 240));
  process.exit(1);
}

function readBoundedFile(path: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    const size = fstatSync(descriptor).size;
    if (!Number.isSafeInteger(size) || size > MAX_CANDIDATE_FILE_BYTES) {
      fail(['$file: exceeds the 5 MiB limit.']);
    }
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const bytesRead = readSync(descriptor, buffer, offset, size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== size || fstatSync(descriptor).size !== size) {
      fail(['$file: changed while it was being read.']);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return fail(['$file: could not read the supplied local UTF-8 file.']);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const rawArguments = process.argv.slice(2);
const argumentsAfterCommand = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
const suppliedPath = argumentsAfterCommand[0];
if (argumentsAfterCommand.length !== 1 || suppliedPath === undefined || suppliedPath.trim().length === 0) {
  fail(['$file: supply exactly one nonblank local JSON file path.']);
}

const json = readBoundedFile(suppliedPath);
let input: unknown;
try {
  input = JSON.parse(json) as unknown;
} catch {
  fail(['$: malformed JSON.']);
}

try {
  const summary = summarizeCandidateBatch(parseCandidateBatch(input));
  console.log(`Batch ${summary.batchId}; version ${summary.version}; questions ${summary.questions}; choices ${summary.choices}`);
} catch (error) {
  if (error instanceof ZodError) fail(formatCandidateDiagnostics(error));
  fail(['$: validation could not be completed.']);
}
