import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/edge/test/**/*.test.ts'],
    environment: 'node',
  },
});
