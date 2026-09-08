import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client.ts';

export { PrismaClient, Prisma } from '../generated/client.ts';
export { VehicleType, ChoiceKey, VerificationStatus, SourceType } from '../generated/enums.ts';

/** The caller owns this client's lifetime and must call $disconnect on shutdown. */
export function createDatabaseClient(connectionString: string) {
  let url: URL;
  try { url = new URL(connectionString); } catch {
    throw new Error('A valid PostgreSQL connection URL is required.');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('A valid PostgreSQL connection URL is required.');
  }
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 });
  return new PrismaClient({ adapter });
}
