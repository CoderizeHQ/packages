# @coderizehq/stripe

How every Coderize app talks to Stripe: one pinned API version, the client built with it, a CI guard that
fails when a `stripe` upgrade would move it, the webhook basics (raw-body signature check, once-only
processing, routing by type), readers for the fields Stripe has moved between API versions, and a browser-safe
card-fee gross-up so a checkout page shows exactly the fee the API charges.

```bash
pnpm add @coderizehq/stripe
```

Peer dependency: `stripe` 23. Each app keeps `stripe` as its own dependency, so this package never brings a
second copy of the SDK. Plain JavaScript (ESM) with TypeScript types included.

## The rule: changing the API version is a major release

`STRIPE_API_VERSION` is `2026-10-28.endive` in 2.x. 1.x pinned `2026-08-26.dahlia`, and an app moving from 1.x
changes its code first: see [Upgrading from 1.x](#upgrading-from-1x). The version only ever moves in a **major**
release of this package. Renovate merges minor and patch releases by itself and holds majors for review, so no
app changes API version without a person reading the changelog and testing a checkout first.

Without a pin, stripe-node does not use the account's Dashboard version: it sends the version its own release
was built against. stripe 23.0 moved that default to `2026-09-30.endive`, 23.1 to `2026-10-28.endive` and 23.2 to
`2026-11-18.endive`, so an unpinned client is already on endive.

## Upgrading from 1.x

2.0.0 moves the pin from `2026-08-26.dahlia` to `2026-10-28.endive`. `2026-10-28.endive` has no GA breaking
changes of its own, so the move means taking on the breaking changes of `2026-09-30.endive`. An app stays on 1.x
until its own adoption PR (Renovate holds the major), and that PR makes these changes:

1. **Drop `payment_method_types` from every write that no longer takes it.** Checkout Session create, PaymentIntent
   create, update and confirm, and SetupIntent create and update now answer **400** when it is passed
   (`payment_method_types_no_longer_supported` on the intents). Either:
   - remove it and manage payment methods in the Dashboard (dynamic payment methods, a payment method
     configuration), excluding any you don't want with `excluded_payment_method_types`; or
   - replace it with `allowed_payment_method_types: [...]`.

   `allowed_payment_method_types` **filters silently**: a type the account or amount can't use is left out
   instead of failing the request. Where one method matters (a price that depends on card or eCheck, say), check
   the `payment_method_types` the created object returns, and fail when the one you asked for is missing.
   Reading `payment_method_types` on the returned object still works, and Payment Links create keeps the
   parameter: it isn't part of the change. Update tests that assert the old create params.

2. **Pass `billing_cycle_anchor` as an object on subscription update and resume.** `'unchanged'` becomes
   `{ type: 'unchanged' }` and `'now'` becomes `{ type: 'now' }`. `invoices.createPreview` takes the same object in
   `subscription_details.billing_cycle_anchor`, and a timestamp there becomes `{ type: 'timestamp', timestamp }`.
   Subscription **create** is unchanged.

3. **Check the rest of 2026-09-30.endive against the app.** These are the other breaking items an app here could
   plausibly hit:
   - **Stripe Tax:** a new `failed_tax_calculation` error from tax calculations (create and preview), invoice
     finalize, pay and retrieve, and subscription create and update with automatic tax. Treat it as a failed
     calculation, never as zero tax.
   - **Connect:** `requirements.disabled_reason` reports accounts the platform rejected as `rejected.platform_fraud`,
     `rejected.platform_terms_of_service` and `rejected.platform_other`; `requirements.errors` can list
     `eventually_due` requirements; and `accounts.reject` no longer takes `reason: 'fraud'` (use `fraud_other` or a
     specific `fraud_*` reason). Apps that read only `charges_enabled`, `payouts_enabled` and `details_submitted`
     are unaffected.
   - **Stripe.js on Endive** (`@stripe/stripe-js` 10): the Payment Request Button and the Elements
     `paymentMethodTypes` option are gone, Elements with Checkout Sessions keeps `canConfirm` false while an
     update is pending, and `billingDetails: 'never'` needs the billing details passed at confirm.
   - The rest (Accounts v2, Financial Connections, Treasury and money management, PayTo, BLIK, India mandates,
     Radar payment evaluations, reserves, dispute evidence page limits) only matters to an app using those
     products. Stripe's list: <https://docs.stripe.com/changelog/endive>.

4. **Drop any explicit `apiVersion`.** `createStripe` refuses `apiVersion: '2026-08-26.dahlia'` now, and the types
   reject it. Scripts that build their own client move to `createStripe` too, and tests that assert the dahlia
   string compare against `STRIPE_API_VERSION` instead.

5. **Move each webhook endpoint to `2026-10-28.endive`.** A payload is rendered in its endpoint's API version, not
   the client's pin, so an endpoint left on dahlia keeps sending dahlia payloads. The readers below take either
   shape, so nothing breaks while the two overlap:
   1. Create a new endpoint on `2026-10-28.endive` for the same route and events (Dashboard, or
      `webhookEndpoints.create` with `api_version: STRIPE_API_VERSION`).
   2. Give the app both signing secrets and pass them as a list: `verifyWebhook({ secret: [oldSecret, newSecret] })`.
      Both endpoints deliver every event while both are on, with the same `event.id`, so `processEventOnce`
      skips the second delivery.
   3. Deploy, confirm events arrive on the new endpoint, then disable the old one and drop its secret.

6. **Run a test-mode checkout** (and a subscription change, where the app has one) before merging.

The CI guard (`coderize-stripe-check`) stays as it is and passes on stripe 23.0 and 23.1, and on 23.2 from 2.3.1.

## Adopting it in an app

### 1. The client

Replace the app's `new Stripe(key, { apiVersion })` with `createStripe`, and delete its own version constant.

```js
// src/plugins/stripe.js
import fp from 'fastify-plugin'
import { createStripe } from '@coderizehq/stripe'

export default fp(async function stripePlugin(app) {
  app.decorate('stripe', createStripe(process.env.STRIPE_SECRET_KEY))
})
```

`createStripe(secretKey, options)` returns a stripe-node client on the pin with `maxNetworkRetries: 2`. Other
stripe-node options pass through (`timeout`, `stripeAccount`, `httpClient`…). It throws on an empty key, and on
an `apiVersion` other than the pin: an app that needs another version needs another major release here, not a
local override. Scripts that build their own client (`scripts/*.mjs`, `prisma/*.js`) use it too, or they talk
the SDK's default version while the app talks the pin.

A test that only builds a client needs no network: building one makes no request.

### 2. The guard in CI

Add a step to the app's CI workflow, after the install:

```yaml
- name: Check the Stripe API version
  run: pnpm --filter <scope>/api exec coderize-stripe-check
```

It needs no network, keys or database, and fails (exit 1) when:

- the installed `stripe` defaults to an API version this release hasn't reviewed (`REVIEWED_SDK_DEFAULTS`), or
- a client from `createStripe` doesn't send the pin.

So when Renovate offers a `stripe` release that moves the default, that PR goes red until a release of this
package reviews it. Don't work around it in the app. The same checks are `checkStripeVersion()` for a test.

Remove the app's own guard script and pin-assertion tests once this one runs.

### 3. Webhooks

Stripe signs the exact bytes it sends. Parsing the JSON and serialising it again changes whitespace and key
order, so the signature no longer matches, and a check on a re-parsed object proves nothing anyway. So the
webhook route reads the **raw body**: in Fastify, a buffer content-type parser registered inside the webhook
route's own plugin (never globally); in Next.js, `await request.text()`.

**Use `handleStripeWebhook`.** It is the whole webhook in one call: it checks the signature, answers an event
type with no handler, records the event id in the same transaction as the handler's writes so a second copy is
skipped (even one arriving at the same moment), and runs side effects once that transaction has committed. The
app writes only its handlers and one table:

```prisma
model StripeEvent {
  id         String   @id
  type       String
  receivedAt DateTime @default(now())
}
```

```js
// src/routes/stripeWebhook.js (Fastify)
import { handleStripeWebhook } from '@coderizehq/stripe'

export default async function stripeWebhookRoutes(app) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => done(null, body))

  app.post('/', async (request, reply) => {
    const { status, body } = await handleStripeWebhook({
      stripe: app.stripe,
      rawBody: request.body,
      signature: request.headers['stripe-signature'],
      // Both secrets while an endpoint is being replaced; the old one comes out after the switch.
      secret: [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET_NEXT],
      prisma: app.prisma,
      handlers,
      log: request.log,
    })
    return reply.code(status).send(body)
  })
}

const handlers = {
  // Every database write goes through `tx`; anything outside the database goes through `after`.
  'invoice.paid': async (event, { tx, after }) => {
    const payment = await tx.payment.create({ data: { stripeInvoiceId: event.data.object.id /* ... */ } })
    after(() => sendReceipt(payment))
  },
}
```

```ts
// src/app/api/stripe/webhook/route.ts (Next.js)
export async function POST(request: Request) {
  const { status, body } = await handleStripeWebhook({
    stripe,
    rawBody: await request.text(),
    signature: request.headers.get('stripe-signature'),
    secret: [process.env.STRIPE_WEBHOOK_SECRET!, process.env.STRIPE_WEBHOOK_SECRET_NEXT!],
    prisma,
    handlers,
  })
  return Response.json(body, { status })
}
```

**`handleStripeWebhook({ stripe, rawBody, signature, secret, handlers, prisma, log })`** resolves
`{ status, body }`, the answer to send:

| Case                               | Status  | Body                                  |
| ---------------------------------- | ------- | ------------------------------------- |
| handled                            | 200     | `{ received: true }`                  |
| a copy of an event already handled | 200     | `{ received: true, duplicate: true }` |
| no handler for the type (logged)   | 200     | `{ received: true, handled: false }`  |
| refused by `verifyWebhook` (below) | 400/500 | `{ error, code }`                     |

When a handler throws, it **rejects** rather than resolving, with a `StripeWebhookHandlerError`
(`statusCode` 500, `code` `HANDLER_FAILED`, `eventId`, `eventType`, and the handler's error as `cause`): the
transaction rolls back with the event id, the framework answers 500 and reports the error, and Stripe's retry
runs the handler again. Don't catch it. The wrapper is what keeps it a 500: an app's error handler answers
Prisma's P2025 and P2002 with 404 and 409 (`@coderizehq/fastify-kit` does on ordinary routes) and an
`AppError` with its 4xx, and Stripe takes a 4xx as final, so the event would be dropped and nothing reported.
It is deliberately not a `StripeWebhookError`, so a route that catches those to send their status can't
swallow it. A
function queued with `after` that fails is logged and the webhook still answers 200, because the payment it
follows did happen. `log` takes pino (`request.log`) or console, the default. A table named or shaped
differently goes through `storeOptions` (`{ model: 'webhookEvent', idField: 'stripeEventId' }`), and
`store` replaces the Prisma store altogether.

The parts below are what it is built from. Use them directly only where the one call doesn't fit.

**`verifyWebhook({ stripe, rawBody, signature, secret, tolerance })`** returns the event or throws a
`StripeWebhookError` whose `statusCode` is the answer to send:

| `code`                   | Status | Meaning                                                             |
| ------------------------ | ------ | ------------------------------------------------------------------- |
| `MISSING_SIGNATURE`      | 400    | no `Stripe-Signature` header                                        |
| `INVALID_SIGNATURE`      | 400    | wrong secret, a changed body, or a signature older than `tolerance` |
| `RAW_BODY_REQUIRED`      | 500    | the body arrived parsed: the route is missing its raw-body parser   |
| `WEBHOOK_NOT_CONFIGURED` | 500    | no client or no signing secret                                      |

The two 500s are our faults, so Stripe keeps retrying until they're fixed instead of the events being dropped.
`secret` can be a list while an endpoint is being replaced: the old and new endpoints sign with different
secrets, and an event passes when it matches either. Any other error from stripe-node is passed on.

**`processEventOnce(event, handler, store, { mode })`** processes each event once. Stripe redelivers until it
gets a 2xx and can deliver an event twice at once. The app keeps the storage, a table with a unique event id,
and passes callbacks: `record(id, event, tx)`, `seen(id)`, `transaction(work)`, and optionally
`isDuplicate(err)` (Prisma's `P2002` by default). It resolves `{ duplicate }`; answer 200 either way. A failure
rejects: let the route answer 500 so Stripe retries. Never catch it and answer 2xx, which stops the retries.

There are two modes, and they fail differently:

- **`claim`** (the default): the event id is recorded **first, inside the same transaction as the work**. A
  redelivery, even a concurrent one, hits the unique constraint and is skipped. If the work fails, the
  rollback takes the id with it and the retry runs the work again. Everything in the transaction happens
  exactly once. This is the pattern the fleet requires; coderize-dev-mono's `routes/webhooks.js` is the
  reference. `record` reports an id already there by returning `false` (an `ON CONFLICT DO NOTHING` insert
  that inserted nothing) or by throwing the unique-constraint error. `seen`, if given, is a cheap pre-check
  that skips opening a transaction for an obvious redelivery.
- **`record-after`**: `seen` first, then the work, then `record`. It never loses an event, because the id is
  only written once the work succeeded. But two deliveries racing can both run the work, and a crash between
  the work and the record runs it again on the retry. Use it only when the work can't share a transaction
  (it calls Stripe or another service), and make that work idempotent: an idempotency key on every Stripe
  create, an upsert rather than an insert.

What it never offers is recording the id in a statement of its own before the work. If the work then fails,
the retry sees the id and skips it, and a paid event is lost for good; that happened in a fleet app. Deleting
the id again in a `catch` is a weaker fallback, since a crash mid-handler still loses the event.

**`prismaEventStore(prisma, { model, idField, data, transactionOptions })`** is the store
`handleStripeWebhook` uses: `record`, `seen` and `transaction` over a Prisma model with a unique event id
(`prisma.stripeEvent` and `id` by default), with a 20-second transaction timeout because Neon round-trips make
Prisma's 5-second default tight. Pass it to `processEventOnce` when you wire the steps yourself.

**`routeEvent(event, handlers, context)`** calls `handlers[event.type](event, context)` and resolves `true`, or
resolves `false` when no handler matches. Log the `false` ones: an event type nobody handles is the commonest
gap in webhook code. In TypeScript each handler gets the event narrowed to its type.

### 4. Readers for moved fields

API version 2025-03-31.basil moved several fields, and a webhook payload is rendered in **its endpoint's** API
version, not the client's pin, so either shape can arrive. None of these fields moved again in
`2026-09-30.endive` or `2026-10-28.endive`. Each reader takes the new shape first and the old
one second, and returns null when Stripe doesn't say. Code that reads only the old fields fails quietly: a
renewal skipped as "untracked", a revenue share never recorded, a ship-to address replaced by the billing one.

| Reader                                    | Reads (new shape, then old)                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `subscriptionPeriod(subscription)`        | `{ start, end }` Dates from `items.data[].current_period_*` (latest end wins), then `current_period_*` |
| `invoiceSubscriptionId(invoice)`          | `parent.subscription_details.subscription`, then `subscription`                                        |
| `invoicePeriodStart(invoice)`             | `lines.data[0].period.start`, as a Date                                                                |
| `invoicePaymentIntentId(stripe, invoice)` | `payment_intent`, then `payments.data[].payment.payment_intent`; async, see below                      |
| `invoiceChargeId(invoice)`                | `charge`, then `payments.data[].payment.charge` or an expanded intent's `latest_charge`                |
| `checkoutShipping(session)`               | `collected_information.shipping_details`, then `shipping_details`                                      |

A webhook's invoice has no `payments` list since basil. `invoicePaymentIntentId` fetches it when the payload
lacks it (one `invoices.retrieve` with `expand: ['payments']`; pass `null` as `stripe` to read the payload
only) and rejects if Stripe can't be reached, so the webhook retries. `invoiceChargeId` reads the payload only:
pass an invoice retrieved with `expand: ['payments.data.payment.payment_intent']` to reach the charge behind an
intent. Both prefer the payment with `status: 'paid'` over failed attempts. A null period from
`subscriptionPeriod` means "keep the stored value", never "write null over it".

`checkoutShipping` returns null when nothing was collected. An app whose own copy returned `{}` writes
`checkoutShipping(session) ?? {}` to keep that behaviour.

### 5. Covering the card fee (`@coderizehq/stripe/fees`)

When the payer covers the processing fee, the page that shows the fee and the API that charges it must compute
the same number. icrotary had them apart, the page in float dollars and the API in integer cents, and 387 of the
500,000 amounts from $0.01 to $5,000.00 showed a fee 1¢ higher than the card was charged. Both sides import this
one function instead:

```js
// the checkout page (browser) and the checkout route (API) alike
import { cardFeeCents, grossUpForCardFee } from '@coderizehq/stripe/fees'

const { feeCents, totalCents } = grossUpForCardFee(subtotalCents) // 5000 -> 181 and 5181
```

`@coderizehq/stripe/fees` imports nothing, so a Vite or Astro page loads it without the Stripe SDK or any Node
built-in. The main entry does not re-export it: import it from `./fees` everywhere.

| Export                                              | What it is                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `grossUpForCardFee(netCents, { rate, fixedCents })` | `{ netCents, feeCents, totalCents }`: the total that nets `netCents` after the fee   |
| `cardFeeCents(netCents, fee?)`                      | the `feeCents` alone, for a "processing fee" line                                    |
| `US_CARD_FEE`                                       | `{ rate: 0.029, fixedCents: 30 }`, Stripe's standard US card pricing and the default |

The total is `(net + fixed) / (1 - rate)` **rounded up to the cent**, so the org is never short once Stripe
rounds its own fee. That is what icrotary's API and imlay's `feeCalc` already charge, for every amount; it runs
in integer arithmetic, so no float lands a cent high. Amounts are integer cents (a float or a string throws), and
`rate` is a fraction with at most six decimal places (`0.022` for a 2.2% nonprofit rate).

Moving an app onto it changes these, so put the API and its pages in the same PR:

- **icrotary's pages** (`PayInvoice`, `RaffleTicketForm`, `LunchCredits`) show 1¢ less on the 387 amounts above,
  now matching the charge. Its `DonationForm` and API are unchanged.
- **refugelapeer and xceptionalheroes** rounded to the nearest cent (`Math.round`). On 249,742 of those 500,000
  amounts the shared function charges the payer 1¢ more, and tests that assert a total need updating.
- **imlay** is unchanged.

## Reviewing a new SDK default

When the guard fails on a new `stripe` release:

1. Find the new default: `node -p "require('stripe/package.json').version"` and the guard's `sdkDefault`.
2. Read Stripe's changelog for every version between the pin and the new default, and grep the fleet for each
   breaking change: write params, read fields, webhook payload shapes.
3. Add an entry to `REVIEWED_SDK_DEFAULTS` in `version.js` with the date, the decision and what you found, and
   release it as a **minor** (a `feat:` PR). Apps pick it up and their guard goes green with the pin unchanged.
4. Moving the pin itself is a **major** release: change `STRIPE_API_VERSION`, mark the entry `adopted`, and say
   in the PR (`feat!:`) what each app has to change. Every app also moves its webhook endpoints to the new version,
   since payloads follow the endpoint's version.

## The plan

Phase 1 was 1.0.0, pinned to dahlia, so adopting it changes no behaviour. Phase 2 moves each app onto it
(client, guard, webhook basics, readers), one PR per app, fixing the moved-field reads on the way. Phase 3 is
2.0.0 on `2026-10-28.endive`, adopted one app at a time by the steps in
[Upgrading from 1.x](#upgrading-from-1x); AllSteel goes first.

## Versions

Semver from what a consuming app feels: a **patch** changes nothing it can see, a **minor** adds an export, an
option or a reviewed SDK default, and a **major** changes the API version or anything else an app could see on
the wire or in a return value. Renovate merges minors and patches by itself and holds majors for review.

Every release is staged on npm and goes live only once a maintainer approves it with 2FA, because Renovate
carries it into every fleet app.
