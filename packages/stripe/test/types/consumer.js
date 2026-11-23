// Type-checked by `tsc -p test/types` in `pnpm test` (checkJs), as an app would import the package: a TypeScript app
// (a Next.js route) or JavaScript checked against the package's .d.ts files. Nothing here runs.
import {
  checkoutShipping,
  checkStripeVersion,
  createStripe,
  handleStripeWebhook,
  invoiceChargeId,
  invoicePaymentIntentId,
  invoicePeriodStart,
  invoiceSubscriptionId,
  prismaEventStore,
  processEventOnce,
  REVIEWED_SDK_DEFAULTS,
  routeEvent,
  STRIPE_API_VERSION,
  StripeWebhookError,
  StripeWebhookHandlerError,
  subscriptionPeriod,
  verifyWebhook,
} from '@coderizehq/stripe'
import { cardFeeCents, grossUpForCardFee, US_CARD_FEE } from '@coderizehq/stripe/fees'

/** @import Stripe from 'stripe' */
/** @import { CardFee, GrossUp } from '@coderizehq/stripe/fees' */

// The browser-safe subpath, as a checkout page shows the fee the API will charge.
/** @type {number} */
const fee = cardFeeCents(5000)
/** @type {GrossUp} */
const { netCents, feeCents, totalCents } = grossUpForCardFee(5000, { rate: 0.022 })
/** @type {Readonly<CardFee>} */
const usCard = US_CARD_FEE
// @ts-expect-error the amount is integer cents, never a dollar string
cardFeeCents('50.00')
export const shown = [fee, netCents, feeCents, totalCents, usCard.rate]

/** @type {'2026-10-28.endive'} */
const pinned = STRIPE_API_VERSION
/** @type {string[]} */
const reviewed = REVIEWED_SDK_DEFAULTS.map((r) => `${r.version} ${r.decision}`)

/** @type {Stripe} */
const stripe = createStripe('sk_test_x', { timeout: 20_000, maxNetworkRetries: 3 })
createStripe('sk_test_x', { apiVersion: '2026-10-28.endive' })
// @ts-expect-error another API version is refused, the 1.x pin included
createStripe('sk_test_x', { apiVersion: '2026-08-26.dahlia' })

const guard = checkStripeVersion()
/** @type {string[]} */
const failed = guard.checks.filter((c) => !c.ok).map((c) => c.id)

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function POST(request) {
  /** @type {Stripe.Event} */
  let event
  try {
    event = verifyWebhook({
      stripe,
      rawBody: await request.text(),
      signature: request.headers.get('stripe-signature'),
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    })
  } catch (err) {
    if (err instanceof StripeWebhookError) return new Response(err.code, { status: err.statusCode })
    throw err
  }

  const { duplicate } = await processEventOnce(
    event,
    async (e, /** @type {{ log: string[] } | undefined} */ tx) => {
      const handled = await routeEvent(
        e,
        {
          'invoice.paid': async (paid) => {
            /** @type {Stripe.Invoice} */
            const invoice = paid.data.object
            /** @type {string | null} */
            const sub = invoiceSubscriptionId(invoice)
            /** @type {Date | null} */
            const start = invoicePeriodStart(invoice)
            /** @type {string | null} */
            const intent = await invoicePaymentIntentId(stripe, invoice)
            /** @type {string | null} */
            const charge = invoiceChargeId(invoice)
            tx?.log.push(`${sub} ${start?.toISOString()} ${intent} ${charge}`)
          },
          'customer.subscription.updated': (updated) => {
            const { start, end } = subscriptionPeriod(updated.data.object)
            tx?.log.push(`${start?.getTime()} ${end?.getTime()}`)
          },
          'checkout.session.completed': (completed) => {
            const shipTo = checkoutShipping(completed.data.object)
            tx?.log.push(shipTo?.address?.postal_code ?? '')
          },
        },
        tx,
      )
      if (!handled) console.log(`unhandled ${e.type}`)
    },
    {
      record: async () => true,
      transaction: async (work) => work({ log: [] }),
    },
  )

  return Response.json({ received: true, duplicate, pinned, reviewed, failed })
}

// The one-call webhook, as an app's webhook route would use it.
/** @type {{ $transaction: Function, stripeEvent: object, payment: { create(args: object): Promise<{ id: string }> } }} */
const prisma = { $transaction: () => {}, stripeEvent: {}, payment: { create: async () => ({ id: 'pay_1' }) } }

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handled(request) {
  const { status, body } = await handleStripeWebhook({
    stripe,
    rawBody: await request.text(),
    signature: request.headers.get('stripe-signature'),
    secret: [process.env.STRIPE_WEBHOOK_SECRET ?? '', process.env.STRIPE_WEBHOOK_SECRET_NEXT ?? ''],
    prisma,
    storeOptions: { model: 'stripeEvent' },
    handlers: {
      'invoice.paid': async (event, { tx, after, log }) => {
        /** @type {Stripe.Invoice} */
        const invoice = event.data.object
        const payment = await /** @type {typeof prisma} */ (tx).payment.create({ data: { invoice: invoice.id } })
        after(() => log.info({ id: payment.id }, 'receipt'))
      },
      'checkout.session.completed': (event) => {
        /** @type {Stripe.Checkout.Session} */
        const session = event.data.object
        return session.id
      },
    },
  })
  const store = prismaEventStore(prisma, { idField: 'id' })
  await store.transaction(async () => store.record('evt_1', { id: 'evt_1' }, undefined))
  return Response.json(body, { status })
}

// A failed handler rejects with a 500 that keeps the original error, as an app's own catch would read it.
/**
 * @param {unknown} err
 * @returns {string | null}
 */
export function describeFailure(err) {
  if (!(err instanceof StripeWebhookHandlerError)) return null
  /** @type {500} */
  const status = err.statusCode
  /** @type {'HANDLER_FAILED'} */
  const code = err.code
  return `${status} ${code} ${err.eventType ?? ''} ${err.eventId ?? ''} ${String(err.cause)}`
}
