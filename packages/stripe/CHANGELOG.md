# Changelog

Moved here from CoderizeDEV/coderize-platform (`packages/stripe` at c60309c) and renamed `@coderizehq/stripe`. The entries from 2.3.1 down are `@coderize/stripe`'s, released from that repo with Changesets; its git history stays there.

## 2.3.1

### Patch Changes

- Review `2026-11-18.endive`, the default of stripe 23.2.0, and add it to `REVIEWED_SDK_DEFAULTS` as declined: the pin stays `2026-10-28.endive`. Stripe's changelog for it has no GA breaking changes (the one breaking row, nullable microdeposit arrival dates, is in the preview train) and only additive fields, so `coderize-stripe-check` now passes on stripe 23.2 with nothing to change in an app.

## 2.3.0

### Minor Changes

- `handleStripeWebhook` now rejects with a `StripeWebhookHandlerError` (new export: `statusCode` 500, `code` `HANDLER_FAILED`, `eventId`, `eventType`, the original error as `cause`) when a handler or the event's transaction fails, instead of the handler's own error. The framework still answers 500, but an error handler can no longer turn a P2025, a P2002 or an `AppError` 4xx from a handler into a 404, 409 or 400, which Stripe treats as final and which nothing reports. Code that inspected the rejected error reads it from `cause`.

## 2.2.0

### Minor Changes

- Add `@coderize/stripe/fees`, the "cover the processing fee" gross-up as one function for the page that shows the fee and the API that charges it: `grossUpForCardFee(netCents, { rate, fixedCents })`, `cardFeeCents` and `US_CARD_FEE` (2.9% + 30¢). It rounds the total up to the cent in integer arithmetic, which matches icrotary's API and imlay's feeCalc on every amount, and imports nothing, so a browser page loads it without the Stripe SDK. Nothing existing changes.

## 2.1.0

### Minor Changes

- 86bae22: Add `handleStripeWebhook`, the whole webhook in one call: it verifies the signature (one secret or both during an endpoint switch), answers an event type with no handler, records the event id in the same transaction as the handler's writes so a second copy of an event is skipped even when both arrive at once, and runs side effects queued with `after` once the transaction has committed. It resolves `{ status, body }` for the route to send and rejects when a handler fails, so Stripe retries. An app adds one `StripeEvent` table and its handlers.
  
  Add `prismaEventStore`, the `processEventOnce` store over a Prisma model, which `handleStripeWebhook` uses by default.
  
  Nothing existing changes.

## 2.0.0

### Major Changes

- Pin API version `2026-10-28.endive` (was `2026-08-26.dahlia`), and mark it adopted in `REVIEWED_SDK_DEFAULTS`. `2026-09-30.endive` stays reviewed, so the guard passes on stripe 23.0 and 23.1. The readers are unchanged: none of the fields they read moved in either endive version, and they still read the older shapes that webhook endpoints on older versions send.
  
  **Upgrading from 1.x.** An app stays on 1.x until its own adoption PR. That PR:
  
  1. Drops `payment_method_types` from Checkout Session create, PaymentIntent create, update and confirm, and SetupIntent create and update, which now answer 400. Use Dashboard payment method configurations (with `excluded_payment_method_types` if needed) or `allowed_payment_method_types`, which filters out unusable types silently: where one method matters, check the `payment_method_types` the created object returns. Payment Links create is unchanged.
  2. Passes `billing_cycle_anchor` as an object on subscription update and resume (`{ type: 'unchanged' }`, `{ type: 'now' }`), and in `invoices.createPreview` `subscription_details` (a timestamp becomes `{ type: 'timestamp', timestamp }`). Subscription create is unchanged.
  3. Checks the other 2026-09-30.endive breaking changes it could hit: the `failed_tax_calculation` error with Stripe Tax; the Connect `rejected.platform_*` disabled reasons, `eventually_due` requirement errors and the removed `fraud` reject reason; Stripe.js on Endive (no Payment Request Button, no Elements `paymentMethodTypes`).
  4. Drops any explicit `apiVersion: '2026-08-26.dahlia'`, which `createStripe` now refuses, and moves scripts with their own client to `createStripe`.
  5. Moves each webhook endpoint to `2026-10-28.endive`: create a new endpoint on that version, pass both signing secrets to `verifyWebhook` as a list during the switch (`processEventOnce` skips the second delivery of each event), then disable the old endpoint.
  6. Runs a test-mode checkout before merging.
  
  Also corrects the `createStripe` comment on retries: stripe 23 already defaults to two network retries and adds an idempotency key to every v1 POST.

## 1.0.1

### Patch Changes

- First release staged by the coderize-platform release workflow through npm trusted publishing. No code changes from 1.0.0.

## 1.0.0

### Major Changes

- First release, pinned to API version `2026-08-26.dahlia` (the fleet's current version, so adopting it changes no behaviour): `STRIPE_API_VERSION` and `REVIEWED_SDK_DEFAULTS`, `createStripe`, the `coderize-stripe-check` version guard and `checkStripeVersion`, `verifyWebhook` and `StripeWebhookError`, `processEventOnce`, `routeEvent`, and readers for moved fields (`subscriptionPeriod`, `invoiceSubscriptionId`, `invoicePeriodStart`, `invoicePaymentIntentId`, `invoiceChargeId`, `checkoutShipping`), with TypeScript types.
