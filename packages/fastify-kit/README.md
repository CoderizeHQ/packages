# @coderize/fastify-kit

The pieces every CoderizeDEV Fastify API carries a copy of: health checks, the error handler, the Caddy
trust-proxy function, logger options, the Sentry setup, the CORS/helmet/rate-limit preset, the raw body a
webhook needs, server start and shutdown, the startup env check and Turnstile verification. Each one works
on its own, so an API can move onto them one at a time.

```bash
pnpm add @coderize/fastify-kit
pnpm add @sentry/node      # only if the API reports to Sentry
pnpm add @fastify/cors @fastify/helmet @fastify/rate-limit   # only for @coderize/fastify-kit/security
pnpm add -D pino-pretty    # pretty logs when NODE_ENV=development
```

Peer dependencies: `fastify` 5; `@sentry/node` 11 for `@coderize/fastify-kit/sentry` only; `@fastify/cors`
11, `@fastify/helmet` 13 and `@fastify/rate-limit` 11 for `@coderize/fastify-kit/security` only;
`pino-pretty` 13 for development logs only. The main entry loads none of them, so an API without them imports
the rest freely.

## All together

```js
// src/lib/env.js: imported first, so a missing setting stops the app before anything else runs
import { requireEnv } from '@coderize/fastify-kit'

requireEnv(['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGINS'])
export const env = process.env
```

```js
// src/app.js
import Fastify from 'fastify'
import {
  createErrorHandler,
  echoRequestId,
  healthRoutes,
  loggerOptions,
  requestIdOptions,
  trustCaddyHop
} from '@coderize/fastify-kit'
import { securityPlugins } from '@coderize/fastify-kit/security'
import { captureException, initSentry } from '@coderize/fastify-kit/sentry'

import { env } from './lib/env.js'

initSentry() // a no-op without SENTRY_DSN

export async function buildApp({ logger = loggerOptions() } = {}) {
  const app = Fastify({
    logger,
    ...requestIdOptions(),
    trustProxy: trustCaddyHop
  })

  // BEFORE any register(): routes keep the error handler that existed when they were registered.
  app.setErrorHandler(createErrorHandler({ captureException }))

  await app.register(echoRequestId)
  await app.register(securityPlugins, { origins: env.CORS_ORIGINS })
  await app.register(import('./plugins/db.js'))
  await app.register(healthRoutes, { checkDatabase: (app) => app.prisma.$queryRaw`SELECT 1` })
  // ...the API's own plugins and routes

  return app
}
```

```js
// src/server.js
import { startServer } from '@coderize/fastify-kit'

import { buildApp } from './app.js'

const app = await buildApp()
// start background jobs here, never in buildApp(), and stop them in an onClose hook
await startServer(app)
```

## Health checks: `healthRoutes`

A route plugin serving the fleet's two paths. Register it at the root.

| Route               | Answers                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /health`       | `200 { status: 'ok', service, timestamp }`. Never touches the database.                             |
| `GET /health/ready` | `200 { status: 'ok', db: 'up', timestamp }`, or `503 { status: 'degraded', db: 'down', timestamp }` |

Options: `checkDatabase(app)`, an async function that throws when the database is unreachable, and
`service` (default `'api'`). Without `checkDatabase`, readiness answers `200 { status: 'ok', db: 'none' }`.
Both routes are `logLevel: 'silent'`; a failed readiness check is still logged, by name and code only.

Liveness stays off the database because Docker healthchecks and Uptime Kuma poll it, and a query on every
poll keeps Neon's compute awake around the clock.

**Migrating:** delete `src/routes/health.js` and its `register()`, then:

```js
import { healthRoutes } from '@coderize/fastify-kit'

await app.register(healthRoutes, { checkDatabase: (app) => app.prisma.$queryRaw`SELECT 1` })
// no database: await app.register(healthRoutes)
```

Register it without `{ prefix: '/health' }`: the plugin already serves `/health` and `/health/ready`.

## Error handler: `createErrorHandler`, `AppError`, `errorFacts`

```js
app.setErrorHandler(createErrorHandler({ captureException }))

