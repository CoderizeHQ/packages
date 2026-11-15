// The shared ESLint presets (STANDARDS.md 3): a repo's eslint.config.js picks one and adds nothing but its own ignores.
//   import { astro } from '@coderizehq/config/eslint'
//   export default astro
// Lint finds mistakes, never formatting: that's Prettier's job, so no stylistic rule belongs here. A new error-level
// rule, or a warning raised to an error, is a breaking change (`feat!:`). Import rules, when they're added, come from
// eslint-plugin-import-x; a React preset, when a site needs one, pins `settings.react.version`.

import js from '@eslint/js'
import astroPlugin from 'eslint-plugin-astro'
import globals from 'globals'

const ignores = { ignores: ['dist/', '.astro/', 'coverage/', 'node_modules/'] }

const rules = {
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
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
