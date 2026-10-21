export function readBotConfig(environment: Record<string, string | undefined>) {
  const token = environment.BOT_TOKEN;
  if (!token || !/^[1-9]\d*:[A-Za-z0-9_-]{20,150}$/.test(token)) {
    throw new Error('BOT_TOKEN must be configured with a valid bot-token format.');
  }
  let url: URL;
  try { url = new URL(environment.MINI_APP_URL ?? ''); } catch {
    throw new Error('MINI_APP_URL must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('MINI_APP_URL must be a valid HTTPS URL without credentials.');
  }
  return { token, miniAppUrl: url.toString() };
}

export type QuestionPostConfig = { enabled: false } | { enabled: true; botUsername: string; shortName?: string };

export function readQuestionPostConfig(environment: Record<string, string | undefined>): QuestionPostConfig {
  const enabled = environment.DAILY_QUESTION_POSTS_ENABLED;
  if (enabled === undefined || enabled === 'false') return { enabled: false };
  if (enabled !== 'true') throw new Error('DAILY_QUESTION_POSTS_ENABLED must be true or false.');
  const botUsername = environment.TELEGRAM_MINI_APP_BOT_USERNAME;
  const shortName = environment.TELEGRAM_MINI_APP_SHORT_NAME;
  if (!botUsername || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(botUsername) || !/bot$/iu.test(botUsername)) {
    throw new Error('TELEGRAM_MINI_APP_BOT_USERNAME must be a public bot username.');
  }
  if (shortName !== undefined && !/^[A-Za-z0-9_]{3,64}$/u.test(shortName)) {
    throw new Error('TELEGRAM_MINI_APP_SHORT_NAME must be a valid Mini App short name.');
  }
  return { enabled: true, botUsername, ...(shortName === undefined ? {} : { shortName }) };
}
