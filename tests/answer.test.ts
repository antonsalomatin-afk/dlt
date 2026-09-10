import { expect, it } from 'vitest';
import { Prisma } from '../packages/database/src/index.ts';
import { isDuplicateAnswer } from '../packages/database/src/answer.ts';

it('classifies only the answer presentation unique constraint', () => {
  const error = (code: string, meta: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError('synthetic', { code, clientVersion: 'test', meta });
  const cause = { originalCode: '23505', kind: 'UniqueConstraintViolation', table: 'AnswerAttempt', constraint: { index: 'AnswerAttempt_presentationId_key' } };
  const metadata = { modelName: 'AnswerAttempt', driverAdapterError: { cause } };
  expect(isDuplicateAnswer(error('P2002', metadata))).toBe(true);
  for (const patch of [{ table: 'Other' }, { constraint: { index: 'AnswerAttempt_pkey' } }, { originalCode: '23503' }]) expect(isDuplicateAnswer(error('P2002', { ...metadata, driverAdapterError: { cause: { ...cause, ...patch } } }))).toBe(false);
  for (const value of [new Error('failure'), error('P2003', { modelName: 'AnswerAttempt', target: ['presentationId'] }), error('P2002', { modelName: 'AnswerAttempt', target: ['id'] }), error('P2002', { modelName: 'QuestionPresentation', target: ['presentationId'] }), error('P2002', {})]) expect(isDuplicateAnswer(value)).toBe(false);
});

