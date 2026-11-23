// Type-checked by `tsc -p test/types` in `pnpm test`, as a TypeScript app would import the package
// (allsteeloffroad-com-web, the coderize-dev-mono portal). Nothing here runs.
import type Stripe from 'stripe'

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
  verifyWebhook
} from '@coderize/stripe'
import { type CardFee, cardFeeCents, type GrossUp, grossUpForCardFee, US_CARD_FEE } from '@coderize/stripe/fees'

// The browser-safe subpath, as a checkout page shows the fee the API will charge.
const fee: number = cardFeeCents(5000)
const { netCents, feeCents, totalCents }: GrossUp = grossUpForCardFee(5000, { rate: 0.022 })
const usCard: Readonly<CardFee> = US_CARD_FEE
// @ts-expect-error the amount is integer cents, never a dollar string
cardFeeCents('50.00')
export const shown = [fee, netCents, feeCents, totalCents, usCard.rate]

const pinned: '2026-10-28.endive' = STRIPE_API_VERSION
const reviewed: string[] = REVIEWED_SDK_DEFAULTS.map((r) => `${r.version} ${r.decision}`)

const stripe: Stripe = createStripe('sk_test_x', { timeout: 20_000, maxNetworkRetries: 3 })
createStripe('sk_test_x', { apiVersion: '2026-10-28.endive' })
// @ts-expect-error another API version is refused, the 1.x pin included
createStripe('sk_test_x', { apiVersion: '2026-08-26.dahlia' })

const guard = checkStripeVersion()
const failed: string[] = guard.checks.filter((c) => !c.ok).map((c) => c.id)

export async function POST(request: Request): Promise<Response> {
  let event: Stripe.Event
  try {
    event = verifyWebhook({
      stripe,
      rawBody: await request.text(),
      signature: request.headers.get('stripe-signature'),
      secret: process.env.STRIPE_WEBHOOK_SECRET
    })
  } catch (err) {
    if (err instanceof StripeWebhookError) return new Response(err.code, { status: err.statusCode })
    throw err
  }

  const { duplicate } = await processEventOnce(
    event,
    async (e, tx: { log: string[] } | undefined) => {
      const handled = await routeEvent(
        e,
        {
          'invoice.paid': async (paid) => {
            const invoice: Stripe.Invoice = paid.data.object
            const sub: string | null = invoiceSubscriptionId(invoice)
            const start: Date | null = invoicePeriodStart(invoice)
            const intent: string | null = await invoicePaymentIntentId(stripe, invoice)
            const charge: string | null = invoiceChargeId(invoice)
            tx?.log.push(`${sub} ${start?.toISOString()} ${intent} ${charge}`)
          },
          'customer.subscription.updated': (updated) => {
            const { start, end } = subscriptionPeriod(updated.data.object)
            tx?.log.push(`${start?.getTime()} ${end?.getTime()}`)
          },
          'checkout.session.completed': (completed) => {
            const shipTo = checkoutShipping(completed.data.object)
            tx?.log.push(shipTo?.address?.postal_code ?? '')
          }
        },
        tx
      )
      if (!handled) console.log(`unhandled ${e.type}`)
    },
    {
      record: async () => true,
      transaction: async (work) => work({ log: [] })
    }
  )

  return Response.json({ received: true, duplicate, pinned, reviewed, failed })
}

// The one-call webhook, as allsteeloffroad-com-web's route would use it.
declare const prisma: {
  $transaction: Function
  stripeEvent: object
  payment: { create(args: object): Promise<{ id: string }> }
}

export async function handled(request: Request): Promise<Response> {
  const { status, body } = await handleStripeWebhook({
    stripe,
    rawBody: await request.text(),
    signature: request.headers.get('stripe-signature'),
    secret: [process.env.STRIPE_WEBHOOK_SECRET ?? '', process.env.STRIPE_WEBHOOK_SECRET_NEXT ?? ''],
    prisma,
    storeOptions: { model: 'stripeEvent' },
    handlers: {
      'invoice.paid': async (event, { tx, after, log }) => {
        const invoice: Stripe.Invoice = event.data.object
        const payment = await (tx as typeof prisma).payment.create({ data: { invoice: invoice.id } })
        after(() => log.info({ id: payment.id }, 'receipt'))
      },
      'checkout.session.completed': (event) => {
        const session: Stripe.Checkout.Session = event.data.object
        return session.id
      }
    }
  })
  const store = prismaEventStore(prisma, { idField: 'id' })
  await store.transaction(async () => store.record('evt_1', { id: 'evt_1' }, undefined))
  return Response.json(body, { status })
}

// A failed handler rejects with a 500 that keeps the original error, as an app's own catch would read it.
export function describeFailure(err: unknown): string | null {
  if (!(err instanceof StripeWebhookHandlerError)) return null
  const status: 500 = err.statusCode
  const code: 'HANDLER_FAILED' = err.code
  return `${status} ${code} ${err.eventType ?? ''} ${err.eventId ?? ''} ${String(err.cause)}`
}
