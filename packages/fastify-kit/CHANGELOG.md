# @coderize/fastify-kit

## 0.4.0

### Minor Changes

- Add `requestIdOptions()`, the Fastify constructor options that set `request.id` from the incoming `x-request-id` when it is a sane value (letters, digits and `._:-`, at most 128 characters) and a new UUID otherwise, and `echoRequestId`, a plugin that sends the id back in `x-request-id` on every reply; `isSaneRequestId` and `REQUEST_ID_HEADER` are exported with them. They replace the `requestIdHeader` / `genReqId` pair each API repeats, which kept any incoming value unchecked. Declare `pino-pretty` 13 as an optional peer dependency: `loggerOptions()` loads it by name when `NODE_ENV=development`, and production never does. Nothing changes for an API until it opts in.

## 0.3.0

### Minor Changes

- Answer a Prisma P2025 or P2002 on a webhook route with the reported 500, not 404 or 409. A webhook's sender retries a 5xx and drops the event on a 4xx, so a Stripe webhook whose handler hit either code was answered 404/409, never retried and never reported. `rawJsonBody` now sets `config.webhook: true` on every route registered after it in its plugin, and `createErrorHandler` skips its Prisma mapping on routes with that flag; any route can set the flag itself. Ordinary routes still answer 404 and 409.

## 0.2.0

### Minor Changes

- Add `securityPlugins` (`@coderize/fastify-kit/security`), `rawJsonBody`, `startServer`, `requireEnv`, `verifyTurnstile` and `requireTurnstile`; mask secret query parameters and path segments in logged URLs (`redactUrl`, `createUrlRedactor`, the `redactQuery` and `redactPathAfter` options); add the error handler's `errorCodes` option and export `errorFacts`.

## 0.1.1

### Patch Changes

- First release staged by CI, which validates the npm trusted publisher; the code is the same as 0.1.0, published by hand.

## 0.1.0

First release: `healthRoutes`, `createErrorHandler` and `AppError`, `trustCaddyHop`, `loggerOptions` and
`redactPaths`, and `initSentry` with the Sentry 11 v10-equivalent `dataCollection` baseline, taken from
the fleet's Fastify APIs.
