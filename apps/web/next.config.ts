import type { NextConfig } from 'next';
import { apiOrigin } from './lib/api-origin';

const origin = apiOrigin(process.env.API_ORIGIN);
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return ['/auth/telegram', '/me', '/me/vehicle'].map((path) => ({ source: path, destination: `${origin}${path}` }));
  },
};
export default config;
