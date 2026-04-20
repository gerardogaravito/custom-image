import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only measure modules with pure logic that we actually unit-test.
      // main.ts and toast.ts are DOM wiring; covered via manual / e2e instead.
      include: ['src/curves.ts', 'src/pipeline.ts', 'src/heic.ts', 'src/crop.ts', 'src/undo.ts'],
      exclude: ['src/main.ts', 'src/toast.ts', 'src/test/**', 'src/**/*.test.ts'],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
});
