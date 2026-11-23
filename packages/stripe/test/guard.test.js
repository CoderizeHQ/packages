// The guard is modelled on xceptionalheroes-org-mono, apps/api/scripts/verify-stripe-config.mjs, and the pin
// value on its lib/stripeVersion.js and gronetworking-com-mono's util/stripeVersion.js.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { checkStripeVersion, REVIEWED_SDK_DEFAULTS, STRIPE_API_VERSION } from '../index.js'

/** A stand-in for the stripe-node class with a chosen default, sending what it is given. */
function fakeSdk(apiDefault, { sends } = {}) {
  return class FakeStripe {
    static PACKAGE_VERSION = '99.0.0'
    static API_VERSION = apiDefault
    constructor(key, config) {
      this.version = sends ?? config?.apiVersion ?? apiDefault
    }
    getApiField(field) {
      return field === 'version' ? this.version : undefined
    }
  }
}

const byId = (result) => Object.fromEntries(result.checks.map((c) => [c.id, c.ok]))

describe('checkStripeVersion', () => {
  it('passes on the installed SDK, whose default this release reviewed', () => {
    const result = checkStripeVersion()
    expect(result.sdkVersion).toBe(Stripe.PACKAGE_VERSION)
    expect(result.sdkDefault).toBe(Stripe.API_VERSION)
    expect(result.ok).toBe(true)
  })

  it('accepts each reviewed default, and an SDK that defaults to the pin', () => {
    for (const { version } of REVIEWED_SDK_DEFAULTS) {
      expect(checkStripeVersion({ Stripe: fakeSdk(version) }).ok, version).toBe(true)
    }
    expect(checkStripeVersion({ Stripe: fakeSdk(STRIPE_API_VERSION) }).ok).toBe(true)
  })

  it('fails when the SDK defaults to a version nobody reviewed', () => {
    const result = checkStripeVersion({ Stripe: fakeSdk('2027-01-27.fig') })
    expect(result.ok).toBe(false)
    expect(byId(result)).toEqual({ 'pin-format': true, 'sdk-default': false, 'client-sends-pin': true })
    expect(result.checks.find((c) => c.id === 'sdk-default').detail).toMatchObject({
      sdk: '99.0.0',
      sdkDefault: '2027-01-27.fig',
      pinned: STRIPE_API_VERSION,
    })
  })

  it('fails on an SDK that defaults to the 1.x pin, which this release never reviewed', () => {
    const result = checkStripeVersion({ Stripe: fakeSdk('2026-08-26.dahlia') })
    expect(byId(result)).toEqual({ 'pin-format': true, 'sdk-default': false, 'client-sends-pin': true })
  })

  it('fails when a client from createStripe does not send the pin', () => {
    const result = checkStripeVersion({ Stripe: fakeSdk('2026-10-28.endive', { sends: '2026-08-26.dahlia' }) })
    expect(byId(result)).toEqual({ 'pin-format': true, 'sdk-default': true, 'client-sends-pin': false })
  })

  it('reports a client that cannot be built instead of throwing', () => {
    class Broken {
      static API_VERSION = '2026-10-28.endive'
      constructor() {
        throw new Error('boom')
      }
    }
    const result = checkStripeVersion({ Stripe: Broken })
    expect(result.ok).toBe(false)
    expect(result.checks.find((c) => c.id === 'client-sends-pin').detail.error).toBe('boom')
  })

  it('records why each reviewed default was decided', () => {
    for (const entry of REVIEWED_SDK_DEFAULTS) {
      expect(entry.version).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/)
      expect(['adopted', 'declined']).toContain(entry.decision)
      expect(entry.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.notes.length).toBeGreaterThan(20)
      expect(Object.isFrozen(entry)).toBe(true)
    }
    expect(Object.isFrozen(REVIEWED_SDK_DEFAULTS)).toBe(true)
  })

  it('marks the pin itself as the adopted review', () => {
    const adopted = REVIEWED_SDK_DEFAULTS.filter((r) => r.decision === 'adopted').map((r) => r.version)
    expect(adopted).toEqual([STRIPE_API_VERSION])
  })
})

describe('coderize-stripe-check', () => {
  it('exits 0 and prints three passes on the installed SDK', async () => {
    const cli = fileURLToPath(new URL('../cli.js', import.meta.url))
    const { stdout } = await promisify(execFile)(process.execPath, [cli])
    expect(stdout.match(/PASS/g)).toHaveLength(3)
    expect(stdout).toContain('3 passed, 0 failed')
  })
})
