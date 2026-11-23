# @coderize/email

## 0.1.1

### Patch Changes

- First release through the coderize-platform release workflow (npm trusted publishing). No code changes from 0.1.0.

## 0.1.0

### Minor Changes

- First release. `createMailer({ from, configurationSet, client, region, logger, env })` returns `send()` and `trySend()`: SES v2 only when `EMAIL_PROVIDER=ses`, a log line otherwise (error level and no body in production), `{ status: 'sent' | 'logged' | 'skipped', id }` results, and a `SendError` with `kind` `'transient'` or `'permanent'` when a message did not go out. `to`, `cc`, `bcc` and `replyTo` take one address or a flat list; custom headers (RFC 8058 List-Unsubscribe) work on both paths; any attachment sends a hand-built RFC 2045 raw MIME message. Also `buildRawMessage`, `isTransientAwsError`, `esc`, and `@coderize/email/sns` (`verifySnsMessage`, `confirmSubscription` and the pieces) with the exact `sns.<topic region>.amazonaws.com` certificate host rule. No configuration set is named unless an app asks for one.
