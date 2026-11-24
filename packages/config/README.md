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

An Astro site with React islands spreads both: `export default [...astro, ...react]`.

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
  `src/`, Node globals in config files, `scripts/` and tests (`.test.jsx` too). `settings.react.version` is pinned
  to 19.2: on ESLint 10, eslint-plugin-react's version detection crashes. Off, as in `@coderize/config`: `prop-types`,
  `jsx-no-target-blank` and `no-unescaped-entities`. The React Compiler checks that flag working code
  (`set-state-in-effect`, `purity`, `globals`) warn rather than fail.
- All three: unused variables are errors, except arguments starting with `_`.
- Prettier: 120 columns, 2 spaces, single quotes, no semicolons, trailing commas, LF; `.astro` files through
  prettier-plugin-astro, which comes with this package.

A new error-level rule, or a warning raised to an error, is a breaking change and a major version. Import rules, when
they're added, come from eslint-plugin-import-x.

## Where versions come from

Every version from 0.1.1 on is built and staged by `publish.yml` in CoderizeHQ/packages, with provenance, and goes
live only once James approves it on npmjs.com. 0.1.1 is the first version on npm: the hand-staged bootstrap versions
(0.0.0 and 0.0.0-stage) were unpublished on 2026-11-15, and 0.1.0 was tagged but never published.
