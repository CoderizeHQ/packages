/*
  The fleet's one error handler, taken from xceptionalheroes-org-mono's lib/errors.js and the
  { error, code } handlers in budget-boulanmanor, emcog, memphisnightmare and takeurown.

  Prisma's messages quote the values a query was given: a validation error prints the whole argument
  tree (names, emails, notes), and a failed write can carry Postgres's "Key (email)=(...)" detail.
  Fastify's default handler would send that message to the browser. So:

  - An AppError was raised on purpose: its message and code go back as they are. Its message is
    written by the API's author, so it must never quote another error's message.
  - An error whose code the API mapped in `errorCodes` (a multipart FST_REQ_FILE_TOO_LARGE as 413
    FILE_TOO_LARGE, in takeurown) gets the status, message and code the API gave it.
  - A JSON-schema validation error keeps Fastify's message ("body/email must match format
    "email""), which describes the schema, not the value sent.
  - A Prisma "record not found" (P2025) or unique-constraint failure (P2002) becomes a plain 404 or
    409, except on a webhook route (`config.webhook`, which rawJsonBody sets): there the sender is a
    machine that retries on a 5xx and gives up on a 4xx, so a failed write is our fault and falls
    through to the reported 500.
  - Any other error that already carries a 4xx status (rate limit 429, bad JSON 400, body too large
    413, @fastify/sensible's reply.notFound() and friends) keeps its status, message and headers.
  - Anything else is a fault on our side: a 500 with a fixed message, reported to Sentry. That includes
    an error carrying a 5xx status of its own: its message is never sent.

  Logs get only facts that cannot hold a value: the error's name, code and status, and for a
  database error the model, constraint, driver error kind and which Prisma call failed, plus the first
  line of our own code on the stack. Never the message, meta.cause or the driver's detail.
*/

/** The body of every unexpected error: it never says what went wrong. */
export const INTERNAL_ERROR_MESSAGE = 'Internal server error'

/** Prisma known-request codes that mean something to the person who asked. */
const KNOWN_REQUEST = {
  P2025: { statusCode: 404, message: 'Not found', code: 'NOT_FOUND' },
  P2002: { statusCode: 409, message: 'Already exists', code: 'CONFLICT' },
}

// Prisma colours its messages when it thinks it is on a terminal, which splits the line we match.
// eslint-disable-next-line no-control-regex -- the escape character is what this matches
const ANSI = /\u001b\[[0-9;]*m/g
const INVOCATION = /`([\w$]+(?:\.[\w$]+)*\(\))` invocation/

/** An error a route raises on purpose. Its message is shown to the caller as it is. */
export class AppError extends Error {
  /**
   * @param {string} message shown to the caller
   * @param {number} [statusCode] HTTP status, 400 by default
   * @param {string} [code] stable machine-readable code the frontend can switch on
   */
  constructor(message, statusCode = 400, code = 'APP_ERROR') {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
  }
}

/**
 * @typedef {object} ErrorBodyInput
 * @property {number} statusCode
 * @property {string} message safe to show: an AppError's or a 4xx message, or a fixed one
 * @property {string} code
 */

/**
 * @typedef {object} ErrorCodeAnswer
 * @property {number} statusCode a 4xx or 5xx status
 * @property {string} message shown to the caller
 * @property {string} code
 */

/**
 * @typedef {object} ErrorHandlerOptions
 * @property {(error: unknown) => unknown} [captureException] called with every 5xx error, e.g.
 *   Sentry's `captureException`. Defaults to a no-op.
 * @property {number} [validationStatusCode] status for JSON-schema validation errors, 422 by default
 * @property {(input: ErrorBodyInput, request: import('fastify').FastifyRequest) => unknown} [body]
 *   builds the response body. Defaults to `{ error: message, code }`.
 * @property {Record<string, ErrorCodeAnswer>} [errorCodes] answers for errors by their `code`, checked
 *   before the built-in mappings, e.g. `{ FST_REQ_FILE_TOO_LARGE: { statusCode: 413, message: 'File too
 *   large', code: 'FILE_TOO_LARGE' } }`. The message is the one given here, never the error's.
 */

/** @param {ErrorBodyInput} input */
const defaultBody = ({ message, code }) => ({ error: message, code })

/**
 * Builds the Fastify error handler. Set it with `app.setErrorHandler()` before any `register()`: an
 * awaited register() loads its routes at once, and they keep the handler that existed then.
 * @param {ErrorHandlerOptions} [options]
 * @returns {(error: any, request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => import('fastify').FastifyReply}
 */
export function createErrorHandler({
  captureException = () => {},
  validationStatusCode = 422,
  body = defaultBody,
  errorCodes = {},
} = {}) {
  const mapped = compileErrorCodes(errorCodes)
  const answer = (request, reply, statusCode, message, code) =>
    reply.code(statusCode).send(body({ statusCode, message, code }, request))

  return function errorHandler(error, request, reply) {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) serverFault(error, request, captureException)
      else request.log.info({ error: errorFacts(error) }, 'request error')
      return answer(request, reply, error.statusCode, error.message, error.code)
    }

    if (error?.validation) {
      request.log.info({ error: errorFacts(error) }, 'validation failed')
      return answer(request, reply, validationStatusCode, error.message, 'VALIDATION_ERROR')
    }

    const own = typeof error?.code === 'string' && mapped.get(error.code)
    if (own) {
      if (own.statusCode >= 500) serverFault(error, request, captureException)
      else request.log.info({ error: errorFacts(error) }, `error answered ${own.statusCode}`)
      return answer(request, reply, own.statusCode, own.message, own.code)
    }

    const known =
      !isWebhookRoute(request) &&
      error?.name === 'PrismaClientKnownRequestError' &&
      Object.hasOwn(KNOWN_REQUEST, error.code) &&
      KNOWN_REQUEST[error.code]
    if (known) {
      request.log.info({ error: errorFacts(error) }, `database error answered ${known.statusCode}`)
      return answer(request, reply, known.statusCode, known.message, known.code)
    }

    const statusCode = error?.statusCode
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500 && !findDatabaseError(error)) {
      request.log.info({ error: errorFacts(error) }, 'request error')
      // Fastify's default handler sends these headers (an Allow, a WWW-Authenticate); a custom one must.
      if (error.headers && typeof error.headers === 'object') reply.headers(error.headers)
      return answer(request, reply, statusCode, String(error.message ?? ''), error.code ?? 'REQUEST_ERROR')
    }

    serverFault(error, request, captureException)
    return answer(request, reply, 500, INTERNAL_ERROR_MESSAGE, 'INTERNAL')
  }
}

