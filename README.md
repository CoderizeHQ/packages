# packages

CoderizeHQ's shared npm packages, published under `@coderizehq` on npmjs.com. Public, so npm can show where each
version was built (provenance). A package goes here only when two real repos need the same code.

| Package                                           | What                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| [`@coderizehq/config`](packages/config)           | the ESLint presets and the Prettier config every repo uses          |
| [`@coderizehq/astro-kit`](packages/astro-kit)     | head, sitemap, robots.txt, structured data and GTM for Astro sites  |
| [`@coderizehq/email`](packages/email)             | SES sending for apps: one send switch, raw MIME, an SNS verifier    |
| [`@coderizehq/fastify-kit`](packages/fastify-kit) | Fastify building blocks: health, errors, logger, Sentry, security   |
| [`@coderizehq/form-client`](packages/form-client) | the browser client for the `form-api-ses` form handler              |
| [`@coderizehq/format`](packages/format)           | Michigan-time dates, integer-cents money, CSV, phone numbers, slugs |
| [`@coderizehq/game-kit`](packages/game-kit)       | Play Games cloud save and haptics for the Capacitor games           |
| [`@coderizehq/stripe`](packages/stripe)           | the pinned Stripe API version, the client, its CI guard, webhooks   |

All but `config` moved here from CoderizeDEV/coderize-platform, where they were `@coderize/<name>` (at c60309c).
Their git history stays in that repo; each package's CHANGELOG keeps its old entries.

## How a version gets out

1. A PR changes a package. Its title is a Conventional Commit, which Release Please reads: `fix:` is a patch, `feat:`
   a minor, `feat!:` a major. In `@coderizehq/config`, a new error-level rule, or a warning raised to an error, is
   `feat!:`.
2. James approves and merges it (every file here is code-owned).
3. Release Please (platform's `release-bootstrap.yml`) opens a release PR for each package with releasable changes;
   James merges it, and the next run tags it `<package>-v1.2.3`.
4. The tag starts `publish.yml` in the `npm` environment, on a GitHub-hosted runner: `npm stage publish` with
   provenance, signed in by npm's trusted publishing (no npm token exists).
5. James reviews the staged version on npmjs.com (Staged Packages) and approves it with his passkey. Only then is it
   on npm.

Undo: deprecate the version (`npm deprecate`, James); never unpublish.

A new package name can't have a trusted publisher until it exists on npm, so James stages its first version (the
package's `0.0.0`) by hand, then adds the trusted publisher before the first tag runs `publish.yml`.

## Working here

pnpm only (`pnpm install`, `pnpm test`); Node 26. `pnpm test` runs every package's tests: `config`'s with
`node --test`, the others through their own `test` script (Vitest, plus `tsc` over a checkJs type test where the
package ships `.d.ts` types). The repo lints and formats itself with `@coderizehq/config` from this workspace.
