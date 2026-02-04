import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test-d.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
