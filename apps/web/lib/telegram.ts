export const DAILY_START_PARAMETER = 'daily';
export type TelegramStartParameter = typeof DAILY_START_PARAMETER | `question_${string}` | 'invalid-question';

export function readTelegramStartParameter(initData: string): TelegramStartParameter | null {
  if (initData.length > 16 * 1024) return null;
  let params: URLSearchParams;
  try { params = new URLSearchParams(initData); }
  catch { return null; }
  const values = params.getAll('start_param');
  if (values.length !== 1) return values.some((value) => value.startsWith('question_')) ? 'invalid-question' : null;
  const value = values[0];
  if (value === DAILY_START_PARAMETER) return DAILY_START_PARAMETER;
  if (value?.startsWith('question_')) {
    return /^question_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
      ? `question_${value.slice(9)}` : 'invalid-question';
  }
  return null;
}

type Bridge = { initData: string; startParameter: TelegramStartParameter | null; ready: () => void };

function bridge(): Bridge | null {
  if (!('Telegram' in window)) return null;
  const telegram = window.Telegram;
  if (typeof telegram !== 'object' || telegram === null || !('WebApp' in telegram)) return null;
  const app = telegram.WebApp;
  if (typeof app !== 'object' || app === null || !('initData' in app) || typeof app.initData !== 'string' ||
      !('ready' in app) || typeof app.ready !== 'function') return null;
  const ready = app.ready;
  return { initData: app.initData, startParameter: readTelegramStartParameter(app.initData), ready: () => ready.call(app) };
}

let loading: Promise<Bridge> | undefined;
export function loadTelegram(): Promise<Bridge> {
  const current = bridge();
  if (current) return Promise.resolve(current);
  if (loading) return loading;
  loading = new Promise<Bridge>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    const timeout = window.setTimeout(fail, 10000);
    function fail() {
      window.clearTimeout(timeout);
      script.remove();
      loading = undefined;
      reject(new Error('Telegram bridge unavailable'));
    }
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      const loaded = bridge();
      if (loaded) resolve(loaded);
      else fail();
    };
    document.head.append(script);
  });
  return loading;
}
