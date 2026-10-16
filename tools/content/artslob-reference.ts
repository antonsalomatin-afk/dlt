import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

export const ARTSLOB_REVISION = '67440927542ae7af7cebe4181c93a2dec07b1259';
export const MAX_REFERENCE_PAGE_BYTES = 64 * 1024;
const MAX_PAGES = 500;
const SOURCE = 'https://github.com/artslob/thailand-driving-exam-questions';
export const REFERENCE_FAILURE = 'Reference intake failed. No inventory was written.';

export interface ReferenceRecord {
  sourceId: number;
  sourceReference: string;
  originalSourcePages: number[];
  sourceSha256: string;
  contentSha256: string | null;
  questionEnglish: string | null;
  choices: { key: string; textEnglish: string; upstreamAnswerMarker: boolean }[];
  upstreamAnswerKeys: string[];
  imageReferences: string[];
  imageDependent: boolean;
  malformed: boolean;
  issues: string[];
  duplicateOf: number | null;
  vehicleApplicability: 'UNREVIEWED';
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

// Deliberately supports only the upstream static text format, never a DOM or JS runtime.
function plainText(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  if (/[<>]/u.test(value)) throw new Error('unsupported-markup');
  const decoded = value.replace(/&([^;\s]+);/gu, (_, entity: string) => {
    const named = entities[entity];
    if (named !== undefined) return named;
    if (!/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/u.test(entity)) throw new Error('unsupported-entity');
    const code = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('unsupported-entity');
    return String.fromCodePoint(code);
  });
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(decoded)) throw new Error('unsafe-text');
  const text = decoded.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 4000) throw new Error('invalid-text');
  return text;
}

function stringLiteral(value: string): string {
  return value.replace(/\\(.)/gsu, (_, escaped: string) => {
    if (escaped === "'" || escaped === '\\' || escaped === '"') return escaped;
    throw new Error('unsupported-js-escape');
  });
}

export function parseReferencePage(sourceId: number, bytes: Buffer): ReferenceRecord {
  if (!Number.isSafeInteger(sourceId) || sourceId < 1 || bytes.length > MAX_REFERENCE_PAGE_BYTES) throw new Error('invalid-page');
  const record: ReferenceRecord = {
    sourceId, sourceReference: `${SOURCE}/blob/${ARTSLOB_REVISION}/output/${sourceId}/index.html`,
    originalSourcePages: [], sourceSha256: sha256(bytes), contentSha256: null,
    questionEnglish: null, choices: [], upstreamAnswerKeys: [], imageReferences: [],
    imageDependent: false, malformed: false, issues: [], duplicateOf: null, vehicleApplicability: 'UNREVIEWED',
  };
  try {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    record.imageDependent = /<img\b/iu.test(html);
    const imageTags = [...html.matchAll(/<img\b[^>]*>/giu)];
    for (const match of imageTags) {
      const image = /^<img src="(\.\.\/images\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)(?:\.webp)?)"\s*\/?>$/u.exec(match[0]);
      if (!image?.[1]) throw new Error('unsupported-image');
      record.imageReferences.push(image[1]);
    }
    if (record.imageDependent && imageTags.length === 0) throw new Error('unsupported-image');
    record.imageReferences = [...new Set(record.imageReferences)].sort();
    const sourcePages = [...html.matchAll(/\/\/ ([1-9][0-9]{0,3}) original source page\b/gu)];
    if (sourcePages.length !== 1) throw new Error('invalid-source-page-marker');
    record.originalSourcePages = sourcePages.map((match) => Number(match[1]));
    const questions = [...html.matchAll(/<h3>([\s\S]*?)<\/h3>/gu)];
    if (questions.length !== 1 || questions[0]?.[1] === undefined) throw new Error('invalid-question');
    record.questionEnglish = plainText(questions[0][1]);
    const arrays = [...html.matchAll(/\bvar options = \[([\s\S]*?)\];/gu)];
    if (arrays.length !== 1 || arrays[0]?.[1] === undefined) throw new Error('invalid-options');
    let remaining = arrays[0][1].trim();
    while (remaining.length > 0) {
      const literal = /^'((?:\\[^\r\n]|[^'\\])*)'\s*,\s*/u.exec(remaining);
      if (!literal?.[1] || record.choices.length === 4) throw new Error('invalid-option-literal');
      const option = /^<p (class="answer")?>([\s\S]*)<\/p>$/u.exec(stringLiteral(literal[1]));
      if (!option || option[2] === undefined) throw new Error('unsupported-option');
      const key = String.fromCharCode(65 + record.choices.length);
      record.choices.push({ key, textEnglish: plainText(option[2]), upstreamAnswerMarker: option[1] !== undefined });
      remaining = remaining.slice(literal[0].length);
    }
    record.upstreamAnswerKeys = record.choices.filter((choice) => choice.upstreamAnswerMarker).map((choice) => choice.key);
    if (record.choices.length !== 4) throw new Error('invalid-choice-count');
    if (record.upstreamAnswerKeys.length !== 1) throw new Error('invalid-upstream-answer-count');
    const wording = record.choices.map((choice) => normalized(choice.textEnglish));
    if (new Set(wording).size !== 4) throw new Error('duplicate-choice-text');
    const markedWording = record.choices.filter((choice) => choice.upstreamAnswerMarker).map((choice) => normalized(choice.textEnglish));
    record.contentSha256 = sha256(JSON.stringify([normalized(record.questionEnglish), wording.sort(), markedWording.sort(), record.imageReferences]));
  } catch (error) {
    record.malformed = true;
    const safeIssues = new Set(['unsupported-markup', 'unsupported-entity', 'unsafe-text', 'invalid-text', 'unsupported-js-escape', 'unsupported-image', 'invalid-source-page-marker', 'invalid-question', 'invalid-options', 'invalid-option-literal', 'unsupported-option', 'invalid-choice-count', 'invalid-upstream-answer-count', 'duplicate-choice-text']);
    record.issues = [error instanceof Error && safeIssues.has(error.message) ? error.message : 'invalid-encoding-or-format'];
  }
  return record;
}

