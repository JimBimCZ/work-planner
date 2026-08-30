import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts?(x)', 'app/**/*.test.ts?(x)', 'components/**/*.test.ts?(x)'],
    passWithNoTests: true,
  },
});
