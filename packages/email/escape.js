const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * Escapes a value for HTML text or a quoted attribute (`"` and `'` both). `null` and `undefined` become an
 * empty string rather than the word "null"; anything else goes through `String()`.
 *
 * Use it on every value an email template interpolates into its HTML. The plain-text body keeps the raw
 * value. A URL in `href` needs more than this: escape it, and only after checking it is http(s).
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[/** @type {keyof typeof HTML_ESCAPES} */ (c)])
}
