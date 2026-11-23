// Types for TypeScript consumers (the Next.js and TypeScript apps in the fleet). Hand-written to match
// index.js; test/types/consumer.ts type-checks them on every `pnpm test`.
import type Stripe from 'stripe'

/** The API version `createStripe` sends. Changing it is a major release. */
export declare const STRIPE_API_VERSION: '2026-10-28.endive'

export interface ReviewedSdkDefault {
  /** The API version a stripe-node release defaults to. */
  readonly version: string
  /** The first stripe-node release with that default. */
  readonly sdk: string
  /** The date it was reviewed (YYYY-MM-DD). */
  readonly reviewed: string
  /** `adopted` once STRIPE_API_VERSION moved to it. */
  readonly decision: 'adopted' | 'declined'
  /** What the review found. */
  readonly notes: string
}

/** SDK defaults this release reviewed; the version guard accepts these and the pin. */
export declare const REVIEWED_SDK_DEFAULTS: ReadonlyArray<ReviewedSdkDefault>

/** stripe-node options, less `apiVersion`, which only accepts the pin itself. */
export type CreateStripeOptions = Omit<Stripe.StripeConfig, 'apiVersion'> & {
  apiVersion?: typeof STRIPE_API_VERSION
}

/** A Stripe client on the pinned API version, with two network retries. Throws on another `apiVersion`. */
export declare function createStripe(secretKey: string, options?: CreateStripeOptions): Stripe

export interface GuardCheck {
  id: 'pin-format' | 'sdk-default' | 'client-sends-pin'
  ok: boolean
  label: string
  detail: Record<string, unknown>
}

export interface GuardResult {
  /** Every check passed. */
  ok: boolean
  /** The installed stripe-node release. */
  sdkVersion: string | undefined
  /** The API version it sends when none is pinned. */
  sdkDefault: string | undefined
  checks: GuardCheck[]
}

/** Checks the installed `stripe` against this release's pin and reviewed defaults. No network. */
export declare function checkStripeVersion(options?: { Stripe?: unknown }): GuardResult

export type StripeWebhookErrorCode =
  'WEBHOOK_NOT_CONFIGURED' | 'RAW_BODY_REQUIRED' | 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE'

/** Why a webhook was refused. `statusCode` is what the route should answer. */
export declare class StripeWebhookError extends Error {
  constructor(message: string, code: StripeWebhookErrorCode, statusCode: number, options?: { cause?: unknown })
  name: 'StripeWebhookError'
  code: StripeWebhookErrorCode
  statusCode: number
}

/**
 * A verified event whose handling failed. Always a 500, whatever the cause (a P2002, an AppError's 4xx),
 * so Stripe retries and the error handler reports it. The original error is `cause`.
 */
export declare class StripeWebhookHandlerError extends Error {
  constructor(event: { id?: string; type?: string }, options?: { cause?: unknown })
  name: 'StripeWebhookHandlerError'
  code: 'HANDLER_FAILED'
  statusCode: 500
  eventId: string | undefined
  eventType: string | undefined
}

export interface VerifyWebhookInput {
  /** A client from createStripe. */
  stripe: Pick<Stripe, 'webhooks'>
  /** The unparsed request body. A Buffer is a Uint8Array. */
  rawBody: string | Uint8Array
  /** The `Stripe-Signature` header. */
  signature: string | string[] | Uint8Array | null | undefined
  /** The endpoint's signing secret; a list while an endpoint is being replaced. */
  secret: string | string[] | undefined
  /** Seconds a signature stays valid, Stripe's 300 by default. */
  tolerance?: number
}

/** Verifies a webhook's signature and returns the event, or throws a StripeWebhookError. */
export declare function verifyWebhook(input: VerifyWebhookInput): Stripe.Event

/** Handlers keyed by event type; each gets the event narrowed to its type. */
export type EventHandlers<E extends { type: string } = Stripe.Event, C = undefined> = {
  [K in E['type']]?: (event: Extract<E, { type: K }>, context: C) => unknown
}

/**
 * Calls the handler for `event.type` with the event and `context`. Resolves `false` when no handler
 * matched, so the caller can log the unhandled type.
 */
export declare function routeEvent<E extends { type: string } = Stripe.Event, C = undefined>(
  event: E,
  handlers: EventHandlers<E, C>,
  context?: C,
): Promise<boolean>

