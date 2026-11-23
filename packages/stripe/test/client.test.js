import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { createStripe, STRIPE_API_VERSION } from '../index.js'

// Building a client makes no request, so none of this touches the network.
describe('createStripe', () => {
  it('pins the fleet API version', () => {
    expect(STRIPE_API_VERSION).toBe('2026-10-28.endive')
    expect(createStripe('sk_test_x').getApiField('version')).toBe(STRIPE_API_VERSION)
  })

  it('returns a stripe-node client with two network retries', () => {
    const stripe = createStripe('sk_test_x')
    expect(stripe).toBeInstanceOf(Stripe)
    expect(stripe.getMaxNetworkRetries()).toBe(2)
  })

  it('passes other options through', () => {
    const stripe = createStripe('sk_test_x', { maxNetworkRetries: 0, timeout: 20_000 })
    expect(stripe.getMaxNetworkRetries()).toBe(0)
    expect(stripe.getApiField('timeout')).toBe(20_000)
  })

  it('accepts the pin itself as apiVersion, for an app moving over', () => {
    expect(createStripe('sk_test_x', { apiVersion: STRIPE_API_VERSION }).getApiField('version')).toBe(
      STRIPE_API_VERSION
    )
  })

  it('refuses any other apiVersion', () => {
    expect(() => createStripe('sk_test_x', { apiVersion: '2026-08-26.dahlia' })).toThrow(/cannot be overridden/)
    expect(() => createStripe('sk_test_x', { apiVersion: '2026-09-30.endive' })).toThrow(/cannot be overridden/)
    expect(() => createStripe('sk_test_x', { apiVersion: null })).toThrow(/cannot be overridden/)
  })

  it('refuses a missing key, so an unset STRIPE_SECRET_KEY fails at startup', () => {
    expect(() => createStripe(undefined)).toThrow(/secret key is required/)
    expect(() => createStripe('')).toThrow(/secret key is required/)
  })

  it('lets stripe-node reject an option it does not know', () => {
    expect(() => createStripe('sk_test_x', { apiVerison: 'typo' })).toThrow(/Config object may only contain/)
  })
})
