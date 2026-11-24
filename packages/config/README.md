# @coderizehq/config

CoderizeHQ's shared ESLint presets and Prettier config. Every CoderizeHQ repo uses these and adds nothing of its own
(STANDARDS.md 3).

```sh
pnpm add -D @coderizehq/config eslint prettier
```

`eslint.config.js`, for an Astro site (`react` for a Vite + React app, `node` for everything else):

```js
import { astro } from '@coderizehq/config/eslint'

export default astro
```

An Astro site with React islands spreads both:

```js
import { astro, react } from '@coderizehq/config/eslint'

export default [...astro, ...react]
```

`.prettierrc.json`:

```json
"@coderizehq/config/prettier"
```

and a `.prettierignore` that lists `pnpm-lock.yaml`. CI runs `prettier --check .` and `eslint .` as separate steps:
Prettier formats, ESLint finds mistakes and never formats.

## What's in it

- `astro`: ESLint's recommended rules plus eslint-plugin-astro's, browser globals in pages, Node globals in config
  files, `scripts/` and tests.
- `node`: ESLint's recommended rules with Node globals.
- `react`: ESLint's recommended rules plus eslint-plugin-react's (recommended and JSX runtime), eslint-plugin-react-hooks'
  and eslint-plugin-react-refresh's `only-export-components`, which come with this package. Browser globals under
  `src/` and in `public/` scripts, Node globals in config files, `scripts/` and tests (`.test.jsx` too), and both in
  test setup files (`tests/setup.js`, `test/setup.js`, `vitest.setup.js`). Other `src/` code never gets Node globals: Vite
  code reads `import.meta.env`. `settings.react.version` is pinned
  to 19.2: on ESLint 10, eslint-plugin-react's version detection crashes. Version-sensitive rules therefore assume
  React 19, even in an app still on 18. Off, as in `@coderize/config`: `prop-types` and `no-unescaped-entities`.
  `jsx-no-target-blank` stays on, but `rel="noopener"` satisfies it, so the referrer is still sent. The React Compiler
  checks that flag working code (`set-state-in-effect`, `purity`, `globals`) warn rather than fail.
  eslint-plugin-react 7.37 declares ESLint only up to 9.7, so pnpm reports an unmet peer. The rules this preset turns
  on are tested on ESLint 10; any other `react/*` rule may not be.
- All three: unused variables are errors, except variables and arguments starting with `_`, the rest siblings of a
  destructure (`const { hash, ...rest } = user`) and caught errors.
- Prettier: 120 columns, 2 spaces, single quotes, no semicolons, trailing commas, LF; `.astro` files through
  prettier-plugin-astro, which comes with this package.

A new error-level rule, or a warning raised to an error, is a breaking change and a major version. Import rules, when
they're added, come from eslint-plugin-import-x.

## Where versions come from

Every version from 0.1.1 on is built and staged by `publish.yml` in CoderizeHQ/packages, with provenance, and goes
live only once James approves it on npmjs.com. 0.1.1 is the first version on npm: the hand-staged bootstrap versions
(0.0.0 and 0.0.0-stage) were unpublished on 2026-11-15, and 0.1.0 was tagged but never published.