export function assembleReferenceInventory(records: ReferenceRecord[]) {
  if (!records.length || records.length > MAX_PAGES || new Set(records.map((record) => record.sourceId)).size !== records.length) throw new Error('invalid-record-set');
  const items = [...records].sort((a, b) => a.sourceId - b.sourceId).map((record) => ({ ...record }));
  const hashes = new Map<string, number>();
  for (const record of items) {
    if (record.malformed || record.contentSha256 === null) continue;
    record.duplicateOf = hashes.get(record.contentSha256) ?? null;
    if (record.duplicateOf === null) hashes.set(record.contentSha256, record.sourceId);
  }
  return {
    version: 1, source: SOURCE, revision: ARTSLOB_REVISION,
    boundary: 'UNREVIEWED_REFERENCE_ONLY',
    summary: {
      total: items.length,
      malformed: items.filter((record) => record.malformed).length,
      imageDependent: items.filter((record) => record.imageDependent).length,
      duplicates: items.filter((record) => record.duplicateOf !== null).length,
      structurallyValidText: items.filter((record) => !record.malformed && !record.imageDependent).length,
      textReviewCandidates: items.filter((record) => !record.malformed && !record.imageDependent && record.duplicateOf === null).length,
    },
    records: items,
  };
}

function noLinks(path: string): void {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current).isSymbolicLink()) throw new Error('unsafe-path');
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function boundedRead(path: string): Buffer {
  noLinks(path);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > MAX_REFERENCE_PAGE_BYTES) throw new Error('invalid-file');
    const data = Buffer.alloc(before.size + 1);
    // A bounded read also detects growth without allocating unbounded external input.
    const bytes = readFileBounded(descriptor, data);
    const after = fstatSync(descriptor);
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('changed-file');
    return data.subarray(0, bytes);
  } finally { closeSync(descriptor); }
}

function readFileBounded(descriptor: number, data: Buffer): number {
  let total = 0;
  while (total < data.length) {
    const count = readSync(descriptor, data, total, data.length - total, null);
    if (count === 0) break;
    total += count;
  }
  return total;
}

function gitMetadata(sourceRoot: string, args: string[]): string {
  // These two read-only plumbing commands do not run source scripts, hooks or filters.
  return execFileSync('git', ['--no-optional-locks', '-C', sourceRoot, ...args], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function prepareReferenceInventory(sourcePath: string, destination: string, repositoryRoot: string) {
  if (!sourcePath.trim() || /[\p{Cc}\p{Cf}]/u.test(sourcePath) || !/^\.local-content\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(destination)) throw new Error('invalid-arguments');
  const repo = realpathSync(repositoryRoot);
  noLinks(repositoryRoot);
  const sourceRoot = resolve(sourcePath);
  noLinks(sourceRoot);
  if (!isAbsolute(sourceRoot) || sourceRoot === parse(sourceRoot).root || !lstatSync(sourceRoot).isDirectory()) throw new Error('unsafe-source');
  noLinks(join(sourceRoot, '.git'));
  if (gitMetadata(sourceRoot, ['rev-parse', '--verify', 'HEAD']).trim() !== ARTSLOB_REVISION) throw new Error('wrong-revision');
  const tree = gitMetadata(sourceRoot, ['ls-tree', '-r', '--full-tree', 'HEAD', '--', 'output']);
  const blobs = new Map<string, string>();
  for (const line of tree.trim().split('\n')) {
    const match = /^100644 blob ([a-f0-9]{40})\t(output\/[1-9][0-9]{0,3}\/index\.html)$/u.exec(line);
    if (match?.[1] && match[2]) blobs.set(match[2], match[1]);
  }
  const outputRoot = join(sourceRoot, 'output');
  noLinks(outputRoot);
  const entries = readdirSync(outputRoot, { withFileTypes: true });
  if (entries.length > MAX_PAGES + 2) throw new Error('too-many-pages');
  const pageNames: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'index.html' && entry.isFile() && !entry.isSymbolicLink()) continue;
    if (entry.name === 'images' && entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!/^[1-9][0-9]{0,3}$/u.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) throw new Error('unsupported-page-directory');
    pageNames.push(entry.name);
  }
  if (pageNames.length !== 420 || blobs.size !== 420) throw new Error('incomplete-pinned-source');
  const records = pageNames.map((name) => {
    const pagePath = `output/${name}/index.html`;
    const bytes = boundedRead(join(sourceRoot, pagePath));
    const blobHash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (blobs.get(pagePath) !== blobHash) throw new Error('changed-pinned-source');
    return parseReferencePage(Number(name), bytes);
  });
  const inventory = assembleReferenceInventory(records);
  const staging = join(repo, '.local-content');
  const target = resolve(repo, destination);
  if (relative(staging, target).includes('..') || existsSync(target)) throw new Error('unsafe-or-existing-destination');
  if (!existsSync(staging)) mkdirSync(staging);
  noLinks(staging);
  if (!lstatSync(staging).isDirectory()) throw new Error('unsafe-staging');
  mkdirSync(target);
  const inventoryPath = join(target, 'inventory.json');
  try {
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (existsSync(inventoryPath)) unlinkSync(inventoryPath);
    rmdirSync(target);
    throw error;
  }
  return inventory.summary;
}
