/** The one rule for US phone numbers: 10 digits, an optional extension, never a guess. */

export declare const PHONE_STATUS: Readonly<{ BLANK: 'BLANK'; CLEAR: 'CLEAR'; TO_FIX: 'TO_FIX' }>

export type PhoneStatus = 'BLANK' | 'CLEAR' | 'TO_FIX'

/** The 10 digits and extension of a standard number; both empty when `ok` is false. */
export declare function normalizePhone(input: unknown): { digits: string; extension: string; ok: boolean }

/** A stored number (`8105550100`, `8105550100x23`) as `(810) 555-0100 ext. 23`; anything else unchanged. */
export declare function formatPhone(stored: unknown): string

/** A standard number formatted, anything else exactly as stored. */
export declare function displayPhone(value: unknown): string

/** `tel:+18105550100` (`;ext=23` with an extension), or null. */
export declare function phoneHref(value: unknown): string | null

/** What to store: the digits (`x` and the extension) when standard, otherwise the typed text trimmed. */
export declare function phoneForSaving<T>(value: T): T | string

/** Whether two values are the same number. */
export declare function samePhone(a: unknown, b: unknown): boolean

export declare function phoneStatus(value: unknown): PhoneStatus

export declare function phoneNeedsFixing(value: unknown): boolean

/** `(810) 555-0100` as the user types. */
export declare function formatPhoneAsTyped(raw: string): string
