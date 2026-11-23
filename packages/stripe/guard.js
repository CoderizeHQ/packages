/*
  The version guard an app runs in CI (`coderize-stripe-check`). No network, no keys, no database.

  It fails when the app's installed `stripe` defaults to an API version this release of the package
  has not reviewed, or when a client from createStripe would not send the pin. The first catches a
  Renovate bump that moves the SDK's default; the second catches a broken pin. When it fails, the fix is
  a release of this package that reviews the new default, never a local override.
*/
import Stripe from 'stripe'

import { buildStripe } from './client.js'
import { REVIEWED_SDK_DEFAULTS, STRIPE_API_VERSION } from './version.js'

// Dated versions have carried a release-train suffix since 2025 ("2026-08-26.dahlia"). A bare date is
// usually a half-copied string, and Stripe rejects it.
const FULL_VERSION = /^\d{4}-\d{2}-\d{2}\.[a-z]+$/

// Never sent anywhere: building a client makes no request.
const PLACEHOLDER_KEY = 'sk_test_coderize_stripe_check'

/**
 * @typedef {object} GuardCheck
 * @property {'pin-format' | 'sdk-default' | 'client-sends-pin'} id
 * @property {boolean} ok
 * @property {string} label
 * @property {Record<string, unknown>} detail
 */

/**
 * @typedef {object} GuardResult
 * @property {boolean} ok every check passed
 * @property {string | undefined} sdkVersion the installed stripe-node release
 * @property {string | undefined} sdkDefault the API version it sends when none is pinned
 * @property {GuardCheck[]} checks
 */

/**
 * Checks the app's installed `stripe` against this release's pin and reviewed defaults.
 * @param {{ Stripe?: typeof Stripe }} [options] `Stripe` is for tests: a stand-in for the SDK class
 * @returns {GuardResult}
 */
export function checkStripeVersion({ Stripe: StripeClass = Stripe } = {}) {
  const sdkVersion = StripeClass?.PACKAGE_VERSION
  const sdkDefault = StripeClass?.API_VERSION
  const reviewed = REVIEWED_SDK_DEFAULTS.map((r) => r.version)
  const checks = []

  checks.push({
    id: 'pin-format',
    ok: FULL_VERSION.test(STRIPE_API_VERSION),
    label: 'the pin is a full dated version with its release train',
    detail: { pinned: STRIPE_API_VERSION },
  })

  checks.push({
    id: 'sdk-default',
    ok: sdkDefault === STRIPE_API_VERSION || reviewed.includes(sdkDefault),
    label: 'the installed stripe SDK defaults to the pin, or to a version this release has reviewed',
    detail: { sdk: sdkVersion, sdkDefault, pinned: STRIPE_API_VERSION, reviewed },
  })

  let sent
  let error
  try {
    sent = buildStripe(StripeClass, PLACEHOLDER_KEY).getApiField('version')
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  checks.push({
    id: 'client-sends-pin',
    ok: sent === STRIPE_API_VERSION,
    label: 'a client from createStripe sends the pin',
    detail: error ? { pinned: STRIPE_API_VERSION, error } : { pinned: STRIPE_API_VERSION, sent },
  })

  return { ok: checks.every((c) => c.ok), sdkVersion, sdkDefault, checks }
}
