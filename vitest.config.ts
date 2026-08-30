import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts?(x)', 'app/**/*.test.ts?(x)'],
    passWithNoTests: true,
  },
});
