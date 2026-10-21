import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { readCandidateBatchFile, readBoundedJsonFile } from '../tools/content/candidates.ts';
import { canonicalJsonSha256, parseRussianStemPack, parseRussianStemReview } from '../tools/content/russian-stems.ts';
import { runRussianStemsCli, russianStemsFailureMessage } from '../tools/content/russian-stems-cli.ts';

const sourcePaths = ['content/imports/launch-20261016-car-candidates.json', 'content/imports/launch-20261016-motorcycle-candidates.json'];
const batches = sourcePaths.map(readCandidateBatchFile);
const clock = new Date('2026-10-21T02:00:00.000Z');
const pack = parseRussianStemPack(readBoundedJsonFile('content/imports/launch-20261021-russian-stems.json'), batches, clock);
const review = { version: 1, packSha256: canonicalJsonSha256(pack), reviewer: 'SYNTHETIC TEST REVIEW ONLY', reviewedAt: '2026-10-21T01:00:00.000Z', verdict: 'PASS' };
const directory = mkdtempSync(join(tmpdir(), 'russian-stems-unit-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it('validates every real draft translation and hashes parsed JSON independently of keys, indentation and line endings', () => {
  expect(pack.translations).toHaveLength(100);
  expect(parseRussianStemReview(review, pack, clock)).toEqual(review);
  const pretty = JSON.stringify(pack, null, 2);
  expect(canonicalJsonSha256(JSON.parse(pretty.replaceAll('\n', '\r\n')))).toBe(canonicalJsonSha256(pack));
  expect(canonicalJsonSha256({ b: [1, 'a'], a: null })).toBe(canonicalJsonSha256({ a: null, b: [1, 'a'] }));
  expect(canonicalJsonSha256([1, 2])).not.toBe(canonicalJsonSha256([2, 1]));
  expect(() => canonicalJsonSha256(undefined)).toThrow();
});

it('rejects malformed, duplicate, incomplete, unrelated or unbound packs and stale sources', () => {
  const first = pack.translations[0];
  const source = pack.sources[0];
  if (!first || !source) throw new Error('Missing real pack rows.');
  for (const invalid of [
    null, { ...pack, version: 2 }, { ...pack, unknown: true },
    { ...pack, translations: pack.translations.slice(1) },
    { ...pack, translations: [...pack.translations.slice(0, -1), first] },
    { ...pack, translations: [{ ...first, textRussian: '' }, ...pack.translations.slice(1)] },
    { ...pack, translations: [{ ...first, textRussian: 'English only' }, ...pack.translations.slice(1)] },
    { ...pack, translations: [{ ...first, textRussian: 'Вопрос\n' }, ...pack.translations.slice(1)] },
    { ...pack, translations: [{ ...first, textRussian: 'Вопрос\ud800' }, ...pack.translations.slice(1)] },
    { ...pack, translations: [{ ...first, textRussian: 'Я'.repeat(4001) }, ...pack.translations.slice(1)] },
    { ...pack, translations: [{ ...first, externalId: 'unknown' }, ...pack.translations.slice(1)] },
    { ...pack, translations: [{ ...first, extra: true }, ...pack.translations.slice(1)] },
    { ...pack, sources: [source, source] },
    { ...pack, sources: [{ ...source, sha256: 'a'.repeat(64) }, ...pack.sources.slice(1)] },
    { ...pack, sources: [{ ...source, reviewedAt: '2026-10-15T00:00:00.000Z' }, ...pack.sources.slice(1)] },
    { ...pack, sources: [{ ...source, reviewedAt: '2026-10-22T00:00:00.000Z' }, ...pack.sources.slice(1)] },
    { ...pack, createdAt: '2026-10-22T00:00:00.000Z' },
  ]) expect(() => parseRussianStemPack(invalid, batches, clock)).toThrow();
  expect(() => parseRussianStemPack(pack, batches.slice(1), clock)).toThrow();
  const firstBatch = batches[0];
  if (!firstBatch) throw new Error('Missing batch.');
  expect(() => parseRussianStemPack(pack, [firstBatch, firstBatch], clock)).toThrow();
});

it('requires the exact canonical pack, strict PASS review, bounded identity and canonical past timestamp', () => {
  for (const invalid of [
    { ...review, version: 2 }, { ...review, verdict: 'FAIL' }, { ...review, extra: true },
    { ...review, reviewer: '' }, { ...review, reviewer: ' reviewer' }, { ...review, reviewer: 'x'.repeat(201) },
    { ...review, reviewer: 'Reviewer\nprivate' }, { ...review, packSha256: 'a'.repeat(64) },
    ...['2026-10-21T01:00:00Z', '2026-10-21T01:00:00.000+00:00', '2026-02-30T00:00:00.000Z',
      '2026-10-20T00:00:00.000Z', '2026-10-21T03:00:00.000Z'].map((reviewedAt) => ({ ...review, reviewedAt })),
  ]) expect(() => parseRussianStemReview(invalid, pack, clock)).toThrow();
  expect(() => parseRussianStemReview(review, { ...pack, translations: [...pack.translations].reverse() }, clock)).toThrow();
});

