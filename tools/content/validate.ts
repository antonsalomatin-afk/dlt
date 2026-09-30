import { ZodError } from 'zod';
import {
  CandidateFileError,
  candidatePathArgument,
  formatCandidateDiagnostics,
  readCandidateBatchFile,
  summarizeCandidateBatch,
} from './candidates.ts';

const failureHeading = 'Candidate batch validation failed.';

function fail(diagnostics: string[]): never {
  console.error(failureHeading);
  for (const diagnostic of diagnostics) console.error(diagnostic.slice(0, 240));
  process.exit(1);
}

const suppliedPath = candidatePathArgument(process.argv.slice(2));
if (suppliedPath === undefined) {
  fail(['$file: supply exactly one nonblank local JSON file path.']);
}

try {
  const summary = summarizeCandidateBatch(readCandidateBatchFile(suppliedPath));
  console.log(`Batch ${summary.batchId}; version ${summary.version}; questions ${summary.questions}; choices ${summary.choices}`);
} catch (error) {
  if (error instanceof CandidateFileError) {
    if (error.failure === 'oversized') fail(['$file: exceeds the 5 MiB limit.']);
    if (error.failure === 'changed') fail(['$file: changed while it was being read.']);
    if (error.failure === 'malformed') fail(['$: malformed JSON.']);
    fail(['$file: could not read the supplied local UTF-8 file.']);
  }
  if (error instanceof ZodError) fail(formatCandidateDiagnostics(error));
  fail(['$: validation could not be completed.']);
}