throw new AppError('Event is full', 409, 'EVENT_FULL') // in a route
```

### Set it before any `register()`

`app.setErrorHandler()` must come **before the first `register()`** of a plugin or route module. An awaited
`register()` loads its routes at once, and each encapsulated plugin keeps the error handler that existed
when it was registered. A handler set after the routes never runs for them: they get Fastify's default
handler, which sends a 500's raw message (Prisma's, with the query's values) to the client.
budget-boulanmanor sets its handler last, so its P2002 → 409 and P2025 → 404 mapping never runs.

```js
const app = Fastify({ ... })
app.setErrorHandler(createErrorHandler({ captureException })) // first
await app.register(securityPlugins, { origins })               // then everything else
```

### What it answers

| Error                                                      | Answer                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `AppError(message, statusCode = 400, code)`                | its status, `{ error: message, code }`                         |
| Fastify JSON-schema validation                             | 422 `{ error: <Fastify's message>, code: 'VALIDATION_ERROR' }` |
| an error whose `code` is in the `errorCodes` option        | the status, message and code the option gives                  |
| Prisma `P2025`, except on a webhook route                  | 404 `{ error: 'Not found', code: 'NOT_FOUND' }`                |
| Prisma `P2002`, except on a webhook route                  | 409 `{ error: 'Already exists', code: 'CONFLICT' }`            |
| any other error with a 4xx `statusCode` (400, 413, 429...) | its status, message, `code` and `headers`                      |
| anything else, a 5xx `statusCode` included                 | 500 `{ error: 'Internal server error', code: 'INTERNAL' }`     |

A 4xx keeps its own status and its own `code`: a rate-limit 429 stays `FST_ERR_RATE_LIMITED` with its
`Retry-After`, bad JSON stays 400 `FST_ERR_CTP_INVALID_JSON_BODY`, a body over the limit stays 413
`FST_ERR_CTP_BODY_TOO_LARGE`, and an `AppError('...', 413, 'FILE_TOO_LARGE')` stays exactly that.

Prisma's messages quote the values a query was given (names, emails, notes), so no message other than an
`AppError`'s, an `errorCodes` entry's or a 4xx's ever reaches the response, and a 5xx never sends its own.
An `AppError`'s message is written by the API's author: never build one from another error's message. Logs
never get a message either: only the error's name, code and status, the first stack frame in the API's own
code, and for a database error the model, constraint, driver error kind and the Prisma call that failed.
5xx errors are logged at `error` and passed to `captureException`; 4xx at `info`, and never to Sentry.

**Webhook routes** answer a Prisma P2025 or P2002 with the reported 500 instead. A webhook's sender (Stripe,
SNS) retries a 5xx and drops the event on a 4xx, and nobody reads the body, so a 404 or 409 there loses the
event without anyone hearing of it. A route is a webhook route when its `config.webhook` is `true`:
`rawJsonBody` sets that on every route registered after it in its plugin, and any other route can set it
itself (`app.post('/hook', { config: { webhook: true } }, ...)`). `AppError`s and `errorCodes` entries are
still answered as written there; `@coderize/stripe`'s `handleStripeWebhook` turns everything its handlers
throw into a 500 of its own.

Options:

- `captureException(error)`: called for every 5xx. Default: nothing.
- `validationStatusCode`: default 422. An API whose clients expect Fastify's 400 passes `400`.
- `body({ statusCode, message, code }, request)`: builds the response body, for an API whose frontend reads
  another shape. Default: `{ error: message, code }`.
- `errorCodes`: answers for errors by their `code`, checked before the Prisma mapping. Each entry is
  `{ statusCode, message, code }` with a 4xx or 5xx status; a 5xx entry is still reported. For takeurown's
  multipart limits, or another Prisma code:

  ```js
  const tooLarge = { statusCode: 413, message: 'File too large', code: 'FILE_TOO_LARGE' }
  createErrorHandler({
    captureException,
    errorCodes: {
      FST_REQ_FILE_TOO_LARGE: tooLarge,
      FST_FILES_LIMIT: tooLarge,
      P2003: { statusCode: 409, message: 'Still in use', code: 'IN_USE' }
    }
  })
  ```

