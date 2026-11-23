/*
  Header and body encodings for the MIME message (RFC 2045, RFC 2047, RFC 2231) and for the addresses SES
  takes on both paths. Everything that leaves here is 7-bit ASCII.
*/

export const CRLF = '\r\n'

/** Anything a header can't carry as it is: a control character (tab aside) or a non-ASCII one. */
export const NEEDS_ENCODING = /[^\t\x20-\x7e]/

// 42 bytes of UTF-8 is 56 characters of base64, so "Subject: " plus one encoded-word stays inside the
// 78-character line RFC 5322 asks for. 42 is a multiple of 3, so no word but the last carries padding.
const WORD_BYTES = 42

/**
 * RFC 2047 encoded-words (`=?UTF-8?B?...?=`) for `text`, split on character boundaries so no word cuts a
 * multi-byte character in half. Decoders drop the whitespace between adjacent encoded-words, so the
 * split is invisible to the reader. `separator` is CRLF plus a space (a folded header) by default; a
 * display name inside an address uses a plain space, because SES reads those as one line.
 * @param {string} text
 * @param {string} [separator]
 * @returns {string}
 */
export function encodedWords(text, separator = `${CRLF} `) {
  const words = []
  let word = ''
  let bytes = 0
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8')
    if (word && bytes + size > WORD_BYTES) {
      words.push(word)
      word = ''
      bytes = 0
    }
    word += char
    bytes += size
  }
  if (word) words.push(word)
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(separator)
}

/**
 * An unstructured header value (Subject, a custom header): line breaks become spaces, so a value can
 * never start a header of its own, and anything non-ASCII or too long for one line goes out as
 * encoded-words.
 * @param {string} value
 * @returns {string}
 */
export function headerValue(value) {
  const flat = String(value).replace(/[\r\n]+/g, ' ')
  return NEEDS_ENCODING.test(flat) || flat.length > 900 ? encodedWords(flat) : flat
}

/**
 * Base64 in lines of 76 characters joined by CRLF, as RFC 2045 requires of a base64 body. Longer lines
 * are legal nowhere, and a gateway that truncates them leaves a corrupt file.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base64Lines(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/.{76}(?=.)/g, `$&${CRLF}`)
}

/**
 * A MIME parameter value for a quoted-string: `"` and `\` escaped.
 * @param {string} value
 */
export function quoted(value) {
  return value.replace(/["\\]/g, '\\$&')
}

/**
 * RFC 2231 / RFC 5987 percent-encoding for `filename*=UTF-8''...`.
 * @param {string} value
 */
export function percentEncoded(value) {
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
