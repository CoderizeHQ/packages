/**
 * pino `redact` paths every API starts from. Paths are exact: `password` matches only a top-level key of
 * the logged object, `*.password` one level down. Redacted values print as `[Redacted]`.
 *
 * The union of the lists in imlayblueberryfestival, refugelapeer and mrleejunkcarbuyer, the only APIs
 * that redact at all.
 */
export const redactPaths = Object.freeze([
  'req.headers.authorization',
  'req.headers.cookie',
  "res.headers['set-cookie']",
  'password',
  'token',
  'secret',
  'creditCard',
  'ssn',
  '*.password',
  '*.token',
])

/**
 * Query parameters whose values never reach a log line. Public links carry their secret in the query
 * string, and anyone holding one can use it without signing in: xceptionalheroes masks `token` and `code`
 * (feedback, account review, newsletter manage), gronetworking `token` and `ticket` (the event stream).
 * The rest are names no API should ever log the value of. Matched case-insensitively.
 */
export const redactQueryParams = Object.freeze([
  'token',
  'code',
  'ticket',
  'access_token',
  'refresh_token',
  'password',
  'secret',
  'signature',
])

/** What a redacted URL value becomes; the two APIs that masked URLs before the kit both wrote this. */
export const REDACTED = '[redacted]'

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function namesPattern(names) {
  const list = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))]
  return list.map(escapeRegExp).join('|')
}

/**
 * @typedef {object} RedactUrlOptions
 * @property {string[]} [query] query parameter names whose values are masked, `redactQueryParams` by
 *   default
 * @property {string[]} [pathAfter] path segments whose NEXT segment is masked: `['invite-codes']` turns
 *   `/invite-codes/abc/claim` into `/invite-codes/[redacted]/claim`
 */

/**
 * Builds a function that masks secrets in a URL, or in any text that contains one (Fastify's "Route
 * GET:/x?token=... not found" line). Everything else stays exactly as it was sent, so the line still
 * shows the path and which parameter was there.
 * @param {RedactUrlOptions} [options]
 * @returns {(text: string) => string}
 */
export function createUrlRedactor({ query = redactQueryParams, pathAfter = [] } = {}) {
  const queryNames = namesPattern(query)
  const pathNames = namesPattern(pathAfter)
  const queryRe = queryNames && new RegExp(`([?&;](?:${queryNames})=)[^&#;\\s]*`, 'gi')
  const pathRe = pathNames && new RegExp(`(/(?:${pathNames})/)[^/?#\\s]+`, 'gi')
  return (text) => {
    if (typeof text !== 'string') return text
    let out = text
    if (queryRe && out.includes('=')) out = out.replace(queryRe, `$1${REDACTED}`)
    if (pathRe) out = out.replace(pathRe, `$1${REDACTED}`)
    return out
  }
}

/**
 * Masks the default secret query parameters in a URL. For more names, or path segments, build one with
 * `createUrlRedactor`.
 */
export const redactUrl = createUrlRedactor()

/**
 * @typedef {object} LoggerOptionsInput
 * @property {string[]} [redact] extra paths, added to `redactPaths` (a route that logs a body adds its
 *   sensitive keys here)
 * @property {string[]} [redactQuery] extra query parameter names, added to `redactQueryParams`
 * @property {string[]} [redactPathAfter] path segments whose next segment is a secret, e.g.
 *   `['invite-codes']`
 */

/**
 * Fastify `logger` options: JSON in production, `pino-pretty` when `NODE_ENV` is `development` (the API
 * installs it as a devDependency), level from `LOG_LEVEL`, the fleet's redaction, and request and reply
 * serializers that keep only method, url, hostname and status. The url, and any log message that quotes
 * one, has its secret query parameters masked. Read when called, so set the environment first.
 * @param {LoggerOptionsInput} [options]
 */
export function loggerOptions({ redact = [], redactQuery = [], redactPathAfter = [] } = {}) {
  const isDev = process.env.NODE_ENV === 'development'
  const maskUrl = createUrlRedactor({ query: [...redactQueryParams, ...redactQuery], pathAfter: redactPathAfter })
  return {
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    redact: [...redactPaths, ...redact],
    serializers: {
      req: (request) => ({ method: request.method, url: maskUrl(request.url), hostname: request.hostname }),
      res: (reply) => ({ statusCode: reply.statusCode }),
    },
    hooks: {
      // Fastify writes the raw URL into some messages, e.g. "Route GET:/feedback?token=... not found".
      logMethod(args, method) {
        return method.apply(
          this,
          args.map((arg) => (typeof arg === 'string' ? maskUrl(arg) : arg)),
        )
      },
    },
    ...(isDev && { transport: { target: 'pino-pretty' } }),
  }
}
