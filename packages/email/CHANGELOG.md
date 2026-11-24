# Changelog

Moved here from CoderizeDEV/coderize-platform (`packages/email` at c60309c) and renamed `@coderizehq/email`. The entries from 0.1.1 down are `@coderize/email`'s, released from that repo with Changesets; its git history stays there.

## 1.0.0 (2026-11-24)


### Features

* move the [@coderize](https://github.com/coderize) packages here as @coderizehq/* ([#16](https://github.com/CoderizeHQ/packages/issues/16)) ([a4011d4](https://github.com/CoderizeHQ/packages/commit/a4011d4cf268b0262aa9c3b23c93503290b0c088))

## 0.1.1

### Patch Changes

- First release through the coderize-platform release workflow (npm trusted publishing). No code changes from 0.1.0.

## 0.1.0

### Minor Changes

- First release. `createMailer({ from, configurationSet, client, region, logger, env })` returns `send()` and `trySend()`: SES v2 only when `EMAIL_PROVIDER=ses`, a log line otherwise (error level and no body in production), `{ status: 'sent' | 'logged' | 'skipped', id }` results, and a `SendError` with `kind` `'transient'` or `'permanent'` when a message did not go out. `to`, `cc`, `bcc` and `replyTo` take one address or a flat list; custom headers (RFC 8058 List-Unsubscribe) work on both paths; any attachment sends a hand-built RFC 2045 raw MIME message. Also `buildRawMessage`, `isTransientAwsError`, `esc`, and `@coderize/email/sns` (`verifySnsMessage`, `confirmSubscription` and the pieces) with the exact `sns.<topic region>.amazonaws.com` certificate host rule. No configuration set is named unless an app asks for one.
