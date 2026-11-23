import Fastify from 'fastify'

/**
 * A Fastify instance whose log lines are kept in `lines` (parsed) and `raw` (as written), so a test can
 * assert what was, and was not, logged.
 * @param {import('fastify').FastifyServerOptions} [options]
 * @param {object} [loggerOptions]
 */
export function appWithLogs(options = {}, loggerOptions = {}) {
  const raw = []
  const app = Fastify({
    ...options,
    logger: { level: 'trace', ...loggerOptions, stream: { write: (line) => raw.push(line) } },
  })
  return {
    app,
    raw,
    get lines() {
      return raw.map((line) => JSON.parse(line))
    },
  }
}

/** A stand-in for Prisma's error classes: the handler matches on name, code and meta, as Prisma's do. */
export function prismaError(name, message, props = {}) {
  const error = new Error(message)
  error.name = name
  Object.assign(error, props)
  return error
}
