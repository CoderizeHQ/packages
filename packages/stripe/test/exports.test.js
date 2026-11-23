import { readdir, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const EXPORTS = [
  'REVIEWED_SDK_DEFAULTS',
  'STRIPE_API_VERSION',
  'StripeWebhookError',
  'StripeWebhookHandlerError',
  'checkStripeVersion',
  'checkoutShipping',
  'createStripe',
  'handleStripeWebhook',
  'invoiceChargeId',
  'invoicePaymentIntentId',
  'invoicePeriodStart',
  'invoiceSubscriptionId',
  'prismaEventStore',
  'processEventOnce',
  'routeEvent',
  'subscriptionPeriod',
  'verifyWebhook',
]

const FEES_EXPORTS = ['US_CARD_FEE', 'cardFeeCents', 'grossUpForCardFee']

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')

describe('package exports', () => {
  it('serves everything from the main entry', async () => {
    const pkg = await import('@coderizehq/stripe')
    expect(Object.keys(pkg).sort()).toEqual(EXPORTS)
  })

  it('declares a type for every runtime export', async () => {
    const types = await read('index.d.ts')
    const declared = [...types.matchAll(/^export declare (?:const|function|class) (\w+)/gm)].map((m) => m[1])
    expect(declared.sort()).toEqual(EXPORTS)
  })

  it('publishes every module, the types and the CLI', async () => {
    const pkg = JSON.parse(await read('package.json'))
    const modules = (await readdir(new URL('..', import.meta.url))).filter((f) => /\.(js|d\.ts)$/.test(f))
    for (const file of modules) expect(pkg.files).toContain(file)
    expect(pkg.bin['coderize-stripe-check']).toBe('./cli.js')
    expect(pkg.exports['.'].types).toBe('./index.d.ts')
  })

  it('serves the card-fee gross-up from ./fees, with its own types, and not from the main entry', async () => {
    const fees = await import('@coderizehq/stripe/fees')
    expect(Object.keys(fees).sort()).toEqual(FEES_EXPORTS)
    const types = await read('fees.d.ts')
    const declared = [...types.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1])
    expect(declared.sort()).toEqual(FEES_EXPORTS)
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.exports['./fees']).toEqual({ types: './fees.d.ts', default: './fees.js' })
    expect(Object.keys(await import('@coderizehq/stripe'))).not.toContain('grossUpForCardFee')
  })

  it('keeps stripe a peer, so each app keeps its own SDK', async () => {
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.peerDependencies.stripe).toBe('^23.0.0')
    expect(pkg.dependencies?.stripe).toBeUndefined()
  })

  it('starts the CLI with a node shebang', async () => {
    expect((await read('cli.js')).startsWith('#!/usr/bin/env node\n')).toBe(true)
  })
})
