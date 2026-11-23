import { describe, expect, it } from 'vitest'

import { centsToInput, formatCents, parseDollarsToCents } from '@coderizehq/format/money'

// A small seeded generator, so a failure names an amount that reproduces.
function* amounts(count, max, seed = 20261103) {
  let s = seed
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    const r = s / 2147483648
    yield Math.floor(r * max) * (i % 2 ? -1 : 1)
  }
}

describe('formatCents', () => {
  it('formats en-US with thousands separators and two places', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCents(100000000)).toBe('$1,000,000.00')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(99999)).toBe('$999.99')
  })

  it('puts the minus sign before the dollar sign', () => {
    expect(formatCents(-1234)).toBe('-$12.34')
    expect(formatCents(-5)).toBe('-$0.05')
    expect(formatCents(-123456789)).toBe('-$1,234,567.89')
    expect(formatCents(-0)).toBe('$0.00')
  })

  it('agrees with Intl currency formatting', () => {
    const intl = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    for (const cents of amounts(5000, 1e11)) expect(formatCents(cents)).toBe(intl.format(cents / 100))
  })

  it('drops .00 from whole dollars with fraction auto', () => {
    expect(formatCents(25000, { fraction: 'auto' })).toBe('$250')
    expect(formatCents(1250, { fraction: 'auto' })).toBe('$12.50')
    expect(formatCents(-100000, { fraction: 'auto' })).toBe('-$1,000')
  })

  it('rounds half away from zero to whole dollars with fraction never', () => {
    expect(formatCents(123450, { fraction: 'never' })).toBe('$1,235')
    expect(formatCents(123449, { fraction: 'never' })).toBe('$1,234')
    expect(formatCents(-150, { fraction: 'never' })).toBe('-$2')
    expect(formatCents(-40, { fraction: 'never' })).toBe('$0')
  })

  it('shows nothing for a missing amount', () => {
    expect(formatCents(null)).toBe('')
    expect(formatCents(undefined)).toBe('')
  })

  it('throws on a non-integer, which means dollars were passed where cents belong', () => {
    expect(() => formatCents(12.5)).toThrow(TypeError)
    expect(() => formatCents('1250')).toThrow(TypeError)
    expect(() => formatCents(Number.NaN)).toThrow(TypeError)
  })
})

describe('centsToInput', () => {
  it('writes an input value with no $ or commas', () => {
    expect(centsToInput(123456)).toBe('1234.56')
    expect(centsToInput(5)).toBe('0.05')
    expect(centsToInput(-1230)).toBe('-12.30')
    expect(centsToInput(null)).toBe('')
  })
})

describe('parseDollarsToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['.50', 50],
    ['0.05', 5],
    ['22.99', 2299],
    ['19.99', 1999],
    ['$1,234.56', 123456],
    ['1,234,567.89', 123456789],
    ['  $ 40  ', 4000],
    ['1234.56', 123456],
    ['0', 0],
  ])('reads %j as %i cents', (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents)
  })

  it.each([
    ['', 'empty'],
    ['$', 'no digits'],
    ['.', 'no digits'],
    ['12.', 'a trailing point'],
    ['1.234', 'three places: a European thousands separator?'],
    ['12.345', 'fractional cents'],
    ['1,23', 'a comma decimal?'],
    ['1234,567', 'misplaced grouping'],
    ['12,34.00', 'misplaced grouping'],
    ['1.2.3', 'two points'],
    ['1e3', 'an exponent'],
    ['12 dollars', 'words'],
    ['twelve', 'words'],
    ['+12', 'a plus sign'],
    ['(12.00)', 'accounting negative'],
    ['12-', 'a trailing sign'],
    ['$12$', 'two dollar signs'],
    ['-12', 'a negative, not allowed by default'],
    ['99999999999999999', 'too large to be exact'],
  ])('refuses %j (%s)', (input) => {
    expect(parseDollarsToCents(input)).toBeNull()
  })

  it('reads a negative only when asked', () => {
    expect(parseDollarsToCents('-12.34', { allowNegative: true })).toBe(-1234)
    expect(parseDollarsToCents('-$12.34', { allowNegative: true })).toBe(-1234)
    expect(parseDollarsToCents('$-12.34', { allowNegative: true })).toBe(-1234)
    expect(parseDollarsToCents('--12', { allowNegative: true })).toBeNull()
    expect(parseDollarsToCents('-$-12', { allowNegative: true })).toBeNull()
    expect(Object.is(parseDollarsToCents('-0', { allowNegative: true }), 0)).toBe(true)
  })

  it('takes only text, never a float', () => {
    expect(parseDollarsToCents(19.99)).toBeNull()
    expect(parseDollarsToCents(null)).toBeNull()
  })

  it('reads back what formatCents and centsToInput write', () => {
    for (const cents of amounts(5000, 1e11)) {
      expect(parseDollarsToCents(formatCents(cents), { allowNegative: true })).toBe(cents)
      expect(parseDollarsToCents(centsToInput(cents), { allowNegative: true })).toBe(cents)
    }
  })
})
