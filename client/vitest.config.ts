import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: [
      '__tests__/spec/**/*.spec.ts',
      '__tests__/types/**/*.test-d.ts',
      '__tests__/e2e/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
