import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { cardFeeCents, grossUpForCardFee, US_CARD_FEE } from '@coderizehq/stripe/fees'

// The formulas the fleet ran before this package, kept here as the reference.
// icrotary's server (api/src/lib/stripe.js calculateProcessingFee), which charges the card. The truth.
const icrotaryServer = (cents) => Math.ceil((cents + 30) / (1 - 0.029) - cents)
// icrotary's pages (PayInvoice, RaffleTicketForm, LunchCredits), in float dollars.
const icrotaryDisplay = (dollars) => Math.ceil(((dollars + 0.3) / (1 - 0.029) - dollars) * 100) / 100
// imlay's packages/utils feeCalc.js grossForTargetCents.
const imlayFee = (cents) => Math.ceil((cents + 30) / (1 - 0.029)) - cents
// refugelapeer's and xceptionalheroes' api/src/lib/fees.js grossUpForCardFee.
const roundedFee = (cents) => Math.round((cents + 30) / (1 - 0.029)) - cents

const MAX = 500_000 // $0.01 to $5,000.00, every cent

// A seeded generator for amounts past the exhaustive range, so a failure names one that reproduces.
function* amounts(count, max, seed = 20261103) {
  let s = seed
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    yield Math.floor((s / 2147483648) * max)
  }
}

describe('grossUpForCardFee', () => {
  it('grosses up $50 to $51.81 at 2.9% + 30¢', () => {
    expect(grossUpForCardFee(5000)).toEqual({ netCents: 5000, feeCents: 181, totalCents: 5181 })
    expect(cardFeeCents(7500)).toBe(255)
    expect(US_CARD_FEE).toEqual({ rate: 0.029, fixedCents: 30 })
  })

  it('gives the page and the server the same fee for every amount up to $5,000', () => {
    // The display path (cardFeeCents) and the server path (grossUpForCardFee) are one function, and it
    // charges exactly what icrotary's server charged.
    for (let cents = 1; cents <= MAX; cents++) {
      const { feeCents, totalCents } = grossUpForCardFee(cents)
      if (cardFeeCents(cents) !== feeCents || feeCents !== icrotaryServer(cents) || totalCents !== cents + feeCents) {
        throw new Error(`${cents}¢: page ${cardFeeCents(cents)}, server ${feeCents}, icrotary ${icrotaryServer(cents)}`)
      }
    }
  })

  it('keeps agreeing with the server formula on large amounts', () => {
    for (const cents of amounts(20_000, 1e9)) expect(cardFeeCents(cents)).toBe(icrotaryServer(cents))
  })

  it('fixes the 387 amounts where icrotary showed a fee 1¢ higher than it charged', () => {
    const disagreed = []
    for (let cents = 1; cents <= MAX; cents++) {
      if (Math.round(icrotaryDisplay(cents / 100) * 100) !== cardFeeCents(cents)) disagreed.push(cents)
    }
    expect(disagreed).toHaveLength(387)
    expect(disagreed.slice(0, 3)).toEqual([941, 1912, 2883])
    expect(cardFeeCents(941)).toBe(59)
  })

  it('matches imlay, and charges 1¢ more than refuge and XH on about half of amounts', () => {
    // Plain checks in the loop: 500,000 expect() calls ran past the 5 s timeout on GitHub's runners.
    let roundedLower = 0
    for (let cents = 1; cents <= MAX; cents++) {
      const fee = cardFeeCents(cents)
      if (imlayFee(cents) !== fee) throw new Error(`${cents}¢: imlay ${imlayFee(cents)}, package ${fee}`)
      const rounded = roundedFee(cents)
      if (rounded !== fee) {
        if (fee - rounded !== 1) throw new Error(`${cents}¢: rounded ${rounded}, package ${fee}`)
        roundedLower++
      }
    }
    expect(roundedLower).toBe(249_742)
  })

  it('never leaves the org short once Stripe takes its fee, and never charges a cent more than needed', () => {
    for (let cents = 1; cents <= MAX; cents++) {
      const { totalCents } = grossUpForCardFee(cents)
      // Stripe rounds its own fee to the nearest cent.
      const stripeKeeps = Math.round(totalCents * 0.029) + 30
      if (totalCents - stripeKeeps < cents) throw new Error(`${cents}¢ nets ${totalCents - stripeKeeps}¢`)
      // One cent less would not cover the fee in exact arithmetic: (total - 1) * 0.971 - 30 < net.
      if ((totalCents - 1) * 971 - 30_000 >= cents * 1000) throw new Error(`${cents}¢ overcharged at ${totalCents}¢`)
    }
  })

  it('takes another rate and fixed fee', () => {
    // A 2.2% + 30¢ nonprofit rate.
    expect(grossUpForCardFee(10000, { rate: 0.022, fixedCents: 30 })).toEqual({
      netCents: 10000,
      feeCents: 256,
      totalCents: 10256,
    })
    expect(grossUpForCardFee(10000, { rate: 0, fixedCents: 0 }).feeCents).toBe(0)
    expect(cardFeeCents(10000, { rate: 0.035 })).toBe(cardFeeCents(10000, { rate: 0.035, fixedCents: 30 }))
  })

  it('refuses amounts that are not whole cents and rates it cannot apply exactly', () => {
    expect(() => grossUpForCardFee(12.5)).toThrow(RangeError)
    expect(() => grossUpForCardFee(-100)).toThrow(RangeError)
    expect(() => grossUpForCardFee('5000')).toThrow(RangeError)
    expect(() => grossUpForCardFee(5000, { fixedCents: 0.3 })).toThrow(RangeError)
    expect(() => grossUpForCardFee(5000, { rate: 2.9 })).toThrow(RangeError)
    expect(() => grossUpForCardFee(5000, { rate: 1 })).toThrow(RangeError)
    expect(() => grossUpForCardFee(5000, { rate: 0.0290001 })).toThrow(RangeError)
    expect(() => grossUpForCardFee(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })
})

describe('@coderizehq/stripe/fees in the browser', () => {
  it('imports nothing, so a page loads it without the Stripe SDK', async () => {
    const source = await readFile(new URL('../fees.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^\s*import\s|\bimport\(|\brequire\(/m)
    expect(source).not.toMatch(/\bprocess\.|\bBuffer\b/)
  })
})
