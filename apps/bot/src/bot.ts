import { Bot, InlineKeyboard } from 'grammy';
import type { BotConfig, Context } from 'grammy';
import { readBotConfig } from './config.ts';

export const DAILY_START_PARAMETER = 'daily';

function isDailyStartParameter(value: unknown): value is typeof DAILY_START_PARAMETER {
  return value === DAILY_START_PARAMETER;
}

function dailyStartAppUrl(username: string): string | null {
  if (!/^[A-Za-z0-9_]{5,32}$/u.test(username)) return null;
  return `https://t.me/${username}?startapp=${DAILY_START_PARAMETER}`;
}

/** Construction registers handlers only; callers explicitly control polling. */
export function createBot(environment: Record<string, string | undefined>, options: BotConfig<Context> = {}) {
  const config = readBotConfig(environment);
  const bot = new Bot(config.token, options);
  bot.command('start', async (context) => {
    if (context.chat.type !== 'private') {
      await context.reply('Open a private chat with this bot and send /start to launch ThaiDLT.');
      return;
    }
    const keyboard = new InlineKeyboard().webApp('Open ThaiDLT', config.miniAppUrl);
    if (isDailyStartParameter(context.match)) {
      const link = dailyStartAppUrl(context.me.username);
      if (link) keyboard.url('Open daily question', link);
    }
    await context.reply('Open ThaiDLT to practice driving theory. Send /quiz or /practice to answer questions here in this private chat.', { reply_markup: keyboard });
  });
  return bot;
}
