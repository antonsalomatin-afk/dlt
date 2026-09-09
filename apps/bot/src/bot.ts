import { Bot, InlineKeyboard } from 'grammy';
import type { BotConfig, Context } from 'grammy';
import { readBotConfig } from './config.ts';

/** Construction registers handlers only; callers explicitly control polling. */
export function createBot(environment: Record<string, string | undefined>, options: BotConfig<Context> = {}) {
  const config = readBotConfig(environment);
  const bot = new Bot(config.token, options);
  bot.command('start', async (context) => {
    if (context.chat.type !== 'private') {
      await context.reply('Open a private chat with this bot and send /start to launch ThaiDLT.');
      return;
    }
    await context.reply('Open ThaiDLT to practice driving theory.', {
      reply_markup: new InlineKeyboard().webApp('Open ThaiDLT', config.miniAppUrl),
    });
  });
  return bot;
}
