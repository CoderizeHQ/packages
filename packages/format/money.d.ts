/** Money as integer cents. */

/** Cents for display: `$1,234.56`, `-$12.34`. '' for null or undefined; throws on a non-integer. */
export declare function formatCents(
  cents: number | null | undefined,
  options?: { fraction?: 'always' | 'auto' | 'never' }
): string

/** Cents as the text of an amount input: `1234.56`. '' for null or undefined. */
export declare function centsToInput(cents: number | null | undefined): string

/** Typed dollars to integer cents, or null for anything it can't read exactly. */
export declare function parseDollarsToCents(input: string, options?: { allowNegative?: boolean }): number | null
