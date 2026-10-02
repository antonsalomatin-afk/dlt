import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { examQuestionReportRequestSchema, examQuestionReportResponseSchema } from '../apps/web/lib/contracts.ts';

const examQuestionId = '550e8400-e29b-41d4-a716-446655440010';
const details = 'The exam wording may be ambiguous 😀\nPlease review it.';

it('accepts the exact browser exam-report contracts', () => {
  expect(examQuestionReportRequestSchema.parse({ examQuestionId, details })).toEqual({ examQuestionId, details });
  const response = { reportId: '550e8400-e29b-41d4-a716-446655440099', examQuestionId, createdAt: '2026-10-02T12:00:00.000Z' };
  expect(examQuestionReportResponseSchema.parse(response)).toEqual(response);
});

it('rejects noncanonical, lossy, out-of-bounds and non-strict exam reports', () => {
  for (const invalidDetails of [
    'ab', ` ${details}`, `${details} `, 'a'.repeat(1001), '😀'.repeat(1001), 'bad\tcontrol', 'bad\r\ncontrol',
    `bad${String.fromCharCode(0xd800)}value`, `bad${String.fromCharCode(0xdc00)}value`,
  ]) expect(examQuestionReportRequestSchema.safeParse({ examQuestionId, details: invalidDetails }).success).toBe(false);
  expect(examQuestionReportRequestSchema.safeParse({ examQuestionId: examQuestionId.toUpperCase(), details }).success).toBe(false);
  expect(examQuestionReportRequestSchema.safeParse({ examQuestionId, details, extra: true }).success).toBe(false);
  const response = { reportId: '550e8400-e29b-41d4-a716-446655440099', examQuestionId, createdAt: '2026-10-02T12:00:00.000Z' };
  for (const invalid of [
    { ...response, reportId: response.reportId.toUpperCase() }, { ...response, examQuestionId: examQuestionId.toUpperCase() },
    { ...response, createdAt: '2026-10-02T14:00:00+02:00' }, { ...response, extra: true },
  ]) expect(examQuestionReportResponseSchema.safeParse(invalid).success).toBe(false);
});

it('keeps the exam report API behind one explicit Next rewrite', async () => {
  const source = await readFile(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
  expect(source.match(/'\/exam\/report'/gu)).toHaveLength(1);
});
