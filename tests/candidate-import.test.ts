import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidateChoiceId,
  candidateQuestionId,
  mapCandidateQuestion,
} from '../tools/content/candidate-import.ts';
import { parseCandidateBatch } from '../tools/content/candidates.ts';

function exampleBatch() {
  const input: unknown = JSON.parse(readFileSync(
    new URL('../content/imports/example-candidate-batch.json', import.meta.url),
    'utf8',
  ));
  return parseCandidateBatch(input);
}

describe('candidate persistence mapping', () => {
  it('derives stable UUID-shaped IDs in a candidate-only namespace', () => {
    const questionId = candidateQuestionId(1, 'synthetic-sample-2026-01', 'sample-space-check-01');
    expect(questionId).toBe('89b252c9-6c9d-51ea-83bf-cc7673f785ad');
    expect(questionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(candidateChoiceId(questionId, 'A')).toBe('034f42fd-6395-5ae8-83b4-b2e42562ca64');
    expect(candidateQuestionId(1, 'synthetic-sample-2026-02', 'sample-space-check-01')).not.toBe(questionId);
    expect(candidateQuestionId(1, 'synthetic-sample-2026-01', 'sample-space-check-02')).not.toBe(questionId);
  });

  it('maps every candidate field exactly to an inactive unreviewed DRAFT and four deterministic choices', () => {
    const batch = exampleBatch();
    const question = batch.questions[0];
    if (!question) throw new Error('Missing example question.');
    const mapped = mapCandidateQuestion(
      batch,
      {
        ...question,
        textThai: 'ข้อความสังเคราะห์',
        textExamEnglish: 'Synthetic exam wording.',
        textRussian: 'Синтетический вопрос.',
        explanationThai: 'คำอธิบายสังเคราะห์',
        explanationRussian: 'Синтетическое объяснение.',
        source: {
          type: 'OFFICIAL',
          reference: 'public-record:synthetic-only',
          sourceDate: '2026-09-30',
          legalCitation: 'Synthetic citation for mapping coverage.',
        },
      },
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );

    expect(mapped.question).toMatchObject({
      vehicleType: 'CAR',
      categoryId: '11111111-1111-4111-8111-111111111111',
      conceptId: '22222222-2222-4222-8222-222222222222',
      textThai: 'ข้อความสังเคราะห์',
      textExamEnglish: 'Synthetic exam wording.',
      textEnglish: question.textEnglish,
      textRussian: 'Синтетический вопрос.',
      explanationThai: 'คำอธิบายสังเคราะห์',
      explanationEnglish: question.explanationEnglish,
      explanationRussian: 'Синтетическое объяснение.',
      trapExplanationEnglish: question.trapExplanationEnglish,
      sourceType: 'OFFICIAL',
      sourceReference: 'public-record:synthetic-only',
      legalCitation: 'Synthetic citation for mapping coverage.',
      active: false,
      verificationStatus: 'DRAFT',
      reviewer: null,
      reviewedAt: null,
      imageReference: null,
    });
    expect(mapped.question.sourceDate?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(mapped.choices).toHaveLength(4);
    expect(mapped.choices.map(({ key }) => key)).toEqual(['A', 'B', 'C', 'D']);
    expect(mapped.choices.filter(({ isCorrect }) => isCorrect).map(({ key }) => key)).toEqual(['A']);
    expect(new Set(mapped.choices.map(({ id }) => id)).size).toBe(4);
    expect(mapped.choices.every(({ questionId }) => questionId === mapped.question.id)).toBe(true);
  });
});
