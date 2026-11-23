import { errorFacts } from './errors.js'

/**
 * @typedef {object} StartServerOptions
 * @property {number} [port] `PORT` from the environment, else 3000
 * @property {string} [host] `HOST` from the environment, else `0.0.0.0` (reachable from Caddy on the
 *   Docker network)
 * @property {number} [shutdownTimeoutMs] how long `app.close()` may take before the process exits anyway,
 *   10 seconds by default (Docker sends SIGKILL after 10 seconds unless compose sets `stop_grace_period`)
 * @property {NodeJS.Signals[]} [signals] `['SIGTERM', 'SIGINT']` by default
 */

/**
 * The entry point's job, so `server.js` is three lines: listen on `PORT` and `HOST`, and on SIGTERM or
 * SIGINT close the app (its `onClose` hooks stop jobs and disconnect Prisma, and in-flight requests
 * finish) before exiting 0. A second signal, or a close that outlasts `shutdownTimeoutMs`, exits 1 at
 * once. A failed listen is logged and exits 1.
 *
 * Six fleet APIs had no SIGTERM handler, so every deploy cut off in-flight requests and cron runs, and
 * collegecostscompared exited without closing the app.
 * @param {import('fastify').FastifyInstance} app built by `buildApp()`, not yet listening
 * @param {StartServerOptions} [options]
 * @returns {Promise<string>} the address the server listens on
 */
export async function startServer(
  app,
  {
    port = portFromEnv(),
    host = process.env.HOST || '0.0.0.0',
    shutdownTimeoutMs = 10_000,
    signals = ['SIGTERM', 'SIGINT']
  } = {}
) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError(`startServer: port must be an integer from 0 to 65535, got ${port}`)
  }

  let closing = false
  const onSignal = (signal) => {
    if (closing) {
      app.log.warn({ signal }, 'second signal while shutting down: exiting now')
      process.exit(1)
      return
    }
    closing = true
    app.log.info({ signal }, 'shutting down')
    const timer = setTimeout(() => {
      app.log.error({ timeoutMs: shutdownTimeoutMs }, 'shutdown timed out: exiting')
      process.exit(1)
    }, shutdownTimeoutMs)
    timer.unref()
    app.close().then(
      () => {
        clearTimeout(timer)
        process.exit(0)
      },
      (error) => {
        clearTimeout(timer)
        app.log.error({ error: errorFacts(error) }, 'shutdown failed')
        process.exit(1)
      }
    )
  }

  const removeListeners = () => {
    for (const signal of signals) process.off(signal, onSignal)
  }
  for (const signal of signals) process.on(signal, onSignal)
  try {
    // However the app is closed, it leaves no listener behind.
    app.addHook('onClose', async () => removeListeners())
  } catch {
    // An app that was already readied takes no new hooks; a signal still closes it.
  }

  try {
    return await app.listen({ port, host })
  } catch (error) {
    app.log.error({ error: errorFacts(error) }, 'failed to start')
    removeListeners()
    process.exit(1)
  }
}

function portFromEnv() {
  const raw = process.env.PORT
  if (raw === undefined || raw.trim() === '') return 3000
  return Number(raw)
}
