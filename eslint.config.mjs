import tseslint from 'typescript-eslint'

const INTERNALS_MESSAGE =
  'next-federation must not import Next.js internals (design §3).'

const internals = {
  group: ['next/dist/*', 'next/dist/**'],
  message: INTERNALS_MESSAGE,
}
const pluginRsc = {
  group: ['@vitejs/plugin-rsc', '@vitejs/plugin-rsc/*', 'virtual:vite-rsc/*'],
  message:
    '@vitejs/plugin-rsc and virtual:vite-rsc/* may only be used under packages/vite/src/plugin-rsc/.',
}
const frameworks = {
  group: ['next', 'next/*', 'vite', '@vitejs/*'],
  message:
    'This package must stay framework-free: no imports of next, vite or @vitejs/*.',
}

// `no-restricted-imports` does not merge across config objects, so every
// block below lists its complete pattern set.
const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
})

const FRAMEWORK_FREE = ['sdk', 'protocol', 'core', 'react', 'server', 'island']

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next*/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '.superpowers/**',
      'spike/**',
      '**/next-env.d.ts',
    ],
  },
  tseslint.configs.recommended,
  {
    files: ['packages/**/*.{ts,tsx,mts,cts,js,mjs}'],
    rules: {
      'no-console': 'error',
      ...restrict(internals, pluginRsc),
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='connection']",
          message: 'next-federation must never call connection() (design §3).',
        },
      ],
    },
  },
  {
    files: FRAMEWORK_FREE.map(
      (name) => `packages/${name}/**/*.{ts,tsx,mts,cts}`
    ),
    rules: restrict(internals, pluginRsc, frameworks),
  },
  {
    files: ['packages/vite/src/plugin-rsc/**/*.{ts,tsx,mts,cts}'],
    rules: restrict(internals),
  },
  {
    files: ['packages/sdk/src/logger.ts'],
    rules: { 'no-console': 'off' },
  }
)
