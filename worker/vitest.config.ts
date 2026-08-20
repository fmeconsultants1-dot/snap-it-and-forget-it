import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/tests/**/*.test.ts', 'src/tests/runtime/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/lib/**'],
      exclude: ['src/tests/**'],
    },
  },
});
