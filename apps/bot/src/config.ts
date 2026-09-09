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
