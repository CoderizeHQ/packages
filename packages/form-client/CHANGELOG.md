# Changelog

Moved here from CoderizeDEV/coderize-platform (`packages/form-client` at c60309c) and renamed `@coderizehq/form-client`. The entries from 0.1.1 down are `@coderize/form-client`'s, released from that repo with Changesets; its git history stays there.

## 1.0.0 (2026-11-24)


### Features

* move the [@coderize](https://github.com/coderize) packages here as @coderizehq/* ([#16](https://github.com/CoderizeHQ/packages/issues/16)) ([a4011d4](https://github.com/CoderizeHQ/packages/commit/a4011d4cf268b0262aa9c3b23c93503290b0c088))

## 0.1.1

### Patch Changes

- First release through the coderize-platform release workflow (npm trusted publishing). No code changes from 0.1.0.

## 0.1.0

### Minor Changes

- First release: `submitForm` sends a form to form-api-ses and resolves `{ ok: true }` or `{ ok: false, status, message }` with the API's own message, throwing `FormClientConfigError` for a missing endpoint or client instead of resolving as sent. `createFormGuard` (and `useFormGuard` under `@coderize/form-client/react`) sends the `website` honeypot and `_fillMs`. Fields named like a reserved key (`RESERVED_FIELDS`) are sent as `<name>_field`, so they can't change the client, form, subject or traps. `uploadFile`, and `files` on `submitForm`, upload through the presigned `/upload` flow. TypeScript types included.
