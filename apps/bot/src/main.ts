import { createBot } from './bot.ts';
import { runBot } from './lifecycle.ts';

try {
  const bot = createBot(process.env);
  // Telegram errors can include sensitive request context. Emit fixed text only.
  bot.catch(() => { console.error('Bot update failed.'); });
  await runBot(bot);
} catch {
  console.error('Bot startup or polling failed. Check server-side configuration and connectivity.');
  process.exitCode = 1;
}
