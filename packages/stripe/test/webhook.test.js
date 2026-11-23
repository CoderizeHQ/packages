import { describe, expect, it, vi } from 'vitest'

import { createStripe, routeEvent, StripeWebhookError, verifyWebhook } from '../index.js'

// Signatures come from Stripe's own generateTestHeaderString, so this exercises the real check offline.
const stripe = createStripe('sk_test_x')
const SECRET = 'whsec_test_secret'
const OLD_SECRET = 'whsec_old_endpoint'

const event = { id: 'evt_test_1', object: 'event', type: 'invoice.paid', data: { object: { id: 'in_1' } } }
// Whitespace a re-serialised object would lose, so a parsed-then-stringified body cannot pass.
const payload = JSON.stringify(event, null, 2)

const sign = (body = payload, secret = SECRET, timestamp) =>
  stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp })

function refusal(fn) {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(StripeWebhookError)
    return { code: err.code, statusCode: err.statusCode, cause: err.cause }
  }
  throw new Error('expected verifyWebhook to throw')
}

describe('verifyWebhook', () => {
  it('returns the event for a correctly signed body, as a string or a Buffer', () => {
    const signature = sign()
    expect(verifyWebhook({ stripe, rawBody: payload, signature, secret: SECRET })).toMatchObject(event)
    expect(verifyWebhook({ stripe, rawBody: Buffer.from(payload), signature, secret: SECRET })).toMatchObject(event)
  })

  it('refuses a body changed after signing', () => {
    const signature = sign()
    const tampered = payload.replace('in_1', 'in_2')
    expect(refusal(() => verifyWebhook({ stripe, rawBody: tampered, signature, secret: SECRET }))).toMatchObject({
      code: 'INVALID_SIGNATURE',
      statusCode: 400,
    })
  })

  it('refuses a body that was parsed and re-serialised, even with the right signature', () => {
    const signature = sign()
    const reserialised = JSON.stringify(JSON.parse(payload))
    expect(refusal(() => verifyWebhook({ stripe, rawBody: reserialised, signature, secret: SECRET })).code).toBe(
      'INVALID_SIGNATURE',
    )
  })

  it('refuses another secret, and keeps the Stripe error as the cause', () => {
    const result = refusal(() => verifyWebhook({ stripe, rawBody: payload, signature: sign(), secret: 'whsec_other' }))
    expect(result.code).toBe('INVALID_SIGNATURE')
    expect(result.cause?.type).toBe('StripeSignatureVerificationError')
  })

  it('refuses a signature older than the tolerance', () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600
    const signature = sign(payload, SECRET, anHourAgo)
    expect(refusal(() => verifyWebhook({ stripe, rawBody: payload, signature, secret: SECRET })).code).toBe(
      'INVALID_SIGNATURE',
    )
    expect(verifyWebhook({ stripe, rawBody: payload, signature, secret: SECRET, tolerance: 7200 }).id).toBe(
      'evt_test_1',
    )
  })

  it('accepts either secret while an endpoint is being replaced', () => {
    const secret = [SECRET, OLD_SECRET]
    expect(verifyWebhook({ stripe, rawBody: payload, signature: sign(payload, OLD_SECRET), secret }).id).toBe(
      'evt_test_1',
    )
    expect(verifyWebhook({ stripe, rawBody: payload, signature: sign(payload, SECRET), secret }).id).toBe('evt_test_1')
  })

  it('answers 400 when the Stripe-Signature header is missing', () => {
    for (const signature of [undefined, null, '', []]) {
      expect(refusal(() => verifyWebhook({ stripe, rawBody: payload, signature, secret: SECRET }))).toMatchObject({
        code: 'MISSING_SIGNATURE',
        statusCode: 400,
      })
    }
  })

  it('answers 500 for a parsed body, so Stripe keeps retrying until the raw-body parser is fixed', () => {
    for (const rawBody of [event, undefined, null]) {
      expect(refusal(() => verifyWebhook({ stripe, rawBody, signature: sign(), secret: SECRET }))).toMatchObject({
        code: 'RAW_BODY_REQUIRED',
        statusCode: 500,
      })
    }
  })

  it('answers 500 when the client or the secret is missing', () => {
    for (const input of [
      { stripe, secret: undefined },
      { stripe, secret: '' },
      { stripe, secret: [] },
      { stripe: undefined, secret: SECRET },
    ]) {
      expect(refusal(() => verifyWebhook({ ...input, rawBody: payload, signature: sign() }))).toMatchObject({
        code: 'WEBHOOK_NOT_CONFIGURED',
        statusCode: 500,
      })
    }
  })

  it('passes on an error that is not a signature failure', () => {
    const broken = {
      webhooks: {
        constructEvent: () => {
          throw new TypeError('crypto unavailable')
        },
      },
    }
    expect(() => verifyWebhook({ stripe: broken, rawBody: payload, signature: sign(), secret: SECRET })).toThrow(
      TypeError,
    )
  })
})

describe('routeEvent', () => {
  it('calls the handler for the event type with the event and context, and resolves true', async () => {
    const paid = vi.fn()
    const other = vi.fn()
    const context = { tx: 'tx' }
    expect(await routeEvent(event, { 'invoice.paid': paid, 'charge.refunded': other }, context)).toBe(true)
    expect(paid).toHaveBeenCalledWith(event, context)
    expect(other).not.toHaveBeenCalled()
  })

  it('resolves false for a type nobody handles, so the caller can log it', async () => {
    expect(await routeEvent({ type: 'charge.refunded' }, { 'invoice.paid': vi.fn() })).toBe(false)
    expect(await routeEvent({ type: 'constructor' }, {})).toBe(false)
    expect(await routeEvent({}, {})).toBe(false)
  })

  it('waits for the handler and passes its failure on', async () => {
    await expect(
      routeEvent(event, {
        'invoice.paid': async () => {
          throw new Error('db down')
        },
      }),
    ).rejects.toThrow('db down')
  })
})
