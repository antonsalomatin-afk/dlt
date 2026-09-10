import { z } from 'zod';
import { createDatabaseClient } from '../../../packages/database/src/index.ts';
import { createApi } from './index.ts';

const config = z.object({ DATABASE_URL: z.url(), BOT_TOKEN: z.string().trim().min(1), API_PORT: z.coerce.number().int().min(1).max(65535).default(3001) }).safeParse(process.env);
if (!config.success) {
  console.error('Invalid API configuration. Set DATABASE_URL, BOT_TOKEN and optional API_PORT.');
  process.exitCode = 1;
} else {
  const database = createDatabaseClient(config.data.DATABASE_URL);
  const app = createApi({ database, botToken: config.data.BOT_TOKEN });
  app.addHook('onClose', async () => { await database.$disconnect(); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
  try { await app.listen({ host: '127.0.0.1', port: config.data.API_PORT }); }
  catch { console.error('API startup failed.'); await app.close(); process.exitCode = 1; }
}
