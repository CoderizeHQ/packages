import * as Sentry from '@sentry/node'

const DENY = ['forwarded', '-ip', 'remote-', 'via', '-user']

/**
 * Sentry 11's documented v10-equivalent baseline. Left unset, v11 sends cookies (session tokens), request
 * and response bodies, user IPs and database query data; v10 sent none of that. Loosen a category
 * deliberately, never by leaving this out.
 */
export const dataCollection = Object.freeze({
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { deny: DENY }, response: { deny: DENY } },
  httpBodies: [],
  urlQueryParams: { deny: DENY },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
})

/**
 * Initialises `@sentry/node` the way every fleet API does, or does nothing when there is no DSN, so local
 * dev and tests need none and `captureException` is then a no-op.
 *
 * Defaults: `dsn` from `SENTRY_DSN`, `environment` from `NODE_ENV`, `release` from `SENTRY_RELEASE`, the
 * Fastify integration, 10% of transactions traced in production and all of them elsewhere, and
 * `dataCollection` above. Any option passed here overrides its default.
 * @param {import('@sentry/node').NodeOptions} [options]
 * @returns {boolean} whether Sentry was initialised
 */
export function initSentry(options = {}) {
  const dsn = options.dsn ?? process.env.SENTRY_DSN
  if (!dsn) return false
  const environment = process.env.NODE_ENV
  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE,
    integrations: [Sentry.fastifyIntegration()],
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    dataCollection: structuredClone(dataCollection),
    ...options,
  })
  return true
}

/** `@sentry/node`'s `captureException`, for `createErrorHandler({ captureException })`. */
export const captureException = Sentry.captureException