export interface EventStore<Tx = unknown> {
  /**
   * Writes the event id. Returns `false` (or throws an error `isDuplicate` recognises) when the id is
   * already there; any other result means recorded.
   */
  record(id: string, event: { id: string }, tx: Tx | undefined): unknown
  /** Whether the id is already recorded. Required for `record-after`. */
  seen?(id: string): unknown
  /** Runs `work` in one database transaction. Required for `claim`. */
  transaction?<T>(work: (tx: Tx) => Promise<T>): Promise<T>
  /** Recognises the error `record` throws for an id already there. Defaults to Prisma's P2002. */
  isDuplicate?(err: unknown): boolean
}

export interface ProcessEventOnceOptions {
  /** `claim` (default): the id commits with the work. `record-after`: the id is written once the work succeeded. */
  mode?: 'claim' | 'record-after'
}

/** Runs `handler` for an event not processed before. Rejects when the work fails, so the route answers 500. */
export declare function processEventOnce<E extends { id: string }, Tx = unknown>(
  event: E,
  handler: (event: E, tx: Tx | undefined) => unknown,
  store: EventStore<Tx>,
  options?: ProcessEventOnceOptions,
): Promise<{ duplicate: boolean }>

export interface PrismaEventStoreOptions {
  /** The client's delegate name for the table. Default `stripeEvent`. */
  model?: string
  /** The unique column that holds the event id. Default `id`. */
  idField?: string
  /** The other columns to write with the id. Default `{ type: event.type }`. */
  data?(event: { id: string; type?: string }): object
  /** Passed to `$transaction`. Default `{ maxWait: 5000, timeout: 20000 }`. */
  transactionOptions?: object
}

/** An EventStore for processEventOnce over a Prisma model with a unique event id. */
export declare function prismaEventStore(
  prisma: any,
  options?: PrismaEventStoreOptions,
): Required<Omit<EventStore<any>, 'isDuplicate'>>

export interface WebhookHandlerContext<Tx = any> {
  /** The transaction the event id is recorded in. Do every database write through it. */
  tx: Tx
  /** Queues a side effect (email, Slack, a Stripe call) to run after the commit. A failure is only logged. */
  after(fn: () => unknown): void
  log: { info: Function; error: Function }
}

export interface HandleStripeWebhookInput<Tx = any> {
  stripe: Stripe
  rawBody: string | Uint8Array
  signature: string | string[] | null | undefined
  /** The signing secret, or both while an endpoint is being replaced. */
  secret: string | string[]
  tolerance?: number
  handlers: {
    [T in Stripe.Event['type']]?: (
      event: Extract<Stripe.Event, { type: T }>,
      context: WebhookHandlerContext<Tx>,
    ) => unknown
  }
  /** The PrismaClient, for the default event store. */
  prisma?: any
  storeOptions?: PrismaEventStoreOptions
  /** A store of your own instead of `prisma`. */
  store?: EventStore<Tx>
  /** pino (`request.log`) or console. Default console. */
  log?: { info: Function; error: Function }
}

/**
 * Verifies, skips duplicates, runs the handler for the event type and then its queued side effects.
 * Resolves what the route should answer; rejects with a StripeWebhookHandlerError (a 500, the
 * original error as its cause) when a handler fails, so the route answers 500 and reports it.
 */
export declare function handleStripeWebhook<Tx = any>(
  input: HandleStripeWebhookInput<Tx>,
): Promise<{ status: number; body: Record<string, unknown> }>

/** Anything with Stripe's shape, in the pinned or an older API version. */
type StripeObject = object | null | undefined

/** The billing period of a subscription, from its items first and the pre-basil fields second. */
export declare function subscriptionPeriod(subscription: StripeObject): { start: Date | null; end: Date | null }

/** The subscription that generated an invoice, or null for a one-off invoice. */
export declare function invoiceSubscriptionId(invoice: StripeObject): string | null

/** The start of the billing period an invoice pays for, from its first line. */
export declare function invoicePeriodStart(invoice: StripeObject): Date | null

/** The PaymentIntent that paid an invoice: the payload first, then one retrieve when `stripe` is given. */
export declare function invoicePaymentIntentId(
  stripe: Pick<Stripe, 'invoices'> | null | undefined,
  invoice: StripeObject,
): Promise<string | null>

/** The Charge that paid an invoice, from the payload only. */
export declare function invoiceChargeId(invoice: StripeObject): string | null

/** The ship-to name and address a Checkout Session collected, or null. */
export declare function checkoutShipping(session: StripeObject): {
  name?: string | null
  address?: Stripe.Address | null
} | null
