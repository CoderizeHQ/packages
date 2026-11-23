import { describe, expect, it, vi } from 'vitest'

import { createStripe, handleStripeWebhook, StripeWebhookHandlerError } from '../index.js'

// Signed with Stripe's own generateTestHeaderString, so the real signature check runs offline.
const stripe = createStripe('sk_test_x')
const SECRET = 'whsec_test_secret'
const OLD_SECRET = 'whsec_old_endpoint'

const event = { id: 'evt_test_1', object: 'event', type: 'invoice.paid', data: { object: { id: 'in_1' } } }
const payload = JSON.stringify(event)
const sign = (body = payload, secret = SECRET) => stripe.webhooks.generateTestHeaderString({ payload: body, secret })

const quiet = { info: vi.fn(), error: vi.fn() }

/**
 * A database with a unique index on the event id, the way Postgres behaves: a claim holds the id from the
 * insert until the transaction ends, a second insert of it fails with P2002, and a rollback releases it.
 * `rows` is what the handlers committed.
 */
function fakePrisma() {
  const claimed = new Set()
  const rows = []
  const prisma = {
    rows,
    claimed,
    stripeEvent: {
      findUnique: vi.fn(async () => null), // as if both copies checked before either committed
      create: vi.fn()
    },
    $transaction: vi.fn(async (work) => {
      const tx = { mine: [], rows: [] }
      tx.stripeEvent = {
        create: async ({ data }) => {
          await new Promise((resolve) => setImmediate(resolve))
          if (claimed.has(data.id)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
          claimed.add(data.id)
          tx.mine.push(data.id)
          return data
        }
      }
      try {
        const result = await work(tx)
        rows.push(...tx.rows)
        return result
      } catch (err) {
        tx.mine.forEach((id) => claimed.delete(id))
        throw err
      }
    })
  }
  return prisma
}

const handle = (input) =>
  handleStripeWebhook({ stripe, rawBody: payload, signature: sign(), secret: SECRET, log: quiet, ...input })

describe('handleStripeWebhook', () => {
  it('runs the handler once in the transaction, then the queued side effects', async () => {
    const prisma = fakePrisma()
    const order = []
    const handlers = {
      'invoice.paid': async (e, { tx, after }) => {
        tx.rows.push(e.data.object.id)
        after(() => order.push('email'))
        order.push('write')
      }
    }
    await expect(handle({ prisma, handlers })).resolves.toEqual({ status: 200, body: { received: true } })
    expect(prisma.rows).toEqual(['in_1'])
    expect(order).toEqual(['write', 'email'])
  })

  it('saves one payment when two copies of an event arrive at the same moment', async () => {
    const prisma = fakePrisma()
    const handlers = { 'invoice.paid': async (e, { tx }) => tx.rows.push(e.data.object.id) }
    const results = await Promise.all([
      handle({ prisma, handlers }),
      handle({ prisma, handlers, signature: sign(payload, OLD_SECRET), secret: [OLD_SECRET, SECRET] })
    ])
    expect(prisma.rows).toEqual(['in_1'])
    expect(results.map((r) => r.status)).toEqual([200, 200])
    expect(results.filter((r) => r.body.duplicate)).toHaveLength(1)
  })

  it('rejects when a handler fails, releasing the event id so the retry runs it again', async () => {
    const prisma = fakePrisma()
    const down = new Error('database down')
    const failing = { 'invoice.paid': async () => Promise.reject(down) }
    await expect(handle({ prisma, handlers: failing })).rejects.toMatchObject({
      name: 'StripeWebhookHandlerError',
      code: 'HANDLER_FAILED',
      statusCode: 500,
      eventId: 'evt_test_1',
      eventType: 'invoice.paid',
      cause: down
    })
    expect(prisma.claimed.size).toBe(0)

    const handlers = { 'invoice.paid': async (e, { tx }) => tx.rows.push(e.data.object.id) }
    await expect(handle({ prisma, handlers })).resolves.toMatchObject({ status: 200 })
    expect(prisma.rows).toEqual(['in_1'])
  })

  it('rejects with a 500 when a handler fails with a P2025, a P2002 of its own or a 4xx', async () => {
    // What an app's error handler answers 404, 409 or 400 on an ordinary route: Stripe would take any of
    // them as final and nothing would be reported.
    const failures = [
      Object.assign(new Error('Record to update not found'), { name: 'PrismaClientKnownRequestError', code: 'P2025' }),
      Object.assign(new Error('Unique constraint failed'), { name: 'PrismaClientKnownRequestError', code: 'P2002' }),
      Object.assign(new Error('Booking not found'), { name: 'AppError', statusCode: 404, code: 'NOT_FOUND' })
    ]
    for (const failure of failures) {
      const prisma = fakePrisma()
      const handlers = { 'invoice.paid': async () => Promise.reject(failure) }
      const rejected = await handle({ prisma, handlers }).catch((err) => err)

      expect(rejected).toBeInstanceOf(StripeWebhookHandlerError)
      expect(rejected).toMatchObject({ statusCode: 500, code: 'HANDLER_FAILED', cause: failure })
      // A handler's own unique violation is a failure, not a duplicate: the event id is released for the retry.
      expect(prisma.claimed.size).toBe(0)
    }
  })

  it('logs a failed side effect without failing the webhook', async () => {
    const prisma = fakePrisma()
    const log = { info: vi.fn(), error: vi.fn() }
    const handlers = {
      'invoice.paid': async (e, { tx, after }) => {
        tx.rows.push(e.data.object.id)
        after(() => Promise.reject(new Error('SES down')))
      }
    }
    await expect(handle({ prisma, handlers, log })).resolves.toMatchObject({ status: 200 })
    expect(prisma.rows).toEqual(['in_1'])
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('answers 200 to an event type with no handler, without touching the database', async () => {
    const prisma = fakePrisma()
    await expect(handle({ prisma, handlers: {} })).resolves.toEqual({
      status: 200,
      body: { received: true, handled: false }
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('answers 400 to a bad signature and 500 when the secret is missing, without running handlers', async () => {
    const prisma = fakePrisma()
    const handlers = { 'invoice.paid': vi.fn() }
    await expect(handle({ prisma, handlers, signature: sign(payload, 'whsec_wrong') })).resolves.toMatchObject({
      status: 400,
      body: { code: 'INVALID_SIGNATURE' }
    })
    await expect(handle({ prisma, handlers, secret: undefined })).resolves.toMatchObject({
      status: 500,
      body: { code: 'WEBHOOK_NOT_CONFIGURED' }
    })
    expect(handlers['invoice.paid']).not.toHaveBeenCalled()
  })

  it('refuses to start without handlers or an event table', async () => {
    await expect(handle({ prisma: fakePrisma(), handlers: undefined })).rejects.toThrow(/handlers/)
    await expect(handle({ prisma: { $transaction: vi.fn() }, handlers: {} })).rejects.toThrow(/no model "stripeEvent"/)
  })
})
