import { describe, expect, it } from 'vitest';
import { Prisma } from '../packages/database/src/index.ts';
import { isSerializationFailure } from '../packages/database/src/transaction.ts';

const knownRequestError = (code: string) => new Prisma.PrismaClientKnownRequestError('Transaction failed', { code, clientVersion: 'test' });

/** The exact shape the pg driver adapter raises for a lost serializable transaction. */
function driverAdapterError(originalCode: string) {
  const error = new Error('TransactionWriteConflict', {
    cause: {
      originalCode,
      originalMessage: 'could not serialize access due to read/write dependencies among transactions',
      kind: 'TransactionWriteConflict',
    },
  });
  error.name = 'DriverAdapterError';
  return error;
}

describe('serialization failure classification', () => {
  it('accepts the Prisma write-conflict code', () => {
    expect(isSerializationFailure(knownRequestError('P2034'))).toBe(true);
  });

  it('accepts the driver adapter error the pg adapter actually raises', () => {
    expect(isSerializationFailure(driverAdapterError('40001'))).toBe(true);
  });

  it('accepts a detected deadlock', () => {
    expect(isSerializationFailure(driverAdapterError('40P01'))).toBe(true);
    expect(isSerializationFailure(Object.assign(new Error('deadlock detected'), { code: '40P01' }))).toBe(true);
  });

  it('accepts a driver error that reports the SQLSTATE as a plain code', () => {
    expect(isSerializationFailure(Object.assign(new Error('could not serialize'), { code: '40001' }))).toBe(true);
  });

  it('accepts a conflict nested deeper in the cause chain', () => {
    expect(isSerializationFailure(new Error('wrapper', { cause: new Error('inner', { cause: driverAdapterError('40001') }) }))).toBe(true);
  });

  it('rejects unrelated failures without following a cycle forever', () => {
    const cyclic: { name: string; cause?: unknown } = { name: 'CyclicError' };
    cyclic.cause = cyclic;
    for (const error of [
      knownRequestError('P2002'),
      knownRequestError('P2028'),
      Object.assign(new Error('unique violation'), { code: '23505' }),
      new Error('plain failure'),
      new Error('wrapper', { cause: new Error('inner') }),
      cyclic,
      null,
      undefined,
      '40001',
      40001,
      {},
    ]) expect(isSerializationFailure(error)).toBe(false);
  });

  it('rejects a conflict buried past the bounded cause depth', () => {
    let error: unknown = driverAdapterError('40001');
    for (let depth = 0; depth < 8; depth++) error = new Error(`layer ${depth}`, { cause: error });
    expect(isSerializationFailure(error)).toBe(false);
  });
});
