import Stripe from 'stripe'

import { STRIPE_API_VERSION } from './version.js'

/**
 * stripe 23 already defaults `maxNetworkRetries` to 2 and adds an idempotency key to every v1 POST, so a
 * retried create can't double-charge. Set here anyway so the client keeps two retries if a later SDK
 * changes its default.
 */
const DEFAULT_MAX_NETWORK_RETRIES = 2

/**
 * A Stripe client on the fleet's pinned API version, with two network retries. Build it once per app
 * (a Fastify plugin's decorator, or a module-level singleton) and reuse it.
 *
 * Any other stripe-node option passes through (`timeout`, `maxNetworkRetries`, `stripeAccount`,
 * `httpClient`, `appInfo` and so on), but `apiVersion` is refused unless it is the pin itself: an app
 * that needs another version needs another major release of this package, not a local override.
 * @param {string} secretKey `STRIPE_SECRET_KEY`
 * @param {Omit<import('stripe').Stripe.StripeConfig, 'apiVersion'> & { apiVersion?: string }} [options]
 * @returns {import('stripe').Stripe}
 */
export function createStripe(secretKey, options) {
  return buildStripe(Stripe, secretKey, options)
}

/**
 * `createStripe` against a given Stripe class, so the version guard can check a stubbed SDK.
 * @param {typeof Stripe} StripeClass
 * @param {string} secretKey
 * @param {object} [options]
 */
export function buildStripe(StripeClass, secretKey, options = {}) {
  if (typeof secretKey !== 'string' || secretKey === '') {
    throw new TypeError('createStripe: a secret key is required (STRIPE_SECRET_KEY is empty or unset)')
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createStripe: options must be an object')
  }
  if (options.apiVersion !== undefined && options.apiVersion !== STRIPE_API_VERSION) {
    throw new TypeError(
      `createStripe: apiVersion is pinned to ${STRIPE_API_VERSION} by @coderizehq/stripe and cannot be ` +
        `overridden (got ${JSON.stringify(options.apiVersion)}). Moving the version is a major release of the package.`,
    )
  }
  return new StripeClass(secretKey, {
    maxNetworkRetries: DEFAULT_MAX_NETWORK_RETRIES,
    ...options,
    apiVersion: STRIPE_API_VERSION,
  })
}
