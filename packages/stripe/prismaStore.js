/*
  The EventStore processEventOnce needs, built on a Prisma model, so an app adds one table instead of writing
  the callbacks by hand. The model only needs a unique event id; the default is

    model StripeEvent {
      id         String   @id
      type       String
      receivedAt DateTime @default(now())
    }

  An app whose table is already named or shaped differently passes `model`, `idField` and `data`.
*/

/**
 * @param {any} prisma a PrismaClient, or an extended one
 * @param {object} [options]
 * @param {string} [options.model] the client's delegate name for the table (`prisma.stripeEvent`)
 * @param {string} [options.idField] the unique column that holds the event id
 * @param {(event: any) => object} [options.data] the other columns to write with the id
 * @param {object} [options.transactionOptions] passed to `$transaction`. Neon round-trips make Prisma's 5s
 *   default tight for handlers that write several rows, hence the longer timeout.
 * @returns {import('./index.js').EventStore<any>}
 */
export function prismaEventStore(
  prisma,
  {
    model = 'stripeEvent',
    idField = 'id',
    data = (event) => ({ type: event.type }),
    transactionOptions = { maxWait: 5000, timeout: 20000 },
  } = {},
) {
  if (typeof prisma?.$transaction !== 'function') {
    throw new TypeError('prismaEventStore: pass the PrismaClient')
  }
  if (typeof prisma[model]?.create !== 'function') {
    throw new TypeError(`prismaEventStore: the client has no model "${model}". Add it to schema.prisma and migrate.`)
  }

  return {
    seen: async (id) =>
      (await prisma[model].findUnique({ where: { [idField]: id }, select: { [idField]: true } })) !== null,
    // Without a transaction (record-after mode) the id goes in through the client itself.
    record: (id, event, tx) => (tx ?? prisma)[model].create({ data: { ...data(event), [idField]: id } }),
    transaction: (work) => prisma.$transaction(work, transactionOptions),
  }
}
