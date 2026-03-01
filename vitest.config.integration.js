import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    testTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
  }
});
