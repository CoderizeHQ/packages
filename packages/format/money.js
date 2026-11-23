// Money is integer cents everywhere: in the database, in the API and in the browser. Only a screen
// turns cents into dollars, and only an input box turns dollars back into cents. Nothing here
// multiplies or divides a float: `Math.round(parseFloat('19.99') * 100)` is 1999, but other
// amounts land a cent off, and 0.1 + 0.2 is not 0.3.

function checkCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`Expected integer cents, got ${cents}. A dollar amount must be converted to cents first.`)
  }
}

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * Cents for display, en-US: `$1,234.56`, and `-$12.34` for a negative amount.
 * @param {number | null | undefined} cents
 * @param {{ fraction?: 'always' | 'auto' | 'never' }} [options]
 *   always (default) shows two places; auto drops `.00` from a whole-dollar amount ($250, $12.50);
 *   never rounds to whole dollars, half away from zero ($1,235), for headline figures.
 * @returns {string} '' for null or undefined
 */
export function formatCents(cents, { fraction = 'always' } = {}) {
  if (cents == null) return ''
  checkCents(cents)
  const abs = Math.abs(cents)
  if (fraction === 'never') {
    const dollars = Math.floor((abs + 50) / 100)
    return `${cents < 0 && dollars > 0 ? '-' : ''}$${group(String(dollars))}`
  }
  const dollars = Math.floor(abs / 100)
  const rest = abs % 100
  const sign = cents < 0 ? '-' : ''
  if (fraction === 'auto' && rest === 0) return `${sign}$${group(String(dollars))}`
  return `${sign}$${group(String(dollars))}.${String(rest).padStart(2, '0')}`
}

/**
 * Cents as the text of an amount input: `1234.56`, no `$` and no commas, so the parser reads it back.
 * @param {number | null | undefined} cents
 * @returns {string} '' for null or undefined
 */
export function centsToInput(cents) {
  if (cents == null) return ''
  checkCents(cents)
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// Optional sign (before or after the $), optional $, then whole dollars either plain (1234) or
// grouped in threes (1,234), then up to two decimal places.
const AMOUNT = /^(-?)\s*(\$?)\s*(-?)(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/

/**
 * Typed dollars to integer cents, by string arithmetic. Accepts `12`, `12.5`, `12.50`, `.50`,
 * `$1,234.56` and `1234.56`. Returns null for anything it can't read exactly, rather than guess:
 * three decimal places (`1.234`, a European thousands separator?), misplaced commas (`1,23`),
 * a trailing point, words, exponents, more than one sign, or a negative unless `allowNegative`.
 * @param {string} input
 * @param {{ allowNegative?: boolean }} [options]
 * @returns {number | null}
 */
export function parseDollarsToCents(input, { allowNegative = false } = {}) {
  if (typeof input !== 'string') return null
  const match = AMOUNT.exec(input.trim())
  if (!match) return null
  const [, signBefore, dollarSign, signAfter, whole, fraction] = match
  if (whole == null && fraction == null) return null
  if (signAfter && !dollarSign) return null
  if (signBefore && signAfter) return null
  const negative = Boolean(signBefore || signAfter)
  if (negative && !allowNegative) return null

  const dollars = Number((whole ?? '0').replace(/,/g, ''))
  const cents = dollars * 100 + Number((fraction ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null
  return negative && cents !== 0 ? -cents : cents
}
