/*
  Webhook basics that work the same in a Fastify route and a Next.js route handler.

  Why the raw body: Stripe signs the exact bytes it sent. Parsing the JSON and serialising it again
  changes whitespace, key order and number formatting, so the signature no longer matches, and a check
  run on a re-serialised object proves nothing anyway. Fastify needs a buffer content-type parser scoped
  to the webhook route; Next.js reads `await request.text()`.
*/

/** Why a webhook was refused. `statusCode` is what the route should answer. */
export class StripeWebhookError extends Error {
  /**
   * @param {string} message
   * @param {'WEBHOOK_NOT_CONFIGURED' | 'RAW_BODY_REQUIRED' | 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE'} code
   * @param {number} statusCode
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, code, statusCode, options) {
    super(message, options)
    this.name = 'StripeWebhookError'
    this.code = code
    this.statusCode = statusCode
  }
}

/**
 * A verified event whose handling failed: a handler threw, or the database refused the event's
 * transaction. It is always a 500 whatever the cause was, so a P2002 or P2025 (which an app's error
 * handler may answer 409 or 404) or an `AppError` with a 4xx status never tells Stripe the event is
 * finished. Stripe retries a 5xx and stops on a 4xx, and nothing would report a 4xx. The original
 * error is the `cause`.
 *
 * It is not a StripeWebhookError on purpose: a route that catches those to send their status would
 * otherwise send this one too, and nothing would report it.
 */
export class StripeWebhookHandlerError extends Error {
  /**
   * @param {{ id?: string, type?: string }} event
   * @param {{ cause?: unknown }} [options]
   */
  constructor(event, options) {
    super(`Stripe webhook handler failed for ${event?.type}`, options)
    this.name = 'StripeWebhookHandlerError'
    this.code = 'HANDLER_FAILED'
    this.statusCode = 500
    this.eventId = event?.id
    this.eventType = event?.type
  }
}

/**
 * Verifies a webhook's signature and returns the event Stripe sent, or throws a StripeWebhookError:
 *
 * - `WEBHOOK_NOT_CONFIGURED` (500): no client or no signing secret. Our fault, so Stripe should retry.
 * - `RAW_BODY_REQUIRED` (500): the body arrived parsed. The route is missing its raw-body parser; a 500
 *   keeps Stripe retrying until that is fixed, instead of dropping events.
 * - `MISSING_SIGNATURE` (400): no `Stripe-Signature` header.
 * - `INVALID_SIGNATURE` (400): the signature does not match, or the timestamp is outside the tolerance.
 *
 * `secret` may be a list while an endpoint is being replaced: the old and new endpoints sign with
 * different secrets, and an event passes when it matches either.
 * @param {object} input
 * @param {{ webhooks: { constructEvent: Function } }} input.stripe a client from createStripe
 * @param {string | Uint8Array} input.rawBody the unparsed request body (a Buffer is a Uint8Array)
 * @param {string | string[] | Uint8Array | null | undefined} input.signature the `Stripe-Signature` header
 * @param {string | string[]} input.secret `STRIPE_WEBHOOK_SECRET` (whsec_...)
 * @param {number} [input.tolerance] seconds a signature stays valid, Stripe's 300 by default
 * @returns {import('stripe').Stripe.Event}
 */
export function verifyWebhook({ stripe, rawBody, signature, secret, tolerance } = {}) {
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter((s) => typeof s === 'string' && s !== '')
  if (typeof stripe?.webhooks?.constructEvent !== 'function' || secrets.length === 0) {
    throw new StripeWebhookError(
      'Stripe webhook is not configured: pass a Stripe client and the signing secret',
      'WEBHOOK_NOT_CONFIGURED',
      500,
    )
  }

  if (signature == null || signature === '' || (Array.isArray(signature) && signature.length === 0)) {
    throw new StripeWebhookError('Missing Stripe-Signature header', 'MISSING_SIGNATURE', 400)
  }

  if (typeof rawBody !== 'string' && !(rawBody instanceof Uint8Array)) {
    throw new StripeWebhookError(
      'Stripe webhook needs the raw request body (a string or Buffer), not parsed JSON',
      'RAW_BODY_REQUIRED',
      500,
    )
  }

  let lastError
  for (const s of secrets) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, s, tolerance)
    } catch (err) {
      if (err?.type !== 'StripeSignatureVerificationError') throw err
      lastError = err
    }
  }
  throw new StripeWebhookError('Invalid Stripe webhook signature', 'INVALID_SIGNATURE', 400, { cause: lastError })
}

/**
 * Calls the handler for `event.type`, passing the event and `context` (a transaction, a logger, whatever
 * the handlers need). Resolves `true` when a handler ran and `false` when none matched: log those, since
 * an event type nobody handles (a `charge.refunded`, say) is the commonest gap in webhook code.
 * @template C
 * @param {{ type: string }} event
 * @param {Record<string, (event: any, context: C) => unknown>} handlers keyed by event type
 * @param {C} [context]
 * @returns {Promise<boolean>}
 */
export async function routeEvent(event, handlers, context) {
  const type = event?.type
  if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) return false
  await handlers[type](event, context)
  return true
}
