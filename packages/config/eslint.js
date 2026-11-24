// The shared ESLint presets (STANDARDS.md 3): a repo's eslint.config.js picks one and adds nothing but its own ignores.
//   import { astro } from '@coderizehq/config/eslint'
//   export default astro
// Lint finds mistakes, never formatting: that's Prettier's job, so no stylistic rule belongs here. A new error-level
// rule, or a warning raised to an error, is a breaking change (`feat!:`). Import rules, when they're added, come from
// eslint-plugin-import-x.

import js from '@eslint/js'
import astroPlugin from 'eslint-plugin-astro'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

const ignores = { ignores: ['dist/', '.astro/', 'coverage/', 'node_modules/'] }

// A leading _ marks a variable or argument as deliberately unused, and a rest sibling (`const { hash, ...rest } = user`)
// is how an object drops a key: neither is a mistake. Unused caught errors aren't reported at all, which never fails
// code that passed under @coderize/config (it reported them unless they started with _).
const rules = {
  rules: {
    'no-unused-vars': [
      'error',
      { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
    ],
  },
}

// Config files and scripts run in Node, wherever they sit in a site.
const nodeFiles = {
  files: ['*.config.{js,mjs,cjs}', 'scripts/**/*.{js,mjs}', '**/*.test.{js,mjs}'],
  languageOptions: { globals: { ...globals.node } },
}

/** Node repos: scripts, services, tests. */
export const node = [
  ignores,
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } } },
  rules,
]

/** Astro sites: .astro files and their scripts run in the browser; config files and scripts in Node. */
export const astro = [
  ignores,
  js.configs.recommended,
  ...astroPlugin.configs.recommended,
  { languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } } },
  nodeFiles,
  rules,
]

/**
 * React: a Vite + React app, or the React islands in an Astro site (`[...astro, ...react]`). Code under src/ runs in the
 * browser; config files, scripts and tests (`.test.jsx` too) in Node.
 */
export const react = [
  ignores,
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
  { files: ['src/**/*.{js,jsx,mjs}'], languageOptions: { globals: { ...globals.browser } } },
  { ...nodeFiles, files: [...nodeFiles.files, '**/*.test.jsx'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    // Pinned, never 'detect': on ESLint 10, detection crashes eslint-plugin-react 7.37 while it loads its rules
    // (`contextOrFilename.getFilename is not a function`).
    settings: { react: { version: '19.2' } },
    plugins: { react: reactPlugin, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      // target="_blank" needs rel="noopener" (or "noreferrer"): browsers imply noopener now, but older ones and
      // embedded webviews don't. noopener alone is enough, so the referrer, which client sites usually want sent, stays.
      'react/jsx-no-target-blank': ['error', { allowReferrer: true }],
      // Apostrophes in JSX text are ordinary copy ("don't"), not bugs.
      'react/no-unescaped-entities': 'off',
      // React Compiler heuristics that flag common, working patterns. We don't run the compiler, so they warn rather
      // than fail CI (as they did in @coderize/config's react preset).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/globals': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  rules,
]
