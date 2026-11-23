// "Cover the processing fee": the amount to charge so that, after Stripe's card fee, the org nets
// what was asked for. ONE function for the price a page shows and the price the API charges, so the
// two can't disagree. icrotary computed the display in float dollars and the charge in integer
// cents, and 387 of the 500,000 amounts from $0.01 to $5,000.00 showed a fee 1 cent higher than
// the card was charged.
//
// No imports: this file loads in the browser without the Stripe SDK (`@coderize/stripe/fees`).
//
// The math: Stripe keeps `total * rate + fixed`, so netting `net` needs
//   total = (net + fixed) / (1 - rate)
// rounded UP to the cent, which is what icrotary's server and imlay's feeCalc charge, so the org
// is never a cent short. It runs in integer arithmetic (BigInt) on the rate in parts per million;
// floating point can land a hair over a whole cent and round a cent too far.

/** Stripe's standard US card pricing: 2.9% + 30 cents. */
export const US_CARD_FEE = Object.freeze({ rate: 0.029, fixedCents: 30 })

const PPM = 1_000_000

function checkCents(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number of cents, 0 or more, got ${value}`)
  }
}

/**
 * The total to charge so the org nets `netCents` after the card fee, and the fee that adds.
 * @param {number} netCents what the org should receive, in integer cents
 * @param {{ rate?: number, fixedCents?: number }} [fee] defaults to US_CARD_FEE (2.9% + 30¢);
 *   `rate` is a fraction (0.029) with at most six decimal places
 * @returns {{ netCents: number, feeCents: number, totalCents: number }}
 */
export function grossUpForCardFee(netCents, { rate = US_CARD_FEE.rate, fixedCents = US_CARD_FEE.fixedCents } = {}) {
  checkCents('netCents', netCents)
  checkCents('fixedCents', fixedCents)
  const ppm = Math.round(rate * PPM)
  if (!(rate >= 0 && rate < 1) || Math.abs(rate * PPM - ppm) > 1e-6) {
    throw new RangeError(`rate must be a fraction from 0 up to 1 with at most six decimal places, got ${rate}`)
  }
  const numerator = BigInt(netCents + fixedCents) * BigInt(PPM)
  const denominator = BigInt(PPM - ppm)
  const totalCents = Number((numerator + denominator - 1n) / denominator)
  if (!Number.isSafeInteger(totalCents)) throw new RangeError(`netCents is too large: ${netCents}`)
  return { netCents, feeCents: totalCents - netCents, totalCents }
}

/**
 * Just the fee `grossUpForCardFee` adds, for a "processing fee" line.
 * @param {number} netCents
 * @param {{ rate?: number, fixedCents?: number }} [fee]
 * @returns {number}
 */
export function cardFeeCents(netCents, fee) {
  return grossUpForCardFee(netCents, fee).feeCents
}
