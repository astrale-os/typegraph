import { createConfig } from '@astrale/eslint-config'

const baseConfig = createConfig({
  tsconfigRootDir: import.meta.dirname,
})

export default [
  ...baseConfig,
  {
    rules: {
      // Allow inline import() type annotations - used to avoid circular dependencies
      // and for lazy type loading in return type positions
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
    },
  },
]
