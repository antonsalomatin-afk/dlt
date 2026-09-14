export function apiOrigin(value = 'http://127.0.0.1:3001'): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || value.trim() !== value ||
        /[?#]/u.test(value)) throw new Error();
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error();
    return url.origin;
  } catch {
    throw new Error('API_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment; nonlocal origins require HTTPS.');
  }
}
