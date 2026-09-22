import type { NextConfig } from 'next';
import { apiOrigin } from './lib/api-origin';

const origin = apiOrigin(process.env.API_ORIGIN);
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return ['/auth/telegram', '/me', '/me/vehicle', '/me/history', '/me/mistakes', '/me/favorites', '/me/progress', '/me/progress/concepts', '/practice/categories', '/practice/next', '/practice/answer', '/practice/favorite', '/exam/start', '/exam/answer', '/exam/complete', '/exam/history', '/exam/:examId/result'].map((path) => ({ source: path, destination: `${origin}${path}` }));
  },
};
export default config;

