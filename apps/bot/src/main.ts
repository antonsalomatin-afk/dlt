import { createBot } from './bot.ts';
import { createReminderScheduler } from './reminders.ts';
import { runBot } from './lifecycle.ts';
import { createDatabaseClient } from '../../../packages/database/src/index.ts';

let database: ReturnType<typeof createDatabaseClient> | undefined;
try {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  database = createDatabaseClient(databaseUrl);
  const bot = createBot(process.env);
  const miniAppUrl = new URL(process.env.MINI_APP_URL ?? '').toString();
  const scheduler = createReminderScheduler({ database, api: bot.api, miniAppUrl });
  // Telegram errors can include sensitive request context. Emit fixed text only.
  bot.catch(() => { console.error('Bot update failed.'); });
  await runBot(bot, process, scheduler);
} catch {
  console.error('Bot startup or polling failed. Check server-side configuration and connectivity.');
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
