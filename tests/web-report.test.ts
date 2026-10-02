import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { practiceReportRequestSchema, practiceReportResponseSchema } from '../apps/web/lib/contracts.ts';

const presentationId = '550e8400-e29b-41d4-a716-446655440010';
const validDetails = 'The sign conflicts with the explanation 😀\nPlease review it.';

it('accepts the exact browser report contract and valid supplementary characters', () => {
  expect(practiceReportRequestSchema.parse({ presentationId, details: validDetails })).toEqual({ presentationId, details: validDetails });
  expect(practiceReportResponseSchema.parse({
    reportId: '550e8400-e29b-41d4-a716-446655440099', presentationId, createdAt: '2026-10-02T04:00:00.000Z',
  })).toEqual({ reportId: '550e8400-e29b-41d4-a716-446655440099', presentationId, createdAt: '2026-10-02T04:00:00.000Z' });
});

it('rejects noncanonical, lossy or out-of-bounds report requests', () => {
  for (const details of [
    'ab', ` ${validDetails}`, `${validDetails} `, 'a'.repeat(1001), '😀'.repeat(1001),
    'bad\tcontrol', 'bad\r\ncontrol', `bad${String.fromCharCode(0xd800)}value`, `bad${String.fromCharCode(0xdc00)}value`,
  ]) expect(practiceReportRequestSchema.safeParse({ presentationId, details }).success).toBe(false);
  expect(practiceReportRequestSchema.safeParse({ presentationId: presentationId.toUpperCase(), details: validDetails }).success).toBe(false);
  expect(practiceReportRequestSchema.safeParse({ presentationId, details: validDetails, extra: true }).success).toBe(false);
});

it('strictly validates report responses', () => {
  const valid = { reportId: '550e8400-e29b-41d4-a716-446655440099', presentationId, createdAt: '2026-10-02T04:00:00.000Z' };
  for (const response of [
    { ...valid, extra: true }, { ...valid, reportId: valid.reportId.toUpperCase() },
    { ...valid, presentationId: presentationId.toUpperCase() }, { ...valid, createdAt: '2026-10-02T06:00:00+02:00' },
  ]) expect(practiceReportResponseSchema.safeParse(response).success).toBe(false);
});

it('keeps the report API behind one explicit Next rewrite', async () => {
  const source = await readFile(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
  expect(source.match(/'\/practice\/report'/gu)).toHaveLength(1);
});
