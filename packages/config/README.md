# @coderizehq/config

CoderizeHQ's shared ESLint presets and Prettier config. Every CoderizeHQ repo uses these and adds nothing of its own
(STANDARDS.md 3).

```sh
pnpm add -D @coderizehq/config eslint prettier
```

`eslint.config.js`, for an Astro site (`node` for everything else):

```js
import { astro } from '@coderizehq/config/eslint'

export default astro
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
- Both: unused variables are errors, except arguments starting with `_`.
- Prettier: 120 columns, 2 spaces, single quotes, no semicolons, trailing commas, LF; `.astro` files through
  prettier-plugin-astro, which comes with this package.

A new error-level rule, or a warning raised to an error, is a breaking change and a major version. Import rules, when
they're added, come from eslint-plugin-import-x; a React preset, when a site needs one, pins `settings.react.version`.
