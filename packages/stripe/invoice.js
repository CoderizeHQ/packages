/*
  Where a Stripe invoice keeps the ids a webhook needs. Since API version 2025-03-31.basil an invoice no
  longer carries `subscription`, `payment_intent` or `charge` at the top level: the subscription moved to
  `parent.subscription_details.subscription`, and payments moved to the `payments` list, which a webhook
  payload does not include (retrieve the invoice with `expand: ['payments']` to get it).

  A webhook payload is rendered in its endpoint's API version, not the client's pin, so either shape can
  arrive. Each reader takes the new shape first and the old one second, and returns null when Stripe
  doesn't say.

  Reading only the old fields fails quietly, and fleet apps have lost real money to it: paid renewals
  skipped as "untracked" for weeks, revenue shares never recorded.
*/

/**
 * The subscription that generated an invoice, or null for a one-off invoice.
 * @param {object | null | undefined} invoice a Stripe Invoice, in either shape
 * @returns {string | null}
 */
export function invoiceSubscriptionId(invoice) {
  return idOf(invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription)
}

/**
 * The start of the billing period an invoice pays for: its first line's period, not the invoice's own
 * `period_start`, which is the invoice's creation window and can equal its end on a renewal.
 * @param {object | null | undefined} invoice
 * @returns {Date | null}
 */
export function invoicePeriodStart(invoice) {
  const start = invoice?.lines?.data?.[0]?.period?.start
  return Number.isFinite(start) ? new Date(start * 1000) : null
}

/**
 * The PaymentIntent that paid an invoice. Reads the payload first, and asks Stripe (one `invoices.retrieve`
 * with `payments` expanded) only when the payload doesn't carry it, the normal case for a webhook since
 * basil. Pass `null` for `stripe` to read the payload only. A failed retrieve rejects, so the webhook is
 * retried rather than guessing.
 * @param {{ invoices: { retrieve: Function } } | null | undefined} stripe a client from createStripe
 * @param {object | null | undefined} invoice
 * @returns {Promise<string | null>}
 */
export async function invoicePaymentIntentId(stripe, invoice) {
  const fromPayload = paymentIntentIn(invoice)
  if (fromPayload || !stripe || !invoice?.id || invoice.payments) return fromPayload
  const full = await stripe.invoices.retrieve(invoice.id, { expand: ['payments'] })
  return paymentIntentIn(full)
}

/**
 * The Charge that paid an invoice, from the payload only. Since basil that means the `payments` list, so
 * pass an invoice retrieved with `expand: ['payments']`; a payment made through a PaymentIntent names its
 * charge only when that intent is expanded too (`expand: ['payments.data.payment.payment_intent']`).
 * @param {object | null | undefined} invoice
 * @returns {string | null}
 */
export function invoiceChargeId(invoice) {
  const direct = idOf(invoice?.charge)
  if (direct) return direct
  for (const payment of paidFirst(invoice)) {
    const charge = idOf(payment?.payment?.charge) ?? idOf(payment?.payment?.payment_intent?.latest_charge)
    if (charge) return charge
  }
  return null
}

function paymentIntentIn(invoice) {
  const direct = idOf(invoice?.payment_intent)
  if (direct) return direct
  for (const payment of paidFirst(invoice)) {
    const intent = idOf(payment?.payment?.payment_intent)
    if (intent) return intent
  }
  return null
}

// The payments list can also hold attempts that never went through. The one that paid wins (a refund sent
// to a declined attempt's id fails); the rest follow for older payloads whose entries carry no status.
function paidFirst(invoice) {
  const payments = invoice?.payments?.data ?? []
  return [...payments.filter((p) => p?.status === 'paid'), ...payments]
}

// A Stripe reference is an id string, or the object itself when it was expanded.
function idOf(ref) {
  if (typeof ref === 'string') return ref || null
  return typeof ref?.id === 'string' ? ref.id : null
}
