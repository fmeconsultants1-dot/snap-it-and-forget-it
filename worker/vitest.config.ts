import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Runtime tests use real SQLite (native module) -- needs separate pool
    // Unit tests run in main thread
    poolOptions: {
      threads: {
        singleThread: true, // SQLite requires single-threaded access
      },
    },
    include: ['src/tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    reporters: ['verbose'],
    // Allow better-sqlite3 native module
    server: {
      deps: {
        inline: ['better-sqlite3'],
      },
    },
  },
});
