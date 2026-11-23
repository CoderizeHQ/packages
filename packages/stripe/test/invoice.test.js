// Ported from xceptionalheroes-org-mono, apps/api/scripts/verify-stripe-invoice-fields.mjs, plus
// gronetworking-com-mono's invoiceChargeId (apps/api/src/module/webhook/webhook.service.js).
import { describe, expect, it, vi } from 'vitest'

import { invoiceChargeId, invoicePaymentIntentId, invoicePeriodStart, invoiceSubscriptionId } from '../index.js'

// A renewal invoice in the current shape, as a webhook delivers it (trimmed): basil's, unchanged through the
// pin, 2026-10-28.endive (checked against stripe 23.1.0's types). What is absent matters: no top-level
// `subscription`, `payment_intent` or `charge`, and no `payments`.
const renewal = {
  id: 'in_renewal',
  billing_reason: 'subscription_cycle',
  amount_paid: 2606,
  parent: {
    type: 'subscription_details',
    subscription_details: { subscription: 'sub_renewal', metadata: {} }
  },
  lines: { data: [{ period: { start: 1788220800, end: 1790812800 } }] }
}

// The same invoice in the pre-basil shape an older endpoint sends.
const legacyRenewal = {
  id: 'in_renewal',
  subscription: 'sub_legacy',
  payment_intent: 'pi_legacy',
  charge: 'ch_legacy',
  lines: { data: [{ period: { start: 1788220800, end: 1790812800 } }] }
}

const paidThroughIntent = (intent, status = 'paid') => ({
  status,
  payment: { type: 'payment_intent', payment_intent: intent }
})

/** A client whose invoices.retrieve answers with `full` and records the call. */
function fakeStripe(full) {
  return { invoices: { retrieve: vi.fn(async () => full) } }
}

describe('invoiceSubscriptionId', () => {
  it('reads the subscription from parent.subscription_details', () => {
    expect(invoiceSubscriptionId(renewal)).toBe('sub_renewal')
  })

  it('reads an expanded subscription object', () => {
    const expanded = { parent: { subscription_details: { subscription: { id: 'sub_expanded' } } } }
    expect(invoiceSubscriptionId(expanded)).toBe('sub_expanded')
  })

  it('still reads the pre-basil top-level field', () => {
    expect(invoiceSubscriptionId(legacyRenewal)).toBe('sub_legacy')
    expect(invoiceSubscriptionId({ subscription: { id: 'sub_obj' } })).toBe('sub_obj')
  })

  it('returns null for a one-off invoice or none at all', () => {
    expect(invoiceSubscriptionId({ parent: null })).toBeNull()
    expect(invoiceSubscriptionId({ parent: { type: 'quote_details', quote_details: {} } })).toBeNull()
    expect(invoiceSubscriptionId(undefined)).toBeNull()
  })
})

