// The shared Prettier config (STANDARDS.md 3). A repo's .prettierrc.json is one line:
//   "@coderizehq/config/prettier"
// The Astro plugin is resolved here, by path, so a site needs no plugin of its own. Prettier loads a shared config
// by its default export.

import { fileURLToPath } from 'node:url'

/** @type {import('prettier').Config} */
export default {
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  endOfLine: 'lf',
  plugins: [fileURLToPath(import.meta.resolve('prettier-plugin-astro'))],
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
}
