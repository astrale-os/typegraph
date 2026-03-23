import base from '@astrale-os/ox/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  ignorePatterns: ['vscode/out/**', 'vscode/server/**', 'kernel-vscode/server/**'],
  overrides: [
    {
      files: ['**/scripts/**/*.ts'],
      rules: {
        'no-console': 'off',
        'no-explicit-any': 'off',
      },
    },
    {
      files: ['**/examples/**/*.ts'],
      rules: {
        'no-console': 'off',
        'no-explicit-any': 'off',
      },
    },
  ],
})
