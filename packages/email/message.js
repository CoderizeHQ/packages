/*
  Turns what a caller passes to send() into one checked shape, or refuses it with a permanent SendError.
  Both paths (Simple and Raw) and the log transport read only the result, so a message that would fail in
  production fails the same way in development.

  Refusal messages name the field, never its value: they end up in logs, and the values are addresses
  and content.
*/
import { encodedWords, headerValue, NEEDS_ENCODING } from './encode.js'
import { SendError } from './sendError.js'

/**
 * @typedef {object} NormalMessage
 * @property {string} from
 * @property {string[]} to
 * @property {string[]} cc
 * @property {string[]} bcc
 * @property {string[]} replyTo
 * @property {string} subject
 * @property {string | undefined} text
 * @property {string | undefined} html
 * @property {Array<[string, string]>} headers
 * @property {Array<{ filename: string, contentType: string, content: Buffer }>} attachments
 * @property {string | undefined} configurationSet
 */

const invalid = (reason) => new SendError(`Email not sent: ${reason}`, 'permanent')

// What we write ourselves, on one path or the other. A custom header with one of these names would
// either be dropped by SES or give the message two of them.
const RESERVED_HEADERS = new Set([
  'bcc',
  'cc',
  'content-disposition',
  'content-transfer-encoding',
  'content-type',
  'from',
  'mime-version',
  'reply-to',
  'subject',
  'to',
])

// RFC 5322 field name: printable ASCII except the colon.
const HEADER_NAME = /^[!-9;-~]+$/
// The addr-spec only, ASCII: no spaces, no list separators, no brackets or quotes.
const ADDR_SPEC = /^[!#-'*+\-.-9=?A-Z^-~]+@[A-Za-z0-9.-]+$/
// A display name that needs no quoting: atext and spaces.
const PLAIN_NAME = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/
const CONFIGURATION_SET = /^[A-Za-z0-9_-]{1,64}$/
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

const TYPES = {
  csv: 'text/csv',
  gif: 'image/gif',
  html: 'text/html',
  ics: 'text/calendar',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  xml: 'application/xml',
  zip: 'application/zip',
}

/**
 * One address, ready for a header and for SES's address fields: `Name <addr>` or a bare `addr`. A
 * display name with specials is quoted; one with non-ASCII becomes encoded-words, which SES requires
 * in FromEmailAddress and the destination lists too.
 * @param {string} input
 * @param {string} field where it came from, for the refusal message
 * @returns {string}
 */
export function formatAddress(input, field) {
  const raw = input.trim()
  if (/[\r\n]/.test(raw)) throw invalid(`${field} contains a line break`)
  const bracketed = /^(.*)<([^<>]*)>$/s.exec(raw)
  const addr = (bracketed ? bracketed[2] : raw).trim()
  if (!ADDR_SPEC.test(addr)) throw invalid(`${field} is not a single email address`)

  let name = bracketed ? bracketed[1].trim() : ''
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  if (!name) return addr
  if (NEEDS_ENCODING.test(name)) return `${encodedWords(name, ' ')} <${addr}>`
  if (PLAIN_NAME.test(name)) return `${name} <${addr}>`
  return `"${name.replace(/["\\]/g, '\\$&')}" <${addr}>`
}

/**
 * `to`, `cc`, `bcc` or `replyTo`: one address or a flat list. Empty entries are dropped. A nested list
 * is refused rather than flattened, because it means a wrapper somewhere wrapped a list again (icrotary
 * lost 11 raffle notifications that way).
 * @param {unknown} value
 * @param {string} field
 * @returns {string[]}
 */
function addressList(value, field) {
  if (value === undefined || value === null || value === '') return []
  if (typeof value === 'string') return [formatAddress(value, field)]
  if (!Array.isArray(value)) throw invalid(`${field} must be an address or a list of addresses`)
  const out = []
  value.forEach((entry, i) => {
    if (Array.isArray(entry)) throw invalid(`${field} is a nested list: pass a flat list of addresses`)
    if (entry === undefined || entry === null || entry === '') return
    if (typeof entry !== 'string') throw invalid(`${field}[${i}] is not a string`)
    out.push(formatAddress(entry, `${field}[${i}]`))
  })
  return out
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string | undefined}
 */
function bodyPart(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw invalid(`${field} must be a string`)
  return value
}

/**
 * @param {unknown} headers
 * @returns {Array<[string, string]>}
 */
function headerList(headers) {
  if (headers === undefined || headers === null) return []
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw invalid('headers must be an object of header names to values')
  }
  return Object.entries(headers).map(([name, value]) => {
    if (!HEADER_NAME.test(name)) throw invalid(`header name ${JSON.stringify(name)} is not a valid field name`)
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      throw invalid(`header ${name} is set by @coderizehq/email: use the message field instead`)
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw invalid(`header ${name} must be a string`)
    const text = String(value)
    if (/[\r\n]/.test(text)) throw invalid(`header ${name} contains a line break`)
    return [name, headerValue(text)]
  })
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanFilename(value) {
  if (typeof value !== 'string') return ''
  // Control characters out (a tab or CR would break the header line), then only the last path segment.
  const printable = [...value].filter((c) => c >= ' ' && c !== '\x7f').join('')
  return (printable.split(/[/\\]/).pop() ?? '').trim()
}

/**
 * @param {unknown} attachment
 * @param {number} i
 */
function attachmentPart(attachment, i) {
  const field = `attachments[${i}]`
  if (!attachment || typeof attachment !== 'object') throw invalid(`${field} must be an object`)
  const { filename, content, contentType } = /** @type {Record<string, unknown>} */ (attachment)

  let bytes
  if (content instanceof Uint8Array) {
    bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  } else if (typeof content === 'string') {
    // Resend took base64 text, and callers moved from it still pass it. Anything else in a string (a CSV
    // written as text, say) would be decoded into garbage, so it is refused instead.
    const b64 = content.replace(/\s+/g, '')
    if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
      throw invalid(`${field}.content is a string but not base64: pass a Buffer for raw bytes`)
    }
    bytes = Buffer.from(b64, 'base64')
  } else {
    throw invalid(`${field}.content must be a Buffer, a Uint8Array or a base64 string`)
  }

  const name = cleanFilename(filename)
  if (!name) throw invalid(`${field}.filename is required`)

  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined
  const type = contentType ?? TYPES[/** @type {keyof typeof TYPES} */ (extension)] ?? 'application/octet-stream'
  if (typeof type !== 'string' || !MEDIA_TYPE.test(type.toLowerCase())) {
    throw invalid(`${field}.contentType is not a media type`)
  }
  return { filename: name, contentType: type.toLowerCase(), content: bytes }
}

