import { errorFacts } from './errors.js'

/**
 * @typedef {object} HealthOptions
 * @property {string} [service] named in the liveness body, `'api'` by default
 * @property {(app: import('fastify').FastifyInstance) => Promise<unknown>} [checkDatabase] the readiness
 *   probe, e.g. `(app) => app.prisma.$queryRaw\`SELECT 1\``. It passes by resolving and fails by
 *   throwing. Leave it out for an API with no database: readiness then answers `db: 'none'`.
 */

/**
 * The fleet's two health routes, at `/health` and `/health/ready`. Register at the root:
 * `await app.register(healthRoutes, { checkDatabase })`.
 *
 * - `GET /health` (liveness) is what Docker healthchecks and Uptime Kuma poll. It never touches the
 *   database: a query on every poll keeps Neon's compute awake and defeats scale-to-zero.
 * - `GET /health/ready` (readiness) runs `checkDatabase` and answers 503 when it throws. Deploy smoke
 *   tests call it; nothing polls it on a tight schedule.
 *
 * Both are `logLevel: 'silent'`, so poll traffic stays out of the logs.
 * @param {import('fastify').FastifyInstance} app
 * @param {HealthOptions} [options]
 */
export async function healthRoutes(app, { service = 'api', checkDatabase } = {}) {
  if (checkDatabase !== undefined && typeof checkDatabase !== 'function') {
    throw new TypeError('healthRoutes: checkDatabase must be a function')
  }

  app.get('/health', { logLevel: 'silent' }, async () => ({
    status: 'ok',
    service,
    timestamp: new Date().toISOString(),
  }))

  app.get('/health/ready', { logLevel: 'silent' }, async (request, reply) => {
    if (!checkDatabase) return { status: 'ok', db: 'none', timestamp: new Date().toISOString() }
    try {
      await checkDatabase(app)
      return { status: 'ok', db: 'up', timestamp: new Date().toISOString() }
    } catch (error) {
      // logLevel 'silent' would swallow this line, so it goes to the server's logger.
      app.log.error({ error: errorFacts(error) }, 'readiness check failed')
      return reply.code(503).send({ status: 'degraded', db: 'down', timestamp: new Date().toISOString() })
    }
  })
}
