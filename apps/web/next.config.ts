import type { NextConfig } from 'next';
import { apiOrigin } from './lib/api-origin';

const origin = apiOrigin(process.env.API_ORIGIN);
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return ['/auth/telegram', '/me', '/me/vehicle', '/me/history', '/me/mistakes', '/me/favorites', '/me/progress', '/me/concept-progress', '/me/reminders', '/me/language', '/practice/categories', '/practice/next', '/practice/daily', '/practice/retry-mistake', '/practice/answer', '/practice/favorite', '/practice/report', '/exam/current', '/exam/start', '/exam/answer', '/exam/complete', '/exam/report', '/exam/history', '/exam/:examId/review'].map((path) => ({ source: path, destination: `${origin}${path}` }));
  },
};
export default config;

