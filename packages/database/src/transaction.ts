import { Prisma } from './index.ts';

/**
 * PostgreSQL SQLSTATEs that mean "the transaction lost a race; run it again":
 * 40001 serialization_failure and 40P01 deadlock_detected.
 */
const retryableSqlStates = new Set(['40001', '40P01']);

/** Prisma's documented code for a transaction that failed because of a write conflict or deadlock. */
const retryablePrismaCode = 'P2034';

const maxCauseDepth = 5;

function readStringProperty(value: object, key: string): string | null {
  const property: unknown = Reflect.get(value, key);
  return typeof property === 'string' ? property : null;
}

function retryableSqlState(value: unknown, depth = 0): string | null {
  if (depth > maxCauseDepth || value === null || typeof value !== 'object') return null;
  for (const key of ['originalCode', 'code']) {
    const state = readStringProperty(value, key);
    if (state !== null && retryableSqlStates.has(state)) return state;
  }
  const cause: unknown = Reflect.get(value, 'cause');
  return cause === undefined ? null : retryableSqlState(cause, depth + 1);
}

/**
 * Whether a failed transaction should be retried from the start.
 *
 * Prisma reports a lost write conflict as P2034, but with the pg driver adapter a
 * serialization failure surfaces instead as a DriverAdapterError whose cause carries the
 * original SQLSTATE. Both forms must be treated as retryable, or a concurrency conflict
 * escapes as an unhandled server error.
 */
export function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === retryablePrismaCode) return true;
  return retryableSqlState(error) !== null;
}