/**
 * Checks and normalises a message. Returns null when `to` is empty, which `send()` reports as skipped.
 * @param {unknown} message
 * @param {{ from?: string, configurationSet?: string }} [defaults]
 * @returns {NormalMessage | null}
 */
export function normalizeMessage(message, defaults = {}) {
  if (!message || typeof message !== 'object') throw invalid('the message must be an object')
  const m = /** @type {Record<string, unknown>} */ (message)

  const to = addressList(m.to, 'to')
  if (to.length === 0) return null

  const fromInput = m.from ?? defaults.from
  if (fromInput === undefined || fromInput === null || fromInput === '') {
    throw invalid('no from address: pass `from` to createMailer() or to send()')
  }
  if (typeof fromInput !== 'string') throw invalid('from must be a string')

  if (typeof m.subject !== 'string' || m.subject.trim() === '') throw invalid('subject is required')
  const text = bodyPart(m.text, 'text')
  const html = bodyPart(m.html, 'html')
  if (!text && !html) throw invalid('text or html is required')

  if (m.attachments !== undefined && m.attachments !== null && !Array.isArray(m.attachments)) {
    throw invalid('attachments must be a list')
  }

  const configurationSet = m.configurationSet ?? defaults.configurationSet
  if (configurationSet !== undefined && configurationSet !== null && configurationSet !== '') {
    if (typeof configurationSet !== 'string' || !CONFIGURATION_SET.test(configurationSet)) {
      throw invalid('configurationSet is not a configuration set name')
    }
  }

  return {
    from: formatAddress(fromInput, 'from'),
    to,
    cc: addressList(m.cc, 'cc'),
    bcc: addressList(m.bcc, 'bcc'),
    replyTo: addressList(m.replyTo, 'replyTo'),
    // Line breaks in a subject come from interpolated data (a name, an org): fold them into spaces
    // rather than refuse the message, so they can never start a header of their own.
    subject: m.subject.replace(/[\r\n]+/g, ' '),
    text,
    html,
    headers: headerList(m.headers),
    attachments: /** @type {unknown[] | undefined} */ (m.attachments ?? []).map(attachmentPart),
    configurationSet: /** @type {string | undefined} */ (configurationSet || undefined),
  }
}
