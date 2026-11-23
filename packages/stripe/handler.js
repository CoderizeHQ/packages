/*
  The whole webhook in one call, so every app gets the same signature check, the same duplicate guard and the
  same answers instead of its own copy of each:

    1. verifyWebhook checks the signature (a list of secrets during an endpoint switch);
    2. an event type with no handler is answered 200 and logged, without touching the database;
    3. processEventOnce in claim mode records the event id in the same transaction as the handler's writes,
       so a second copy, even one arriving at the same moment, is skipped;
    4. side effects the handler queued with `after` (emails, Slack, Stripe calls) run once the transaction
       has committed, and a failing one is logged, never turned into a failed webhook.

  A handler error rejects as a StripeWebhookHandlerError (500, the original error as its cause): the framework
  answers 500, the rollback takes the event id with it, and Stripe's retry runs the handler again. The app's
  error handler (Sentry) sees it on the way out. The wrapper is what keeps it a 500: an error handler that
  answers Prisma's P2025/P2002 with 404/409, or an AppError's 4xx, would otherwise tell Stripe the event is done
  and report nothing.
*/

import { processEventOnce } from './dedupe.js'
import { prismaEventStore } from './prismaStore.js'
import { StripeWebhookError, StripeWebhookHandlerError, verifyWebhook } from './webhook.js'

/**
 * @param {object} input
 * @param {{ webhooks: { constructEvent: Function } }} input.stripe a client from createStripe
 * @param {string | Uint8Array} input.rawBody the unparsed request body
 * @param {string | string[] | null | undefined} input.signature the `Stripe-Signature` header
 * @param {string | string[]} input.secret the signing secret, or both during an endpoint switch
 * @param {number} [input.tolerance] seconds a signature stays valid
 * @param {Record<string, (event: any, context: { tx: any, after: (fn: () => unknown) => void, log: any }) => unknown>} input.handlers
 *   keyed by event type; each does its database writes through `context.tx`
 * @param {any} [input.prisma] the PrismaClient, for the default event store
 * @param {object} [input.storeOptions] passed to prismaEventStore
 * @param {import('./index.js').EventStore<any>} [input.store] a store of your own instead of `prisma`
 * @param {{ info: Function, error: Function }} [input.log] pino (`request.log`) or console
 * @returns {Promise<{ status: number, body: object }>} what the route should answer
 */
export async function handleStripeWebhook({
  stripe,
  rawBody,
  signature,
  secret,
  tolerance,
  handlers,
  prisma,
  storeOptions,
  store,
  log = console,
}) {
  if (handlers == null || typeof handlers !== 'object') {
    throw new TypeError('handleStripeWebhook: pass handlers, keyed by event type')
  }
  const eventStore = store ?? prismaEventStore(prisma, storeOptions)

  let event
  try {
    event = verifyWebhook({ stripe, rawBody, signature, secret, tolerance })
  } catch (err) {
    if (!(err instanceof StripeWebhookError)) throw err
    log[err.statusCode >= 500 ? 'error' : 'info']({ code: err.code }, `stripe webhook refused: ${err.message}`)
    return { status: err.statusCode, body: { error: err.message, code: err.code } }
  }

  const handler = Object.hasOwn(handlers, event.type) ? handlers[event.type] : null
  if (!handler) {
    // Logged rather than dropped: an event type nobody handles is the commonest gap in webhook code.
    log.info({ id: event.id, type: event.type }, 'unhandled stripe event')
    return { status: 200, body: { received: true, handled: false } }
  }

  const queued = []
  let duplicate
  try {
    ;({ duplicate } = await processEventOnce(
      event,
      (event, tx) => handler(event, { tx, after: (fn) => queued.push(fn), log }),
      eventStore,
    ))
  } catch (err) {
    throw new StripeWebhookHandlerError(event, { cause: err })
  }
  if (duplicate) {
    log.info({ id: event.id, type: event.type }, 'duplicate stripe event skipped')
    return { status: 200, body: { received: true, duplicate: true } }
  }

  // After the commit: a failed email must never roll back a payment that happened.
  for (const fn of queued) {
    try {
      await fn()
    } catch (err) {
      log.error({ err, id: event.id, type: event.type }, 'stripe webhook side effect failed')
    }
  }
  return { status: 200, body: { received: true } }
}
