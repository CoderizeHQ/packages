import { randomUUID } from 'node:crypto'

import fp from 'fastify-plugin'

/** The header a request id arrives in and is echoed back on. */
export const REQUEST_ID_HEADER = 'x-request-id'

// A UUID, a Cloudflare Ray ID, a trace id: letters and digits, then those or . _ : -, at most 128 characters.
// Anything else (spaces, commas from a repeated header, quotes, control characters) gets a fresh UUID, so a
// client can't put arbitrary text into every log line of its request or into the response header.
const SANE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/**
 * Whether an incoming request id is safe to keep as this request's id.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isSaneRequestId(value) {
  return typeof value === 'string' && SANE_REQUEST_ID.test(value)
}

/**
 * @typedef {object} RequestIdOptions
 * @property {string} [header] the header to honour, `x-request-id` by default
 * @property {() => string} [generate] makes a new id, `randomUUID` by default
 */

/**
 * The Fastify constructor options that set `request.id`: the incoming `x-request-id` when it is a sane value
 * (so log lines correlate with the proxy and the caller), otherwise a new UUID. Spread it into `Fastify()`:
 *
 * ```js
 * const app = Fastify({ logger, ...requestIdOptions(), trustProxy: trustCaddyHop })
 * ```
 *
 * It replaces the `requestIdHeader: 'x-request-id'` and `genReqId: () => randomUUID()` pair every API had.
 * That pair kept any incoming value unchecked; this one checks it with `isSaneRequestId` first.
 * `request.id` is then the one way to read the id: in a handler, a hook, the error handler's `body`, or
 * `request.log` lines (as `reqId`).
 * @param {RequestIdOptions} [options]
 * @returns {{ requestIdHeader: false, genReqId: (req: import('node:http').IncomingMessage) => string }}
 */
export function requestIdOptions({ header = REQUEST_ID_HEADER, generate = randomUUID } = {}) {
  const name = String(header).toLowerCase()
  return {
    // Fastify would otherwise take the header as it is, before genReqId runs.
    requestIdHeader: false,
    genReqId(req) {
      const incoming = req.headers[name]
      return isSaneRequestId(incoming) ? incoming : generate()
    }
  }
}

/**
 * Sends `request.id` back in the `x-request-id` response header on every reply (404s and errors too), so a
 * caller can quote it in a bug report. Register it at the root, once.
 *
 * ```js
 * await app.register(echoRequestId)
 * ```
 */
export const echoRequestId = fp(
  async function echoRequestId(app, { header = REQUEST_ID_HEADER } = {}) {
    app.addHook('onRequest', async (request, reply) => {
      reply.header(header, request.id)
    })
  },
  { fastify: '5.x', name: '@coderize/fastify-kit/echo-request-id' }
)
