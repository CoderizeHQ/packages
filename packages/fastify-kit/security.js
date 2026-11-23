import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fp from 'fastify-plugin'

/**
 * Every method a browser may send cross-origin. @fastify/cors defaults to GET, HEAD and POST, so a
 * PUT, PATCH or DELETE from the frontend fails its preflight ("Failed to fetch"), which took coderize-dev
 * and xceptionalheroes down in production.
 */
export const corsMethods = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

/** The fleet's rate limit: opt-in per route through `config.rateLimit`. */
export const rateLimitDefaults = Object.freeze({ max: 100, timeWindow: '1 minute', global: false })

/**
 * The CORS allow-list as given, checked: a list of origins (or RegExps), or a comma-separated string such
 * as `process.env.CORS_ORIGINS`. Anything that would allow every origin is refused.
 * @param {string | RegExp | Array<string | RegExp> | undefined} origins
 * @returns {Array<string | RegExp>}
 */
export function parseOrigins(origins) {
  const list = (typeof origins === 'string' ? origins.split(',') : Array.isArray(origins) ? origins : [origins])
    .map((origin) => (typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : origin))
    .filter((origin) => origin !== '' && origin !== undefined && origin !== null)

  if (list.length === 0) throw new TypeError('securityPlugins: origins must list at least one origin')
  for (const origin of list) {
    if (origin instanceof RegExp) continue
    if (typeof origin !== 'string') {
      throw new TypeError('securityPlugins: each origin must be a string or a RegExp, never true or a function')
    }
    if (origin === '*' || origin === 'null') {
      throw new TypeError(`securityPlugins: origin '${origin}' would let any site call the API`)
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(origin)) {
      throw new TypeError(`securityPlugins: origin '${origin}' must be a scheme and host, e.g. https://example.com`)
    }
  }
  return list
}

/**
 * @typedef {object} SecurityOptions
 * @property {string | RegExp | Array<string | RegExp>} origins the browser origins allowed to call the API,
 *   e.g. `process.env.CORS_ORIGINS` (comma-separated). Required; `true`, `'*'` and `'null'` are refused.
 * @property {Partial<import('@fastify/cors').FastifyCorsOptions>} [cors] extra @fastify/cors options,
 *   e.g. `exposedHeaders`. `origin` cannot be set here.
 * @property {import('@fastify/helmet').FastifyHelmetOptions} [helmet] @fastify/helmet options, e.g.
 *   `{ contentSecurityPolicy: false }` for an API that serves its own HTML pages
 * @property {import('@fastify/rate-limit').RateLimitPluginOptions} [rateLimit] merged over
 *   `rateLimitDefaults`
 */

async function securityPluginsPlugin(
  app,
  { origins, cors: corsOptions = {}, helmet: helmetOptions, rateLimit: limit } = {}
) {
  const origin = parseOrigins(origins)
  if (corsOptions && 'origin' in corsOptions) {
    throw new TypeError('securityPlugins: pass origins, not cors.origin')
  }

  // CORS first: its onRequest hook then runs before rate-limit's, so a 429 still carries the CORS headers
  // a browser needs to read it (bluecopperit and gronetworking register them the other way round).
  await app.register(cors, { methods: [...corsMethods], credentials: true, ...corsOptions, origin })
  await app.register(helmet, helmetOptions ?? {})
  await app.register(rateLimit, { ...rateLimitDefaults, ...limit })
}

/**
 * CORS, helmet and rate-limit, registered in the fleet's order with the fleet's options. Register it on
 * the root instance, before the routes:
 *
 * ```js
 * await app.register(securityPlugins, { origins: process.env.CORS_ORIGINS })
 * ```
 *
 * - CORS: the origins given and nothing else, `credentials: true`, and `corsMethods`.
 * - helmet: its defaults, or the options given.
 * - rate-limit: `{ max: 100, timeWindow: '1 minute', global: false }`, so a route opts in with
 *   `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }`.
 *
 * The three plugins are the API's own dependencies (peer dependencies of the kit).
 * @param {import('fastify').FastifyInstance} app
 * @param {SecurityOptions} options
 */
export const securityPlugins = fp(securityPluginsPlugin, {
  fastify: '5.x',
  name: '@coderize/fastify-kit/security'
})