`errorFacts(error)` returns what the handler logs about an error (name, code, status, our first stack frame,
database facts) for an API's own `catch` blocks: `request.log.warn({ error: errorFacts(err) }, '...')`.

**Migrating:** delete `src/lib/errors.js` (or the inline `setErrorHandler` in `app.js`), then:

```js
import { AppError, createErrorHandler } from '@coderize/fastify-kit'
import { captureException } from '@coderize/fastify-kit/sentry' // or leave it out: no Sentry

app.setErrorHandler(createErrorHandler({ captureException }))
```

Routes keep `throw new AppError(...)`, now imported from the kit. Check the handler sits above every
`register()`. An API with another response shape passes `body` (gronetworking's
`{ success: false, error: { message, code }, requestId }`, whitefeatherfarm's
`{ statusCode, error, message }`) and, if it answers validation with 400, `validationStatusCode: 400`.
bluecopperit's `AppError(message, code, statusCode)` takes its arguments the other way round: swap them at
each throw site. coderize-dev and almontchamber have no handler today, so their 500 bodies change from the
raw message to the fixed one.

## Security preset: `@coderize/fastify-kit/security`

```js
import { securityPlugins } from '@coderize/fastify-kit/security'

await app.register(securityPlugins, { origins: process.env.CORS_ORIGINS })
```

Registers, in this order, on the root instance:

1. **`@fastify/cors`**: `origin` is the list given and nothing else, `credentials: true`, and `methods`
   `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS` (`corsMethods`). The plugin's default is GET, HEAD and POST
   only, so a browser's PUT, PATCH or DELETE fails preflight: the "Failed to fetch" outages in coderize-dev
   and xceptionalheroes.
2. **`@fastify/helmet`**: its defaults, or the `helmet` options given.
3. **`@fastify/rate-limit`**: `{ max: 100, timeWindow: '1 minute', global: false }` (`rateLimitDefaults`),
   merged with the `rateLimit` options given. A route opts in with
   `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }`.

CORS comes first, so a 429 still carries the CORS headers a browser needs to read it.

Options:

- `origins` (required): a list of origins or RegExps, or a comma-separated string such as `CORS_ORIGINS`.
  Each is a scheme and host (`https://app.example.com`, `http://localhost:5173`, `capacitor://localhost`);
  a trailing slash is dropped. `true`, `'*'`, `'null'`, a function or a URL with a path throws at startup,
  because each would let other sites call the API with the visitor's cookies.
- `cors`: more `@fastify/cors` options (`exposedHeaders`, `maxAge`). `cors.origin` throws: use `origins`.
- `helmet`: `@fastify/helmet` options. An API that serves its own HTML pages may need
  `{ contentSecurityPolicy: false }` at first; tune the CSP rather than leaving it off.
- `rateLimit`: `@fastify/rate-limit` options over the defaults.

**Migrating:** delete `src/plugins/cors.js` and `src/plugins/helmet.js` and the rate-limit `register()`,
keep the three packages as the API's own dependencies, then register `securityPlugins` right after
`setErrorHandler`. Check the origins: whitefeatherfarm's `origin: true` and almontchamber's `'*'` fallback
are refused, so set `CORS_ORIGINS` first. APIs whose rate limit is global today (bluecopperit,
collegecostscompared, gronetworking, icrotary, imlay, refuge, trafficticketbuddy) pass
`rateLimit: { global: true }` to keep that, or move to per-route limits.

## Webhook raw body: `rawJsonBody`

A webhook's signature covers the exact bytes sent, so its route needs the raw body. Register `rawJsonBody`
**inside the webhook routes' own plugin**: those routes get `request.rawBody` (a Buffer) and a parsed
`request.body`, and every other route keeps Fastify's parser untouched.

