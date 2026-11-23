// The one rule for US phone numbers, promoted from xceptionalheroes-org-mono's @xh/phone. Rules
// only, so it runs in the browser, the API and an Astro build alike.
//
// Standard: no letters, and 10 digits, or 11 starting with 1 (the 1 is dropped), whatever
// punctuation sits between them, optionally followed by an extension (`x23`, `ext. 23`,
// `extension 23`, `#23`). A standard number is stored as its 10 digits (8105550100), or
// `8105550100x23` with an extension, and shown as (810) 555-0100 or (810) 555-0100 ext. 23.
// Anything else that isn't blank (too few or too many digits, words, two numbers in one field) is
// never guessed at: it is stored as typed, shown as typed, and reported by phoneStatus as TO_FIX.

export const PHONE_STATUS = Object.freeze({ BLANK: 'BLANK', CLEAR: 'CLEAR', TO_FIX: 'TO_FIX' })

const NOT_STANDARD = Object.freeze({ digits: '', extension: '', ok: false })
const EXTENSION = /\s*[,;]?\s*(?:x|ext\.?|extension|#)\s*(\d{1,6})\s*$/i

/**
 * The 10 digits and the extension of a standard number. `digits` and `extension` are empty
 * whenever `ok` is false, so a number the rule can't read is never half-used.
 * @param {unknown} input
 * @returns {{ digits: string, extension: string, ok: boolean }}
 */
export function normalizePhone(input) {
  if (input == null) return NOT_STANDARD
  let typed = String(input).trim()
  let extension = ''
  const ext = EXTENSION.exec(typed)
  if (ext) {
    extension = ext[1]
    typed = typed.slice(0, ext.index)
  }
  if (!typed || /\p{L}/u.test(typed)) return NOT_STANDARD
  let digits = typed.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return NOT_STANDARD
  return { digits, extension, ok: true }
}

/**
 * A stored standard number (`8105550100` or `8105550100x23`) as (810) 555-0100 [ext. 23].
 * Anything else comes back unchanged.
 * @param {unknown} stored
 * @returns {string}
 */
export function formatPhone(stored) {
  const value = String(stored ?? '')
  const parts = /^(\d{3})(\d{3})(\d{4})(?:x(\d{1,6}))?$/.exec(value)
  if (!parts) return value
  const main = `(${parts[1]}) ${parts[2]}-${parts[3]}`
  return parts[4] ? `${main} ext. ${parts[4]}` : main
}

/**
 * What a screen shows: a standard number formatted, anything else exactly as stored.
 * @param {unknown} value
 * @returns {string}
 */
export function displayPhone(value) {
  const { digits, extension, ok } = normalizePhone(value)
  if (!ok) return String(value ?? '')
  return formatPhone(extension ? `${digits}x${extension}` : digits)
}

/**
 * A tel: link for a standard number (RFC 3966, `tel:+18105550100;ext=23`), or null when there's
 * nothing certain to dial.
 * @param {unknown} value
 * @returns {string | null}
 */
export function phoneHref(value) {
  const { digits, extension, ok } = normalizePhone(value)
  if (!ok) return null
  return extension ? `tel:+1${digits};ext=${extension}` : `tel:+1${digits}`
}

/**
 * What to store for a typed number: its digits (plus `x` and the extension) when standard,
 * otherwise the typed text, trimmed. Anything that isn't a string (null, a missing field) is
 * passed back untouched, so a route keeps whatever it did with those before.
 * @template T
 * @param {T} value
 * @returns {T | string}
 */
export function phoneForSaving(value) {
  if (typeof value !== 'string') return value
  const { digits, extension, ok } = normalizePhone(value)
  if (!ok) return value.trim()
  return extension ? `${digits}x${extension}` : digits
}

/**
 * Whether two values are the same number: the same digits and extension, or, when the rule can't
 * read either, the same text once trimmed (blank and null alike).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function samePhone(a, b) {
  const x = normalizePhone(a)
  const y = normalizePhone(b)
  if (x.ok || y.ok) return x.digits === y.digits && x.extension === y.extension
  return String(a ?? '').trim() === String(b ?? '').trim()
}

/**
 * BLANK for nothing typed, CLEAR for a standard number, TO_FIX for anything else.
 * @param {unknown} value
 * @returns {'BLANK' | 'CLEAR' | 'TO_FIX'}
 */
export function phoneStatus(value) {
  if (value == null || !String(value).trim()) return PHONE_STATUS.BLANK
  return normalizePhone(value).ok ? PHONE_STATUS.CLEAR : PHONE_STATUS.TO_FIX
}

/**
 * Whether a stored value is a number someone typed that the rule can't read.
 * @param {unknown} value
 * @returns {boolean}
 */
export const phoneNeedsFixing = (value) => phoneStatus(value) === PHONE_STATUS.TO_FIX

/**
 * Formats an input as the user types: `(810`, `(810) 555`, `(810) 555-0100`. A leading 1 is the
 * country code (no US area code starts with 1) and is dropped; digits past ten are ignored, so
 * use a separate field for an extension.
 * @param {string} raw
 * @returns {string}
 */
export function formatPhoneAsTyped(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.startsWith('1')) digits = digits.slice(1)
  digits = digits.slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
