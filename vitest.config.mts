import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // See vitest.server-only-stub.ts for why this is aliased rather than
    // resolved under Next's own module condition.
    alias: { 'server-only': new URL('./vitest.server-only-stub.ts', import.meta.url).pathname },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts?(x)', 'app/**/*.test.ts?(x)', 'components/**/*.test.ts?(x)'],
    passWithNoTests: true,
  },
});