```js
import { rawJsonBody } from '@coderize/fastify-kit'
import { verifyWebhook } from '@coderize/stripe'

await app.register(
  async (webhooks) => {
    await webhooks.register(rawJsonBody)
    webhooks.post('/stripe', async (request) => {
      const event = verifyWebhook({
        stripe,
        rawBody: request.rawBody,
        signature: request.headers['stripe-signature'],
        secret: env.STRIPE_WEBHOOK_SECRET
      })
      // ...
    })
  },
  { prefix: '/webhooks' }
)
```

The body is parsed with Fastify's own safe parser, so prototype-poisoning protection
(`onProtoPoisoning`, `onConstructorPoisoning`, `'error'` by default) stays on, and malformed or empty JSON
answers 400 `FST_ERR_CTP_INVALID_JSON_BODY` / `FST_ERR_CTP_EMPTY_JSON_BODY`.

Every route registered after it in that plugin, nested route modules included, gets `config.webhook: true`,
so `createErrorHandler` answers a Prisma P2025 or P2002 there with a reported 500 rather than 404 or 409
(above). Register it before the routes, as here. A route that sets `config.webhook` itself keeps its value.

Options: `contentTypes`, `['application/json']` by default (an SES events route that SNS posts to passes
`['application/json', 'text/plain']`), and `bodyLimit`.

**Migrating:** bluecopperit, icrotary and xceptionalheroes replace Fastify's JSON parser for the whole app
with `JSON.parse`, which drops the prototype-poisoning guard on every route (and bluecopperit answers bad
JSON with a 500). Delete that global `addContentTypeParser`, then register `rawJsonBody` in the webhook's
plugin and read `request.rawBody` where the route read the string or Buffer body. imlayblueberryfestival
and refugelapeer drop `fastify-raw-body` the same way. Run the webhook tests unchanged; a test that injects
a string `payload` with `content-type: application/json` still works.

## Server start and shutdown: `startServer`

```js
await startServer(app) // in src/server.js, after buildApp()
```

Listens on `PORT` (default 3000) and `HOST` (default `0.0.0.0`) and returns the address. On SIGTERM or
SIGINT it closes the app, so in-flight requests finish and `onClose` hooks run (Prisma disconnects, jobs
stop), then exits 0. A second signal, or a close slower than `shutdownTimeoutMs` (10 s, Docker's default
grace), exits 1 at once. A failed listen is logged by name and code and exits 1.

Options: `port`, `host`, `shutdownTimeoutMs`, `signals` (`['SIGTERM', 'SIGINT']`).

**Migrating:** replace the listen and signal code in `src/server.js` with `startServer(app)`. almontchamber,
bluecopperit, icrotary, trafficticketbuddy, whitefeatherfarm and xceptionalheroes handle no SIGTERM today,
so a deploy cuts off their in-flight requests; collegecostscompared exits without closing the app. Move any
`setInterval`/cron stop into an `onClose` hook. The container's start command must `exec node`, or node is
not PID 1 and never sees the SIGTERM (gronetworking and xceptionalheroes run it under `sh -c` without
`exec`).

## Environment check: `requireEnv`

```js
requireEnv(['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGINS'])
```

Throws one error naming every required variable that is unset or blank (only whitespace counts as blank):
`Missing required environment variables: JWT_SECRET, CORS_ORIGINS`. The error has `code: 'MISSING_ENV'`
and `missing`, the list. Values never appear in it. Returns the required values by name. A second argument
replaces `process.env`, for tests.

It loads nothing: `.env` comes from `node --env-file=.env` in the `dev` and `start` scripts, and tests must
never read it.

**Migrating:** replace the loop in `src/lib/env.js` with `requireEnv([...])`. Remove `import 'dotenv/config'`
there (icrotary, trafficticketbuddy): it puts the developer's `.env` in the test import graph.

## Turnstile: `verifyTurnstile`, `requireTurnstile`

