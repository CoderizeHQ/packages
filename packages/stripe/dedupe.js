/*
  Process each Stripe event once. Stripe redelivers an event until it gets a 2xx, and can deliver one
  twice at the same time, so a webhook has to recognise an event it already handled. The app keeps the
  storage (a table with a unique event id); this decides when to read and write it.

  Two orders are possible, and they fail differently:

  - "claim" (the default): record the event id FIRST, inside the same database transaction as the work.
    A redelivery, even a concurrent one, hits the unique constraint and is skipped. If the work fails the
    transaction rolls the id back with it, the route answers 500, and Stripe's retry runs the work again.
    Exactly once for everything in the transaction. This is the pattern the fleet's stripe-integration
    skill requires, and coderize-dev-mono's routes/webhooks.js is the reference.

  - "record-after": check the id, do the work, then record the id. It never loses an event, because the id
    is only written once the work succeeded, but two deliveries racing can both run the work, and a crash
    between the work and the record runs it again on the retry. Use it only when the work cannot share a
    transaction (it calls Stripe or another service), and make that work idempotent: an idempotency key on
    every Stripe create, an upsert rather than an insert.

  What is never offered: recording the id in its own statement before the work. If the work then fails,
  the retry sees the id and skips it, and a paid event is lost for good. A fleet app lost paid
  events that way.

  Side effects outside the database (emails, Slack) go after processEventOnce resolves, and must never fail
  the webhook.
*/

class DuplicateEvent extends Error {}

/** Prisma's unique-constraint code, the usual way a claim finds the event already recorded. */
const isPrismaUniqueViolation = (err) => err?.code === 'P2002'

/**
 * @template Tx
 * @typedef {object} EventStore
 * @property {(id: string, event: { id: string }, tx: Tx) => unknown} record writes the event id. It reports
 *   an id that is already there by returning `false` (an `INSERT ... ON CONFLICT DO NOTHING` that inserted
 *   nothing) or by throwing an error `isDuplicate` recognises. Any other return value means recorded.
 * @property {(id: string) => unknown} [seen] whether the id is already recorded. Required for
 *   `record-after`; in `claim` mode an optional cheap pre-check that skips opening a transaction.
 * @property {<T>(work: (tx: Tx) => Promise<T>) => Promise<T>} [transaction] runs `work` in one database
 *   transaction and rolls it back when `work` throws, e.g. `(work) => prisma.$transaction(work)`.
 *   Required for `claim`.
 * @property {(err: unknown) => boolean} [isDuplicate] recognises the error `record` throws for an id that is
 *   already there. Defaults to Prisma's P2002.
 */

/**
 * Runs `handler` for an event that has not been processed before, and skips one that has.
 *
 * Resolves `{ duplicate: true }` for a redelivery (answer 200) and `{ duplicate: false }` once the work is
 * done (answer 200). A failure rejects, so the route answers 500 and Stripe retries. Never catch it and
 * answer 2xx: that stops the retries exactly as a lost event id does.
 * @template Tx
 * @param {{ id: string }} event a verified event from verifyWebhook
 * @param {(event: any, tx: Tx | undefined) => unknown} handler the work; in `claim` mode it gets the
 *   transaction and must do all its database writes through it
 * @param {EventStore<Tx>} store the app's storage callbacks
 * @param {{ mode?: 'claim' | 'record-after' }} [options]
 * @returns {Promise<{ duplicate: boolean }>}
 */
export async function processEventOnce(event, handler, store, { mode = 'claim' } = {}) {
  if (typeof event?.id !== 'string' || event.id === '') throw new TypeError('processEventOnce: the event has no id')
  if (typeof handler !== 'function') throw new TypeError('processEventOnce: handler must be a function')
  if (typeof store?.record !== 'function') throw new TypeError('processEventOnce: store.record must be a function')
  const isDuplicate = store.isDuplicate ?? isPrismaUniqueViolation

  if (mode === 'claim') {
    if (typeof store.transaction !== 'function') {
      throw new TypeError(
        'processEventOnce: claim mode needs store.transaction, so the event id commits with the work. ' +
          "For work that cannot share a transaction, pass { mode: 'record-after' }.",
      )
    }
    if (store.seen && (await store.seen(event.id))) return { duplicate: true }
    try {
      await store.transaction(async (tx) => {
        let recorded
        try {
          recorded = await store.record(event.id, event, tx)
        } catch (err) {
          if (isDuplicate(err)) throw new DuplicateEvent()
          throw err
        }
        // Throwing rolls the transaction back, which also covers a database that aborted it on the conflict.
        if (recorded === false) throw new DuplicateEvent()
        await handler(event, tx)
      })
    } catch (err) {
      if (err instanceof DuplicateEvent) return { duplicate: true }
      throw err
    }
    return { duplicate: false }
  }

  if (mode === 'record-after') {
    if (typeof store.seen !== 'function') {
      throw new TypeError('processEventOnce: record-after mode needs store.seen')
    }
    if (await store.seen(event.id)) return { duplicate: true }
    await handler(event, undefined)
    try {
      await store.record(event.id, event, undefined)
    } catch (err) {
      // A concurrent delivery recorded it first. The work is done either way.
      if (!isDuplicate(err)) throw err
    }
    return { duplicate: false }
  }

  throw new TypeError(`processEventOnce: unknown mode ${JSON.stringify(mode)}`)
}
