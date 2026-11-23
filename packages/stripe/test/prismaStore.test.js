import { describe, expect, it, vi } from 'vitest'

import { prismaEventStore } from '../index.js'

const event = { id: 'evt_1', type: 'invoice.paid' }

function fakePrisma(model = 'stripeEvent') {
  const delegate = { create: vi.fn(async ({ data }) => data), findUnique: vi.fn(async () => null) }
  return { delegate, client: { [model]: delegate, $transaction: vi.fn(async (work) => work({ [model]: delegate })) } }
}

describe('prismaEventStore', () => {
  it('writes the id and type to stripeEvent, through the transaction when there is one', async () => {
    const { client, delegate } = fakePrisma()
    const tx = { stripeEvent: { create: vi.fn(async ({ data }) => data) } }
    const store = prismaEventStore(client)
    await store.record('evt_1', event, tx)
    expect(tx.stripeEvent.create).toHaveBeenCalledWith({ data: { id: 'evt_1', type: 'invoice.paid' } })
    await store.record('evt_1', event, undefined)
    expect(delegate.create).toHaveBeenCalledOnce()
  })

  it('looks the id up for seen', async () => {
    const { client, delegate } = fakePrisma()
    const store = prismaEventStore(client)
    await expect(store.seen('evt_1')).resolves.toBe(false)
    delegate.findUnique.mockResolvedValueOnce({ id: 'evt_1' })
    await expect(store.seen('evt_1')).resolves.toBe(true)
    expect(delegate.findUnique).toHaveBeenCalledWith({ where: { id: 'evt_1' }, select: { id: true } })
  })

  it('opens the transaction with a timeout long enough for Neon', async () => {
    const { client } = fakePrisma()
    await prismaEventStore(client).transaction(async () => 'done')
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 20000 })
  })

  it('takes a table that is named and shaped differently', async () => {
    const { client, delegate } = fakePrisma('webhookEvent')
    const store = prismaEventStore(client, { model: 'webhookEvent', idField: 'stripeEventId' })
    await store.record('evt_1', event, undefined)
    expect(delegate.create).toHaveBeenCalledWith({ data: { stripeEventId: 'evt_1', type: 'invoice.paid' } })
    await store.seen('evt_1')
    expect(delegate.findUnique).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_1' },
      select: { stripeEventId: true },
    })
  })

  it('refuses a missing client or a missing model', () => {
    expect(() => prismaEventStore(undefined)).toThrow(/PrismaClient/)
    expect(() => prismaEventStore({ $transaction: vi.fn() })).toThrow(/no model "stripeEvent"/)
  })
})