```js
import { requireTurnstile } from '@coderize/fastify-kit'

app.post(
  '/contact',
  { preHandler: requireTurnstile({ action: 'contact', hostname: ['example.com', 'www.example.com'] }) },
  handler
)
```

`requireTurnstile(options)` is a preHandler that verifies the body's `turnstileToken` and throws an
`AppError` for the error handler to answer:

- 403 `CHALLENGE_FAILED` when the token is missing, rejected, or issued for another action or site;
- 503 `CHALLENGE_UNAVAILABLE` when `TURNSTILE_SECRET_KEY` is unset or Cloudflare can't be reached. That one
  is reported to Sentry: it is ours to fix.

It **fails closed**: with no secret, every submission is refused, in every environment. In development, set
Cloudflare's test secret `1x0000000000000000000000000000000AA` (always passes) or mock the check.

`verifyTurnstile(token, options)` is the check on its own. It never throws and returns `{ ok: true }` or
`{ ok: false, reason }`, `reason` one of `NOT_CONFIGURED`, `MISSING_TOKEN`, `UNREACHABLE`, `REJECTED`
(with Cloudflare's `errorCodes`), `ACTION_MISMATCH`, `HOSTNAME_MISMATCH`. It checks `success === true`, then
`action` and `hostname` when they are given, and refuses tokens over 2048 characters without a request.

Options (both): `secret` (default `TURNSTILE_SECRET_KEY`, read on every call), `action`, `hostname` (one
host or a list), `timeoutMs` (10 s). `verifyTurnstile` also takes `remoteIp` and `log`; `requireTurnstile`
passes `request.ip` and `request.log`, and takes `token(request)` to read the token from somewhere other
than `body.turnstileToken`. Logs never get the token or the secret.

**Migrating:** coderize-dev's `requireHuman` fails open (every submission passes while the secret is unset)
and never checks `action` or `hostname`. Before moving it, confirm `TURNSTILE_SECRET_KEY` is set in SSM and
note each form's widget action. xceptionalheroes' `passesChallenge` already fails closed in production; with
the kit it also fails closed in development, so set the test secret locally.

## Trust proxy: `trustCaddyHop`

Fastify's `trustProxy` for an API behind one Caddy on the Docker network: it trusts hop 0 only, and only
from a loopback, link-local or unique-local address, so `request.ip` is the client Caddy forwarded. Never a
number (Fastify 5.12 fails it closed) and never `true` (any client could forge its IP). The app's
Caddyfile must leave `X-Forwarded-For` alone.

**Migrating:** delete `src/lib/trustProxy.js` and its test, drop `@fastify/proxy-addr` from the API's
`package.json`, then:

```js
import { trustCaddyHop } from '@coderize/fastify-kit'

Fastify({ trustProxy: trustCaddyHop })
```

## Request id: `requestIdOptions`, `echoRequestId`

`requestIdOptions({ header, generate })` returns the Fastify constructor options that set `request.id`: the
incoming `x-request-id` when it is a sane value, otherwise a new UUID. Sane means letters and digits first,
then letters, digits, `.`, `_`, `:` or `-`, at most 128 characters: a UUID, a Cloudflare Ray ID or a trace id
passes. Spaces, quotes, the comma of a repeated header or an overlong value don't, so a caller can't write
arbitrary text into the request's log lines or its response header. `isSaneRequestId(value)` is that check.

`echoRequestId` is a plugin that sends `request.id` back in `x-request-id` on every reply, 404s and errors
included, so a caller can quote it in a bug report. Register it once, at the root. Both take a `header`
option for another header name.

**Read the id as `request.id`**, Fastify's own: in handlers, hooks, the error handler's `body` option
(`body: ({ message, code }, request) => ({ error: message, code, requestId: request.id })`) and every
`request.log` line, as `reqId`. Don't decorate a second `request.requestId`.

**Migrating:** replace the pair every API repeats

```js
Fastify({ requestIdHeader: 'x-request-id', genReqId: () => randomUUID() /* ... */ })
```

with `Fastify({ ...requestIdOptions() /* ... */ })`, and replace an own request-id plugin
(gronetworking's `plugin/request-id.plugin.js`, collegecostscompared's `plugins/requestId.js`) with
`app.register(echoRequestId)`. The one change a caller can see: an incoming id that fails the check gets a
fresh UUID instead of being kept as sent. gronetworking also falls back to `cf-ray` and decorates
`request.requestId`; keep that in the API if it still needs it.

## Logger: `loggerOptions`, `redactPaths`, `redactUrl`

`loggerOptions({ redact, redactQuery, redactPathAfter })` returns Fastify `logger` options: level from
`LOG_LEVEL` (default `info`, `debug` in development), `pino-pretty` when `NODE_ENV=development` (an optional
peer dependency: install it as a devDependency, or development starts fail with "unable to determine transport
target for pino-pretty"; production never loads it), request and
reply serializers that keep only method, url, hostname and status, and `redact` set to `redactPaths` plus
any extra paths you pass. `redactPaths` covers the auth and cookie headers, `set-cookie`, and `password`,
`token`, `secret`, `creditCard`, `ssn` at the top level, `password` and `token` one level down.

**Secrets in URLs.** Public links carry their secret in the query string, and anyone holding one can use it
without signing in. The logged `url`, and any log message that quotes a URL (Fastify's
`Route GET:/x?token=... not found`), has these query values replaced with `[redacted]`:

- `redactQueryParams`: `token`, `code`, `ticket`, `access_token`, `refresh_token`, `password`, `secret`,
  `signature`, matched case-insensitively. xceptionalheroes masks `token` and `code`, gronetworking
  `token` and `ticket`.
- `redactQuery`: more names, added to those.
- `redactPathAfter`: path segments whose next segment is a secret. xceptionalheroes passes
  `['invite-codes']`, so `/invite-codes/abc/claim` logs as `/invite-codes/[redacted]/claim`.

The rest of the URL stays exactly as sent, so the line still shows the path and which parameter was there.
`redactUrl(url)` applies the defaults to any string, and `createUrlRedactor({ query, pathAfter })` builds
one with other names.

**Migrating:** delete `src/lib/logger.js`, or the logger object in `server.js`, then:

```js
import { loggerOptions } from '@coderize/fastify-kit'

export async function buildApp({ logger = loggerOptions() } = {}) {
  const app = Fastify({ logger /* ... */ })
}
```

Replace a bare `logger: true` the same way: it skips redaction. xceptionalheroes passes
`loggerOptions({ redactPathAfter: ['invite-codes'] })`; gronetworking needs nothing extra. Both drop their
own `redactUrl`. Their request lines lose `remoteAddress`, `remotePort` and `host`, and gain `hostname`,
like the rest of the fleet.

## Sentry: `@coderize/fastify-kit/sentry`

`initSentry(options)` initialises `@sentry/node` with the fleet defaults (DSN from `SENTRY_DSN`,
environment from `NODE_ENV`, release from `SENTRY_RELEASE`, the Fastify integration, 10% tracing in
production) and `dataCollection`, Sentry 11's v10-equivalent baseline. Unset, v11 sends cookies, bodies,
user IPs and database query data. Without a DSN it does nothing and returns `false`, so dev and tests need
none. Any option passed overrides its default. `captureException` is Sentry's own, re-exported.

**Migrating:** replace the body of `src/lib/sentry.js` (keep the file if it is imported first):

```js
import { initSentry } from '@coderize/fastify-kit/sentry'

initSentry()
```

and pass `captureException` to `createErrorHandler` instead of calling `Sentry.captureException` in a
handler. The API keeps `@sentry/node` as its own dependency.

## Versions

Semver from what a consuming API feels: a **patch** changes nothing it can see, a **minor** adds an export
or an option, and a **major** can change a response, a log line it relies on or a route (a new status code,
a different body). Renovate merges minors and patches by itself and holds majors for review.

Every release is staged on npm and goes live only once a maintainer approves it with 2FA, because Renovate
carries it into every fleet API.
