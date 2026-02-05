import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true, // Each file gets its own process with unique graph
      },
    },
  },
})
