import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    hookTimeout: 30000,
    testTimeout: 15000,
    fileParallelism: false,
  },
});
