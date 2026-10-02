import { describe, expect, it } from 'vitest';
import {
  parseReportTriageManifest,
  reportTriagePathArgument,
} from '../tools/content/report-triage.ts';

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const questionId = uuid(1);
const commandClock = new Date('2026-10-03T12:00:00.000Z');

function snapshot() {
  return {
    version: 1 as const,
    question: {
      id: questionId,
      textThai: 'คำถามสังเคราะห์',
      textExamEnglish: 'Synthetic exam wording',
      textEnglish: 'Synthetic normalized wording',
      textRussian: 'Синтетический вопрос',
      choices: (['A', 'B', 'C', 'D'] as const).map((key, index) => ({
        id: uuid(10 + index),
        key,
        textThai: `ตัวเลือก ${key}`,
        textEnglish: `Choice ${key}`,
        textRussian: `Вариант ${key}`,
      })),
    },
    correctChoiceId: uuid(10),
    explanationThai: 'คำอธิบาย',
    explanationEnglish: 'Explanation',
    explanationRussian: 'Объяснение',
    trapExplanationThai: 'กับดัก',
    trapExplanationEnglish: 'Trap explanation',
    trapExplanationRussian: 'Объяснение ловушки',
  };
}

function decision(index = 0, kind: 'PRACTICE' | 'EXAM' = 'PRACTICE') {
  return {
    reportId: uuid(100 + index),
    kind,
    createdAt: '2026-10-03T10:00:00.000Z',
    details: `Exact allegation ${index} ภาษาไทย 😀\nSecond line.`,
    questionId,
    anchorId: uuid(200 + index),
    snapshot: snapshot(),
    decision: index % 2 === 0 ? 'ACTION_REQUIRED' as const : 'NO_ACTION_REQUIRED' as const,
  };
}

function manifest(decisions = [decision()]) {
  return {
    version: 1 as const,
    triagedBy: 'Trusted Local Reviewer 😀',
    triagedAt: '2026-10-03T11:00:00.000Z',
    decisions,
  };
}

describe('report triage manifest', () => {
  it('accepts exact practice/exam evidence and both routing decisions without normalization', () => {
    const input = manifest([decision(0, 'PRACTICE'), decision(1, 'EXAM')]);
    expect(parseReportTriageManifest(input, commandClock)).toEqual(input);
  });

  it('rejects unknown keys, invalid decisions, identities, timestamps and evidence', () => {
    const valid = manifest();
    const first = valid.decisions[0]!;
    const invalid: unknown[] = [
      { ...valid, extra: true },
      { ...valid, version: 2 },
      { ...valid, triagedBy: '' },
      { ...valid, triagedBy: ' padded ' },
      { ...valid, triagedBy: 'reviewer\u0000name' },
      { ...valid, triagedBy: 'reviewer\ud800name' },
      { ...valid, triagedBy: 'x'.repeat(201) },
      { ...valid, triagedAt: '2026-10-03T11:00:00Z' },
      { ...valid, triagedAt: '2026-10-03T12:00:00.001Z' },
      { ...valid, triagedAt: '2026-10-03T09:59:59.999Z' },
      { ...valid, decisions: [{ ...first, extra: true }] },
      { ...valid, decisions: [{ ...first, reportId: '00000000-0000-4000-8000-000000ABCDEF' }] },
      { ...valid, decisions: [{ ...first, kind: 'OTHER' }] },
      { ...valid, decisions: [{ ...first, createdAt: '2026-10-03T10:00:00Z' }] },
      { ...valid, decisions: [{ ...first, details: 'ab' }] },
      { ...valid, decisions: [{ ...first, details: 'bad\ud800detail' }] },
      { ...valid, decisions: [{ ...first, decision: 'PENDING' }] },
      { ...valid, decisions: [{ ...first, snapshot: { version: 999 } }] },
      { ...valid, decisions: [{ ...first, snapshot: { ...snapshot(), explanationEnglish: 'bad\udc00text' } }] },
      { ...valid, decisions: [{ ...first, snapshot: { ...snapshot(), question: { ...snapshot().question, id: uuid(999) } } }] },
    ];
    for (const input of invalid) expect(() => parseReportTriageManifest(input, commandClock)).toThrow();
  });

  it('enforces 1 through 500 entries and uniqueness by kind plus report identity', () => {
    expect(() => parseReportTriageManifest(manifest([]), commandClock)).toThrow();
    const fiveHundred = Array.from({ length: 500 }, (_, index) => decision(index));
    expect(parseReportTriageManifest(manifest(fiveHundred), commandClock).decisions).toHaveLength(500);
    expect(() => parseReportTriageManifest(manifest([...fiveHundred, decision(500)]), commandClock)).toThrow();
    expect(() => parseReportTriageManifest(manifest([decision(), decision()]), commandClock)).toThrow();
    expect(() => parseReportTriageManifest(manifest([
      decision(0, 'PRACTICE'),
      { ...decision(0, 'EXAM'), reportId: decision(0).reportId },
    ]), commandClock)).not.toThrow();
  });

  it('accepts exactly one nonblank path with an optional pnpm separator', () => {
    expect(reportTriagePathArgument(['triage.json'])).toBe('triage.json');
    expect(reportTriagePathArgument(['--', 'triage.json'])).toBe('triage.json');
    for (const args of [[], ['--'], [' '], ['a', 'b'], ['--', 'a', 'b']]) {
      expect(reportTriagePathArgument(args)).toBeUndefined();
    }
  });
});
