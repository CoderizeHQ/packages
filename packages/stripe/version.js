/*
  The Stripe API version every fleet app talks, and the SDK defaults this release has reviewed.

  Left unset, stripe-node does not fall back to the account's Dashboard version: it sends the version
  its own release was built against. Apps give `stripe` a caret range and Renovate merges minor
  updates by itself, so a routine SDK bump could change what goes over the wire with no code diff.
  The pin makes every move deliberate, and changing it is always a major release of this package.
*/

/** The API version `createStripe` sends. Changing it is a major release. */
export const STRIPE_API_VERSION = '2026-10-28.endive'

/**
 * @typedef {object} ReviewedSdkDefault
 * @property {string} version the API version a stripe-node release defaults to
 * @property {string} sdk the first stripe-node release with that default
 * @property {string} reviewed the date it was reviewed (YYYY-MM-DD)
 * @property {'adopted' | 'declined'} decision `adopted` once STRIPE_API_VERSION moved to it
 * @property {string} notes what the review found
 */

/**
 * SDK defaults that were read against Stripe's changelog and decided on. The version guard accepts an
 * installed `stripe` whose default is the pin or one of these, and fails on anything else, so the next
 * SDK that moves its default turns CI red until someone reviews it and releases this package.
 * @type {ReadonlyArray<Readonly<ReviewedSdkDefault>>}
 */
export const REVIEWED_SDK_DEFAULTS = Object.freeze([
  Object.freeze({
    version: '2026-09-30.endive',
    sdk: 'stripe 23.0.0',
    reviewed: '2026-10-10',
    decision: 'declined',
    notes:
      'Removes payment_method_types as a write parameter on Checkout Session and PaymentIntent create (400), ' +
      'and makes billing_cycle_anchor an object on subscription update and resume. Several apps still pass ' +
      'payment_method_types, so the fleet stays on dahlia until each one is changed.'
  }),
  Object.freeze({
    version: '2026-10-28.endive',
    sdk: 'stripe 23.1.0',
    reviewed: '2026-11-03',
    decision: 'adopted',
    notes:
      'No GA breaking changes on top of 2026-09-30.endive (the breaking rows are in the preview train), so ' +
      'moving to it means taking on the 09-30 changes above. Adopted in 2.0.0: apps replace ' +
      'payment_method_types with allowed_payment_method_types (or Dashboard payment method configurations) and ' +
      'pass billing_cycle_anchor as an object. None of the fields the readers use moved.'
  }),
  Object.freeze({
    version: '2026-11-18.endive',
    sdk: 'stripe 23.2.0',
    reviewed: '2026-11-23',
    decision: 'declined',
    notes:
      'No GA breaking changes: the one breaking 11-18 row (nullable microdeposit arrival dates) is in the ' +
      'preview train. The rest is additive (Refund.application, Charge funding_sources, Checkout automatic_tax ' +
      'address precision, PaymentIntent payment_details industry metadata, new Accounts v2 capabilities, PayPay ' +
      'fingerprint, a standard error code for blocked account creation), so the pin stays 2026-10-28.endive. ' +
      'https://docs.stripe.com/changelog'
  })
])
