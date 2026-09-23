import { describe, expect, it } from 'vitest';
import { assertQuestionProvenance, questionProvenanceSchema } from '../packages/database/src/provenance.ts';

const verified = { verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL', legalCitation: 'Land Traffic Act section 21' } as const;

describe('question provenance', () => {
  it('accepts original verified content that cites the law', () => {
    expect(questionProvenanceSchema.parse(verified)).toEqual(verified);
    expect(assertQuestionProvenance(verified)).toEqual(verified);
  });

  it('leaves drafts and rejected questions free of provenance requirements', () => {
    for (const status of ['DRAFT', 'REJECTED'] as const) {
      for (const sourceType of ['FIXTURE', 'ORIGINAL', 'OFFICIAL', 'THIRD_PARTY'] as const) {
        expect(questionProvenanceSchema.safeParse({ verificationStatus: status, sourceType, legalCitation: null }).success).toBe(true);
      }
    }
  });

  it('refuses to verify content that is not original', () => {
    for (const sourceType of ['FIXTURE', 'OFFICIAL', 'THIRD_PARTY'] as const) {
      const result = questionProvenanceSchema.safeParse({ ...verified, sourceType });
      expect(result.success).toBe(false);
      expect(() => assertQuestionProvenance({ ...verified, sourceType })).toThrow('Only original in-house content may be verified');
    }
  });

  it('refuses to verify content with no usable citation', () => {
    for (const legalCitation of [null, '', '   ', '\t\n']) {
      expect(questionProvenanceSchema.safeParse({ ...verified, legalCitation }).success).toBe(false);
      expect(() => assertQuestionProvenance({ ...verified, legalCitation })).toThrow('must cite the public law');
    }
  });

  it('reports every provenance problem at once and rejects unknown shapes', () => {
    expect(() => assertQuestionProvenance({ verificationStatus: 'VERIFIED', sourceType: 'THIRD_PARTY', legalCitation: ' ' }))
      .toThrow(/Only original in-house content may be verified.*must cite the public law/su);
    for (const invalid of [
      null,
      {},
      { ...verified, unknown: true },
      { ...verified, verificationStatus: 'PUBLISHED' },
      { ...verified, sourceType: 'SCRAPED' },
      { ...verified, legalCitation: 42 },
    ]) expect(questionProvenanceSchema.safeParse(invalid).success).toBe(false);
  });
});