// A webhook sender (Stripe, SNS) retries a 5xx and drops the event on a 4xx, and nobody reads the body. So
// a database error on its route is never a 404 or 409: it stays a 500, reported, and the retry runs it again.
function isWebhookRoute(request) {
  return request.routeOptions?.config?.webhook === true
}

/** @param {Record<string, ErrorCodeAnswer>} errorCodes */
function compileErrorCodes(errorCodes) {
  if (!errorCodes || typeof errorCodes !== 'object') {
    throw new TypeError('createErrorHandler: errorCodes must be an object keyed by error code')
  }
  const map = new Map()
  for (const [key, entry] of Object.entries(errorCodes)) {
    const { statusCode, message, code } = entry ?? {}
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new TypeError(`createErrorHandler: errorCodes.${key}.statusCode must be a 4xx or 5xx status`)
    }
    if (typeof message !== 'string' || typeof code !== 'string') {
      throw new TypeError(`createErrorHandler: errorCodes.${key} needs a message and a code`)
    }
    map.set(key, { statusCode, message, code })
  }
  return map
}

function serverFault(error, request, captureException) {
  request.log.error({ error: errorFacts(error) }, 'unexpected error')
  try {
    captureException(error)
  } catch {
    // Reporting must never turn a 500 into a crash.
  }
}

/**
 * What can be logged about an error without logging a value it holds.
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
export function errorFacts(error) {
  if (!error || typeof error !== 'object') return { name: typeof error }
  const dbError = findDatabaseError(error)
  const facts = {
    name: typeof error.name === 'string' ? error.name : undefined,
    code: typeof error.code === 'string' || typeof error.code === 'number' ? error.code : undefined,
    statusCode: Number.isInteger(error.statusCode) ? error.statusCode : undefined,
    frame: firstAppFrame(error),
  }
  if (dbError) facts.database = databaseFacts(dbError)
  return facts
}

function isDatabaseError(error) {
  const name = typeof error?.name === 'string' ? error.name : ''
  return (
    name.startsWith('PrismaClient') ||
    // The driver adapter's error, when Prisma passes it on rather than wrapping it.
    name === 'DriverAdapterError' ||
    // node-postgres's own DatabaseError, should one get past the adapter.
    (typeof error?.code === 'string' && typeof error?.severity === 'string')
  )
}

// The error itself, or a database error it wraps as its cause.
function findDatabaseError(error) {
  for (let e = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (isDatabaseError(e)) return e
  }
  return null
}

function databaseFacts(error) {
  const meta = error.meta && typeof error.meta === 'object' ? error.meta : {}
  // The adapter's description of the failure. Only its kind, code and constraint are kept: the rest
  // can hold Postgres's message and detail, which quote values.
  const adapter = error.name === 'DriverAdapterError' ? error.cause : meta.driverAdapterError?.cause
  const message = String(error.message ?? '').replace(ANSI, '')
  return {
    name: error.name,
    code: error.code ?? error.errorCode ?? adapter?.originalCode,
    kind: adapter?.kind,
    model: meta.modelName,
    target: meta.target ?? adapter?.constraint,
    invocation: message.match(INVOCATION)?.[1],
  }
}

// The first stack frame in our code, e.g. "async Object.<anonymous> (file:///app/apps/api/src/routes/heroes.js:42:7)".
function firstAppFrame(error) {
  const stack = typeof error.stack === 'string' ? error.stack : ''
  const message = String(error.message ?? '')
  // Only what follows the message: the stack starts with it, and the message is what holds values.
  const at = message ? stack.indexOf(message) : 0
  if (at === -1) return undefined
  return stack
    .slice(at + message.length)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('at ') && /:\d+:\d+\)?$/.test(line) && !/node_modules|\bnode:/.test(line))
    ?.slice(3)
}
