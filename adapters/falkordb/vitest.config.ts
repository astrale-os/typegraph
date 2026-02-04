import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './__tests__/setup.ts',
    testTimeout: 30000,
    hookTimeout: 60000,
    isolate: true,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
})
