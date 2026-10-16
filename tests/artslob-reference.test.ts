import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ARTSLOB_REVISION, assembleReferenceInventory, MAX_REFERENCE_PAGE_BYTES, parseReferencePage, REFERENCE_FAILURE } from '../tools/content/artslob-reference.ts';

const cli = fileURLToPath(new URL('../tools/content/prepare-artslob-reference.ts', import.meta.url));
const directories: string[] = [];
function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'thaidlt-reference-'));
  directories.push(path);
  return path;
}
function page(question = 'Synthetic practice question?', image = '') {
  return `<html><script>// 7 original source page
var options = [
'<p >Synthetic choice A</p>',
'<p class="answer">Synthetic choice B</p>',
'<p >Synthetic choice C</p>',
'<p >Synthetic choice D</p>',
];
throw new Error('MUST NEVER EXECUTE');</script><body><h3>${question}</h3>${image}</body></html>`;
}
function parse(html = page(), id = 1) { return parseReferencePage(id, Buffer.from(html)); }
function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 10_000 });
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('offline reference parser', () => {
  it('extracts inert wording, source references and upstream markers without claiming verification', () => {
    const record = parse();
    expect(record).toMatchObject({ sourceId: 1, originalSourcePages: [7], questionEnglish: 'Synthetic practice question?', upstreamAnswerKeys: ['B'], malformed: false, imageDependent: false, vehicleApplicability: 'UNREVIEWED' });
    expect(record.sourceReference).toBe(`https://github.com/artslob/thailand-driving-exam-questions/blob/${ARTSLOB_REVISION}/output/1/index.html`);
    expect(record.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.choices.map((choice) => choice.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(parse().sourceSha256).toBe(record.sourceSha256);
  });
  it('handles supported HTML entities and JS apostrophes only as text', () => {
    const html = page('Synthetic &quot;A&quot; &amp; B &#63;').replace('Synthetic choice A', "Driver\\'s choice");
    const record = parse(html);
    expect(record.questionEnglish).toBe('Synthetic "A" & B ?');
    expect(record.choices[0]?.textEnglish).toBe("Driver's choice");
    expect(record.malformed).toBe(false);
  });
  it('records image dependencies but never fetches or embeds image bytes', () => {
    const record = parse(page('Synthetic image question?', '<img src="../images/synthetic-1.jpg.webp" />'));
    expect(record.imageDependent).toBe(true);
    expect(record.imageReferences).toEqual(['../images/synthetic-1.jpg.webp']);
    expect(record.malformed).toBe(false);
    expect(assembleReferenceInventory([record]).summary.textReviewCandidates).toBe(0);
  });
  it.each([
    [page().replace('class="answer"', ''), 'invalid-upstream-answer-count'],
    [page().replace('<p >Synthetic choice A', '<p class="answer">Synthetic choice A'), 'invalid-upstream-answer-count'],
    [page().replace('Synthetic choice A', 'Synthetic choice B'), 'duplicate-choice-text'],
    [page().replace('Synthetic choice A', 'bad\\x41'), 'unsupported-js-escape'],
    [page().replace('Synthetic choice A', '<script>bad()</script>'), 'unsupported-markup'],
    [page('Unsafe &mystery;'), 'unsupported-entity'],
    [page('Unsafe &#0;'), 'unsafe-text'],
    [page('Unsafe \u202econtrol'), 'unsafe-text'],
    [page('x'.repeat(4001)), 'invalid-text'],
    [page().replace('var options = [', 'var options = [runUntrustedCode(),'), 'invalid-option-literal'],
    [page().replace('<h3>', '<h3>second</h3><h3>'), 'invalid-question'],
    [page().replace('// 7 original source page', ''), 'invalid-source-page-marker'],
    [page('Image?', '<img src="https://example.invalid/tracker.png" />'), 'unsupported-image'],
    [page('Image?', '<img src="../images/../../private.jpg" />'), 'unsupported-image'],
  ])('classifies unsupported source safely (%s)', (html, issue) => {
    expect(parse(html)).toMatchObject({ malformed: true, issues: [issue], contentSha256: null });
  });
  it('fails closed on invalid UTF-8 and excessive input', () => {
    expect(parseReferencePage(1, Buffer.from([0xff]))).toMatchObject({ malformed: true, issues: ['invalid-encoding-or-format'] });
    expect(() => parseReferencePage(1, Buffer.alloc(MAX_REFERENCE_PAGE_BYTES + 1))).toThrow();
  });
  it('accounts for every record and detects duplicates despite choice order or case', () => {
    const first = parse();
    const reordered = page(' SYNTHETIC practice question? ').replace('Synthetic choice A', 'TEMP').replace('Synthetic choice C', 'Synthetic choice A').replace('TEMP', 'Synthetic choice C');
    const second = parse(reordered, 2);
    const image = parse(page('Different image?', '<img src="../images/synthetic.jpg" />'), 3);
    const bad = parse(page().replace('class="answer"', ''), 4);
    const inventory = assembleReferenceInventory([bad, second, first, image]);
    expect(inventory.records.map((record) => record.sourceId)).toEqual([1, 2, 3, 4]);
    expect(inventory.records[1]?.duplicateOf).toBe(1);
    expect(inventory.summary).toEqual({ total: 4, malformed: 1, imageDependent: 1, duplicates: 1, structurallyValidText: 2, textReviewCandidates: 1 });
    expect(first.duplicateOf).toBeNull();
    expect(() => assembleReferenceInventory([first, first])).toThrow();
  });
  it('does not collapse contradictory upstream answer associations into an exact duplicate', () => {
    const first = parse();
    const conflicting = parse(page().replace('class="answer"', '').replace('<p >Synthetic choice A', '<p class="answer">Synthetic choice A'), 2);
    expect(conflicting.contentSha256).not.toBe(first.contentSha256);
    expect(assembleReferenceInventory([first, conflicting]).summary.duplicates).toBe(0);
  });
});

describe('reference CLI negative boundaries', () => {
  it('rejects missing/extra/unsafe arguments without disclosing source text or local secrets', () => {
    const cwd = temporaryDirectory();
    writeFileSync(join(cwd, '.env'), 'BOT_TOKEN=PRIVATE_SENTINEL\nDATABASE_URL=invalid');
    const args = [[], ['--'], ['secret-path'], ['source', '../outside'], ['source', '.local-content/../escape'], ['source', '.local-content/good', 'extra']];
    for (const item of args) {
      const result = runCli(cwd, item);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(REFERENCE_FAILURE);
    }
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toContain('PRIVATE_SENTINEL');
  }, 20_000);
  it('rejects nonrepository source and preserves any existing destination', () => {
    const cwd = temporaryDirectory();
    const source = join(cwd, 'source');
    const destination = join(cwd, '.local-content', 'existing');
    mkdirSync(source);
    mkdirSync(destination, { recursive: true });
    const path = join(destination, 'inventory.json');
    writeFileSync(path, 'EXISTING_INVENTORY');
    const result = runCli(cwd, [source, '.local-content/existing']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(REFERENCE_FAILURE);
    expect(readFileSync(path, 'utf8')).toBe('EXISTING_INVENTORY');
  });
  it('rejects an unpinned Git checkout without emitting git diagnostics', () => {
    const cwd = temporaryDirectory();
    const source = join(cwd, 'source');
    mkdirSync(source);
    expect(spawnSync('git', ['init', source], { encoding: 'utf8' }).status).toBe(0);
    writeFileSync(join(source, '.git', 'HEAD'), `${'a'.repeat(40)}\n`);
    const result = runCli(cwd, [source, '.local-content/new']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(REFERENCE_FAILURE);
  });
  it('rejects a linked source directory before traversing it', () => {
    const cwd = temporaryDirectory();
    const source = join(cwd, 'source');
    const linked = join(cwd, 'linked');
    mkdirSync(source);
    symlinkSync(source, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const result = runCli(cwd, [linked, '.local-content/new']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(REFERENCE_FAILURE);
  });
});
