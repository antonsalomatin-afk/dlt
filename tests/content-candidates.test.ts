import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  formatCandidateDiagnostics,
  MAX_CANDIDATE_DIAGNOSTICS,
  parseCandidateBatch,
  summarizeCandidateBatch,
} from '../tools/content/candidates.ts';

function loadExample(): ReturnType<typeof parseCandidateBatch> {
  const input: unknown = JSON.parse(readFileSync(
    new URL('../content/imports/example-candidate-batch.json', import.meta.url),
    'utf8',
  ));
  return parseCandidateBatch(input);
}

function citedQuestion() {
  const original = loadExample().questions[0];
  if (!original) throw new Error('Missing example question.');
  return {
    ...original,
    externalId: 'cited-multilingual-02',
    vehicleType: 'MOTORCYCLE' as const,
    source: {
      type: 'OFFICIAL' as const,
      reference: 'public-record:synthetic-example-02',
      sourceDate: '2026-09-29',
      legalCitation: 'Synthetic citation used only to exercise metadata validation.',
    },
    textThai: 'ข้อความสังเคราะห์สำหรับทดสอบรูปแบบ',
    textExamEnglish: 'Synthetic exam-style wording for format validation.',
    textEnglish: 'Which fictional marker belongs in this format-only example?',
    textRussian: 'Какой вымышленный знак относится к этому примеру формата?',
    choices: original.choices.map((choice, index) => ({
      ...choice,
      textThai: `ตัวเลือกสังเคราะห์ ${index + 1}`,
      textEnglish: `Synthetic cited option ${index + 1}`,
      textRussian: `Синтетический вариант ${index + 1}`,
    })),
  };
}

describe('candidate content batch validation', () => {
  it('accepts an ORIGINAL example and complete cited multilingual metadata', () => {
    const original = loadExample();
    const parsed = parseCandidateBatch({
      ...original,
      questions: [...original.questions, citedQuestion()],
    });

    expect(parsed.questions).toHaveLength(2);
    expect(summarizeCandidateBatch(parsed)).toEqual({
      batchId: 'synthetic-sample-2026-01',
      version: 1,
      questions: 2,
      choices: 8,
    });
  });

  it('rejects unknown persistence/admin fields, FIXTURE provenance and bad source rules', () => {
    const original = loadExample();
    const question = original.questions[0];
    if (!question) throw new Error('Missing example question.');
    const invalid: unknown[] = [
      { ...original, active: false },
      { ...original, questions: [{ ...question, id: 'database-id' }] },
      { ...original, questions: [{ ...question, choices: question.choices.map((choice) => ({ ...choice, isCorrect: choice.key === 'A' })) }] },
      { ...original, questions: [{ ...question, source: { ...question.source, type: 'FIXTURE' } }] },
      { ...original, questions: [{ ...question, source: { ...question.source, reference: 'untracked-original' } }] },
      { ...original, questions: [{ ...citedQuestion(), source: { ...citedQuestion().source, sourceDate: null } }] },
      { ...original, questions: [{ ...citedQuestion(), source: { ...citedQuestion().source, legalCitation: null } }] },
      { ...original, questions: [{ ...citedQuestion(), source: { ...citedQuestion().source, sourceDate: '2026-02-30' } }] },
    ];

    for (const input of invalid) expect(() => parseCandidateBatch(input)).toThrow();
  });

  it('rejects noncanonical identifiers, timestamps, text and unsafe batch sizes', () => {
    const original = loadExample();
    const question = original.questions[0];
    if (!question) throw new Error('Missing example question.');
    const invalid: unknown[] = [
      { ...original, batchId: 'Upper_Case' },
      { ...original, createdAt: '2026-09-30T00:00:00Z' },
      { ...original, questions: [] },
      { ...original, questions: Array.from({ length: 501 }, (_, index) => ({ ...question, externalId: `question-${index}` })) },
      { ...original, questions: [{ ...question, externalId: `q${'x'.repeat(64)}` }] },
      { ...original, questions: [{ ...question, categorySlug: ' category' }] },
      { ...original, questions: [{ ...question, textEnglish: ' surrounding whitespace ' }] },
      { ...original, questions: [{ ...question, textEnglish: 'x'.repeat(4001) }] },
    ];

    for (const input of invalid) expect(() => parseCandidateBatch(input)).toThrow();
  });

  it('rejects duplicate identities and normalized question or choice wording', () => {
    const original = loadExample();
    const question = original.questions[0];
    if (!question) throw new Error('Missing example question.');
    const second = {
      ...question,
      externalId: 'sample-space-check-02',
      textEnglish: question.textEnglish.toLocaleUpperCase('en-US').replaceAll(' ', '   '),
    };
    const firstChoice = question.choices[0];
    if (!firstChoice) throw new Error('Missing example choice.');
    const duplicateChoice = {
      ...question,
      choices: question.choices.map((choice, index) => index === 1
        ? { ...choice, textEnglish: firstChoice.textEnglish.toLocaleUpperCase('en-US') }
        : choice),
    };

    expect(() => parseCandidateBatch({ ...original, questions: [question, { ...second, externalId: question.externalId }] })).toThrow();
    expect(() => parseCandidateBatch({ ...original, questions: [question, second] })).toThrow();
    expect(() => parseCandidateBatch({ ...original, questions: [duplicateChoice] })).toThrow();
  });

  it('rejects incomplete choice keys and an answer key outside the supplied choices', () => {
    const original = loadExample();
    const question = original.questions[0];
    if (!question) throw new Error('Missing example question.');
    const repeated = question.choices.map((choice, index) => index === 3 ? { ...choice, key: 'A' as const } : choice);

    expect(() => parseCandidateBatch({ ...original, questions: [{ ...question, choices: repeated }] })).toThrow();
    expect(() => parseCandidateBatch({
      ...original,
      questions: [{ ...question, choices: repeated, correctChoiceKey: 'D' }],
    })).toThrow();
  });

  it('produces bounded path-based diagnostics without echoing unknown source fields', () => {
    const original = loadExample();
    const question = original.questions[0];
    if (!question) throw new Error('Missing example question.');
    try {
      parseCandidateBatch({
        ...original,
        questions: Array.from({ length: 30 }, (_, index) => ({
          ...question,
          externalId: `diagnostic-${index}`,
          [`private-source-value-${index}`]: 'must-never-be-printed',
        })),
      });
      throw new Error('Expected validation failure.');
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const diagnostics = formatCandidateDiagnostics(error);
      expect(diagnostics).toHaveLength(MAX_CANDIDATE_DIAGNOSTICS);
      expect(diagnostics.every((diagnostic) => diagnostic.startsWith('$.questions['))).toBe(true);
      expect(diagnostics.join('\n')).not.toContain('private-source-value');
      expect(diagnostics.join('\n')).not.toContain('must-never-be-printed');
    }
  });
});
