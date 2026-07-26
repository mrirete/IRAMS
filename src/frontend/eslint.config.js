import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // supabase/functions are Deno (npm: specifiers, Deno globals) — lint noise
  // under this Node-targeted config; they're type-checked at deploy instead.
  globalIgnores(['dist', 'supabase/functions']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // ── Advisory tier (warn): high-volume hygiene. Errors are reserved for
      // rules whose violations are actual bug classes, so `npm run lint`
      // exiting non-zero always means something real. ──
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'warn',
      'react-refresh/only-export-components': 'warn',
      // react-hooks v7 heuristic rules — useful signals, too speculative to gate on
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/use-memo': 'warn',
      // Empty catch is an accepted pattern here (best-effort cleanup paths)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
