import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/frameworks/**/*.test.{js,jsx}'],
    setupFiles: ['./tests/setup.js'],
    testTimeout: 15000,
    pool: 'forks',
    fileParallelism: false,
  }
});