function dependencies(args: string[]) {
  return {
    args, clock,
    readDatabaseUrl: vi.fn(() => 'secret-url'),
    validateDatabaseUrl: vi.fn(),
    createDatabaseClient: vi.fn(() => ({ $disconnect: vi.fn(async () => {}) })),
    overlay: vi.fn(async (...args: [unknown, unknown, boolean]) => ({ wouldApply: args[2] ? 0 : 100, applied: args[2] ? 100 : 0, matched: 0 })),
    writeStdout: vi.fn(), writeStderr: vi.fn(),
  };
}
function paths() {
  const packPath = join(directory, 'pack.json');
  const reviewPath = join(directory, 'review.json');
  writeFileSync(packPath, JSON.stringify(pack));
  writeFileSync(reviewPath, JSON.stringify(review));
  return [packPath, reviewPath, ...sourcePaths];
}

it('validates all four local files before even reading database configuration', async () => {
  for (const args of [[], ['--apply'], ['--unknown', ...paths()], [...paths(), 'extra']]) {
    const dep = dependencies(args);
    expect(await runRussianStemsCli(dep)).toBe(1);
    expect(dep.readDatabaseUrl).not.toHaveBeenCalled();
  }
  for (let index = 0; index < 4; index += 1) {
    for (const contents of [Buffer.from('{broken'), Buffer.from([0xc3, 0x28]), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
      const invalidPath = join(directory, 'invalid.json');
      writeFileSync(invalidPath, contents);
      const args = paths();
      args[index] = invalidPath;
      const dep = dependencies(args);
      expect(await runRussianStemsCli(dep)).toBe(1);
      expect(dep.readDatabaseUrl).not.toHaveBeenCalled();
      expect(dep.createDatabaseClient).not.toHaveBeenCalled();
      expect(dep.writeStderr).toHaveBeenCalledWith(`${russianStemsFailureMessage}\n`);
    }
  }
  const args = paths();
  writeFileSync(args[1] ?? '', JSON.stringify({ ...review, packSha256: 'a'.repeat(64) }));
  const dep = dependencies(args);
  expect(await runRussianStemsCli(dep)).toBe(1);
  expect(dep.readDatabaseUrl).not.toHaveBeenCalled();
});

it('defaults to check, enables only explicit apply, hides failures and always disconnects created clients', async () => {
  for (const apply of [false, true]) {
    const dep = dependencies(['--', ...(apply ? ['--apply'] : []), ...paths()]);
    expect(await runRussianStemsCli(dep)).toBe(0);
    expect(dep.overlay.mock.calls[0]?.[2]).toBe(apply);
    expect(dep.createDatabaseClient.mock.results[0]?.value.$disconnect).toHaveBeenCalledOnce();
    expect(dep.writeStdout).toHaveBeenCalledWith(apply ? 'Russian stems: 0 would apply, 100 applied, 0 matched.\n' : 'Russian stems: 100 would apply, 0 applied, 0 matched.\n');
  }
  const invalidConfig = dependencies(paths());
  invalidConfig.validateDatabaseUrl.mockImplementation(() => { throw new Error('private credentials'); });
  expect(await runRussianStemsCli(invalidConfig)).toBe(1);
  expect(invalidConfig.createDatabaseClient).not.toHaveBeenCalled();
  const failed = dependencies(paths());
  failed.overlay.mockRejectedValue(new Error('private database exception'));
  expect(await runRussianStemsCli(failed)).toBe(1);
  expect(failed.createDatabaseClient.mock.results[0]?.value.$disconnect).toHaveBeenCalledOnce();
  expect(failed.writeStdout).not.toHaveBeenCalled();
  expect(failed.writeStderr).toHaveBeenCalledWith(`${russianStemsFailureMessage}\n`);
});

it.each(['disconnect', 'output'])('reports a neutral error after a successful apply followed by %s failure', async (phase) => {
  const dep = dependencies(['--apply', ...paths()]);
  const database = { $disconnect: vi.fn(async () => {}) };
  dep.createDatabaseClient.mockReturnValue(database);
  dep.overlay.mockResolvedValue({ wouldApply: 0, applied: 100, matched: 0 });
  if (phase === 'disconnect') database.$disconnect.mockRejectedValue(new Error('private cleanup exception'));
  else dep.writeStdout.mockImplementation(() => { throw new Error('private output exception'); });

  expect(await runRussianStemsCli(dep)).toBe(1);
  expect(dep.overlay).toHaveBeenCalledWith(database, expect.any(Object), true);
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(dep.writeStderr).toHaveBeenCalledWith('Russian stem command failed. Verify database state before retrying.\n');
  if (phase === 'disconnect') expect(dep.writeStdout).not.toHaveBeenCalled();
});
