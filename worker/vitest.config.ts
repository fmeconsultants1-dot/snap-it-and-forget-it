import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    include: ['src/tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    reporters: ['verbose'],
    // Allow better-sqlite3 native module in forks pool
    server: {
      deps: {
        inline: ['better-sqlite3'],
      },
    },
  },
});
