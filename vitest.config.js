import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    testTimeout: 10000,
    pool: 'forks',       // isolate tests to avoid IDB state leaks
    fileParallelism: false // run test files sequentially (IDB is global)
  }
});