describe('invoicePeriodStart', () => {
  it('is the start of the paid term, from the first line', () => {
    expect(invoicePeriodStart(renewal)?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(invoicePeriodStart(legacyRenewal)?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('returns null when there are no lines', () => {
    expect(invoicePeriodStart({ lines: { data: [] } })).toBeNull()
    expect(invoicePeriodStart(null)).toBeNull()
  })
})

describe('invoicePaymentIntentId', () => {
  it('fetches the payment intent a webhook payload leaves out, expanding payments once', async () => {
    const stripe = fakeStripe({ ...renewal, payments: { data: [paidThroughIntent('pi_renewal')] } })
    expect(await invoicePaymentIntentId(stripe, renewal)).toBe('pi_renewal')
    expect(stripe.invoices.retrieve).toHaveBeenCalledTimes(1)
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_renewal', { expand: ['payments'] })
  })

  it('uses the payload when it already has the payment, without calling Stripe', async () => {
    const stripe = fakeStripe(null)
    const withPayments = { ...renewal, payments: { data: [paidThroughIntent('pi_renewal')] } }
    expect(await invoicePaymentIntentId(stripe, withPayments)).toBe('pi_renewal')
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled()
  })

  it('does not fetch again when the payload has a payments list with no intent in it', async () => {
    const stripe = fakeStripe(null)
    const outOfBand = { id: 'in_1', payments: { data: [{ status: 'paid', payment: { type: 'out_of_band_payment' } }] } }
    expect(await invoicePaymentIntentId(stripe, outOfBand)).toBeNull()
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled()
  })

  it('still reads the pre-basil payment_intent, as an id or an expanded object', async () => {
    expect(await invoicePaymentIntentId(fakeStripe(null), legacyRenewal)).toBe('pi_legacy')
    expect(await invoicePaymentIntentId(null, { payment_intent: { id: 'pi_obj' } })).toBe('pi_obj')
  })

  it('reads an expanded payment intent inside payments', async () => {
    const invoice = { payments: { data: [{ payment: { payment_intent: { id: 'pi_obj' } } }] } }
    expect(await invoicePaymentIntentId(null, invoice)).toBe('pi_obj')
  })

  it('skips a paid entry recorded through a Payment Record, which names no intent', async () => {
    const recorded = { status: 'paid', payment: { type: 'payment_record', payment_record: 'pr_1' } }
    expect(await invoicePaymentIntentId(null, { payments: { data: [recorded] } })).toBeNull()
    expect(await invoicePaymentIntentId(null, { payments: { data: [recorded, paidThroughIntent('pi_paid')] } })).toBe(
      'pi_paid'
    )
  })

  it('picks the payment that paid over an earlier attempt that did not', async () => {
    const retried = { payments: { data: [paidThroughIntent('pi_declined', 'canceled'), paidThroughIntent('pi_paid')] } }
    expect(await invoicePaymentIntentId(null, retried)).toBe('pi_paid')
  })

  it('returns null with no client and nothing in the payload', async () => {
    expect(await invoicePaymentIntentId(null, renewal)).toBeNull()
  })

  it('rejects when Stripe cannot be reached, so the webhook is retried', async () => {
    const stripe = { invoices: { retrieve: vi.fn().mockRejectedValue(new Error('network')) } }
    await expect(invoicePaymentIntentId(stripe, renewal)).rejects.toThrow('network')
  })
})

describe('invoiceChargeId', () => {
  it('still reads the pre-basil top-level charge, as an id or an expanded object', () => {
    expect(invoiceChargeId(legacyRenewal)).toBe('ch_legacy')
    expect(invoiceChargeId({ charge: { id: 'ch_obj' } })).toBe('ch_obj')
  })

  it('reads a charge payment from the payments list', () => {
    const invoice = { payments: { data: [{ status: 'paid', payment: { type: 'charge', charge: 'ch_paid' } }] } }
    expect(invoiceChargeId(invoice)).toBe('ch_paid')
  })

  it("reads an expanded payment intent's latest charge", () => {
    const invoice = {
      payments: {
        data: [
          {
            status: 'paid',
            payment: { type: 'payment_intent', payment_intent: { id: 'pi_1', latest_charge: 'ch_latest' } }
          }
        ]
      }
    }
    expect(invoiceChargeId(invoice)).toBe('ch_latest')
    invoice.payments.data[0].payment.payment_intent.latest_charge = { id: 'ch_expanded' }
    expect(invoiceChargeId(invoice)).toBe('ch_expanded')
  })

  it('picks the payment that paid over a failed attempt', () => {
    const invoice = {
      payments: {
        data: [
          { status: 'canceled', payment: { type: 'charge', charge: 'ch_failed' } },
          { status: 'paid', payment: { type: 'charge', charge: 'ch_paid' } }
        ]
      }
    }
    expect(invoiceChargeId(invoice)).toBe('ch_paid')
  })

  it('returns null when Stripe does not say', () => {
    // A webhook payload since basil: no payments list.
    expect(invoiceChargeId(renewal)).toBeNull()
    // An intent named only by id: its charge is not in the payload.
    expect(invoiceChargeId({ payments: { data: [paidThroughIntent('pi_1')] } })).toBeNull()
    expect(invoiceChargeId(undefined)).toBeNull()
  })
})
