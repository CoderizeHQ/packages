# packages

CoderizeHQ's shared npm packages, published under `@coderizehq` on npmjs.com. Public, so npm can show where each
version was built (provenance). A package goes here only when two real repos need the same code.

| Package                                 | What                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| [`@coderizehq/config`](packages/config) | the ESLint presets and the Prettier config every repo uses |

## How a version gets out

1. A PR changes a package. Its title is a Conventional Commit, which Release Please reads: `fix:` is a patch, `feat:`
   a minor, `feat!:` a major. In `@coderizehq/config`, a new error-level rule, or a warning raised to an error, is
   `feat!:`.
2. James approves and merges it (every file here is code-owned).
3. Release Please (platform's `release-bootstrap.yml`) opens a release PR; James merges it, and the next run tags it
   `<package>-v1.2.3`.
4. The tag starts `publish.yml` in the `npm` environment, on a GitHub-hosted runner: `npm stage publish` with
   provenance, signed in by npm's trusted publishing (no npm token exists).
5. James reviews the staged version on npmjs.com (Staged Packages) and approves it with his passkey. Only then is it
   on npm.

Undo: deprecate the version (`npm deprecate`, James); never unpublish.

## Working here

pnpm only (`pnpm install`, `pnpm test`); Node 24. `pnpm test` runs every package's tests. The repo lints and formats
itself with `@coderizehq/config` from this workspace.
