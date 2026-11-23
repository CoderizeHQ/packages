import { describe, expect, it, vi } from 'vitest'

import { processEventOnce } from '../index.js'

const event = { id: 'evt_1', type: 'invoice.paid' }

/**
 * An event-log table in memory with a unique id, and transactions that commit on success and roll back
 * on a throw, as Prisma's interactive $transaction does. `rows` holds what work the handler committed.
 */
function memoryStore({ uniqueViolation = false } = {}) {
  const ids = new Set()
  const rows = []
  return {
    ids,
    rows,
    seen: vi.fn(async (id) => ids.has(id)),
    record: vi.fn(async (id, _event, tx) => {
      const target = tx?.ids ?? ids
      if (target.has(id)) {
        if (uniqueViolation) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        return false
      }
      target.add(id)
      return { id }
    }),
    transaction: vi.fn(async (work) => {
      const tx = { ids: new Set(ids), rows: [...rows] }
      const result = await work(tx)
      ids.clear()
      tx.ids.forEach((id) => ids.add(id))
      rows.splice(0, rows.length, ...tx.rows)
      return result
    }),
  }
}

const writeRow = (e, tx) => {
  tx.rows.push(e.id)
}

describe('processEventOnce, claim mode (the default)', () => {
  it('runs the work once and records the id in the same transaction', async () => {
    const store = memoryStore()
    const handler = vi.fn(writeRow)

    expect(await processEventOnce(event, handler, store)).toEqual({ duplicate: false })
    expect(await processEventOnce(event, handler, store)).toEqual({ duplicate: true })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(store.rows).toEqual(['evt_1'])
    expect(store.ids.has('evt_1')).toBe(true)
  })

  it('passes the transaction to the handler', async () => {
    const store = memoryStore()
    const handler = vi.fn()
    await processEventOnce(event, handler, store)
    expect(handler).toHaveBeenCalledWith(event, expect.objectContaining({ ids: expect.any(Set) }))
  })

  it('rolls the claim back with failed work, so the retry runs it', async () => {
    const store = memoryStore()
    const failing = vi.fn(async (e, tx) => {
      writeRow(e, tx)
      throw new Error('db down')
    })

    await expect(processEventOnce(event, failing, store)).rejects.toThrow('db down')
    expect(store.ids.size).toBe(0)
    expect(store.rows).toEqual([])

    expect(await processEventOnce(event, writeRow, store)).toEqual({ duplicate: false })
    expect(store.rows).toEqual(['evt_1'])
  })

  it('treats a unique-constraint error from record as a redelivery', async () => {
    const store = memoryStore({ uniqueViolation: true })
    store.ids.add('evt_1')
    // No pre-check: this is the race a seen() read cannot close, two deliveries at once.
    delete store.seen
    const handler = vi.fn()

    expect(await processEventOnce(event, handler, store)).toEqual({ duplicate: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it('takes a custom isDuplicate for storage that is not Prisma', async () => {
    const store = memoryStore()
    store.record = vi.fn(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    store.isDuplicate = (err) => err?.code === '23505'
    expect(await processEventOnce(event, vi.fn(), store)).toEqual({ duplicate: true })
  })

  it('passes on any other error from record', async () => {
    const store = memoryStore()
    store.record = vi.fn(async () => {
      throw new Error('connection reset')
    })
    await expect(processEventOnce(event, vi.fn(), store)).rejects.toThrow('connection reset')
  })

  it('skips the transaction when seen() already knows the id', async () => {
    const store = memoryStore()
    store.ids.add('evt_1')
    expect(await processEventOnce(event, vi.fn(), store)).toEqual({ duplicate: true })
    expect(store.transaction).not.toHaveBeenCalled()
  })

  it('treats any record result but false as recorded', async () => {
    const store = memoryStore()
    store.record = vi.fn(async () => undefined)
    const handler = vi.fn()
    expect(await processEventOnce(event, handler, store)).toEqual({ duplicate: false })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('refuses to run without a transaction rather than claim outside one', async () => {
    const store = memoryStore()
    delete store.transaction
    const handler = vi.fn()
    await expect(processEventOnce(event, handler, store)).rejects.toThrow(/needs store.transaction/)
    expect(handler).not.toHaveBeenCalled()
    expect(store.record).not.toHaveBeenCalled()
  })
})

describe('processEventOnce, record-after mode', () => {
  const options = { mode: 'record-after' }

  it('records the id only after the work succeeded', async () => {
    const store = memoryStore()
    const order = []
    store.record.mockImplementation(async (id) => {
      order.push('record')
      store.ids.add(id)
    })
    const handler = vi.fn(async () => order.push('work'))

    expect(await processEventOnce(event, handler, store, options)).toEqual({ duplicate: false })
    expect(order).toEqual(['work', 'record'])
    expect(handler).toHaveBeenCalledWith(event, undefined)
    expect(await processEventOnce(event, handler, store, options)).toEqual({ duplicate: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('records nothing when the work fails, so the retry runs it', async () => {
    const store = memoryStore()
    const failing = vi.fn(async () => {
      throw new Error('stripe timeout')
    })
    await expect(processEventOnce(event, failing, store, options)).rejects.toThrow('stripe timeout')
    expect(store.record).not.toHaveBeenCalled()
  })

  it('ignores a concurrent delivery that recorded the id first', async () => {
    const store = memoryStore()
    store.record = vi.fn(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    })
    expect(await processEventOnce(event, vi.fn(), store, options)).toEqual({ duplicate: false })
  })

  it('needs seen()', async () => {
    const store = memoryStore()
    delete store.seen
    await expect(processEventOnce(event, vi.fn(), store, options)).rejects.toThrow(/needs store.seen/)
  })
})

describe('processEventOnce, arguments', () => {
  it('refuses an event without an id, a missing handler or record, and an unknown mode', async () => {
    const store = memoryStore()
    await expect(processEventOnce({}, vi.fn(), store)).rejects.toThrow(/no id/)
    await expect(processEventOnce(event, undefined, store)).rejects.toThrow(/handler/)
    await expect(processEventOnce(event, vi.fn(), {})).rejects.toThrow(/store.record/)
    await expect(processEventOnce(event, vi.fn(), store, { mode: 'claim-first' })).rejects.toThrow(/unknown mode/)
  })
})
