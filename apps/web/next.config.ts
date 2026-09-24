import type { NextConfig } from 'next';
import { apiOrigin } from './lib/api-origin';

const origin = apiOrigin(process.env.API_ORIGIN);
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return ['/auth/telegram', '/me', '/me/vehicle', '/me/history', '/me/mistakes', '/me/favorites', '/me/progress', '/practice/categories', '/practice/next', '/practice/answer', '/practice/favorite', '/exam/current', '/exam/start', '/exam/answer', '/exam/complete', '/exam/history', '/exam/:examId/review'].map((path) => ({ source: path, destination: `${origin}${path}` }));
  },
};
export default config;

