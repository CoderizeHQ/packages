// Types for `@coderize/stripe/fees`, the browser-safe card-fee gross-up. Hand-written to match fees.js;
// test/types/consumer.ts type-checks them on every `pnpm test`.

export interface CardFee {
  /** The percentage part as a fraction: 0.029 for 2.9%. At most six decimal places. */
  rate: number
  /** The fixed part, in cents. */
  fixedCents: number
}

/** Stripe's standard US card pricing: 2.9% + 30 cents. */
export declare const US_CARD_FEE: Readonly<CardFee>

export interface GrossUp {
  /** What the org receives after the card fee. */
  netCents: number
  /** What covering the fee adds. */
  feeCents: number
  /** What to charge: `netCents + feeCents`. */
  totalCents: number
}

/** The total to charge so the org nets `netCents` after the card fee, rounded up to the cent. */
export declare function grossUpForCardFee(netCents: number, fee?: Partial<CardFee>): GrossUp

/** Just the fee `grossUpForCardFee` adds. */
export declare function cardFeeCents(netCents: number, fee?: Partial<CardFee>): number
