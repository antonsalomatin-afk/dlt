type Bridge = { initData: string; ready: () => void };

function bridge(): Bridge | null {
  if (!('Telegram' in window)) return null;
  const telegram = window.Telegram;
  if (typeof telegram !== 'object' || telegram === null || !('WebApp' in telegram)) return null;
  const app = telegram.WebApp;
  if (typeof app !== 'object' || app === null || !('initData' in app) || typeof app.initData !== 'string' ||
      !('ready' in app) || typeof app.ready !== 'function') return null;
  const ready = app.ready;
  return { initData: app.initData, ready: () => ready.call(app) };
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
