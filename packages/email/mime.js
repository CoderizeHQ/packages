/*
  The raw MIME message for a send with attachments (RFC 2045/2046):

    multipart/mixed
      multipart/alternative    (or a single text/plain or text/html part)
        text/plain             base64
        text/html              base64
      attachment, one each     base64, 76-character lines

  Every line ends in CRLF, every header is 7-bit (RFC 2047 for a non-ASCII subject, display name or
  header value), and every body part is base64, so no line comes near the 998-octet limit whatever the
  HTML looks like. Bcc is never written here: SES gets it in the envelope only, which is what keeps it
  blind.

  Why not SES's Simple.Attachments: PDFs sent that way opened blank in real mail clients (icrotary,
  2026-07), and binaries go out as text unless each attachment says ContentTransferEncoding: 'BASE64'.
  icrotary-com-mono's buildRawMessage is the fleet reference this follows.
*/
import { randomUUID } from 'node:crypto'

import { base64Lines, CRLF, encodedWords, headerValue, NEEDS_ENCODING, percentEncoded, quoted } from './encode.js'
import { normalizeMessage } from './message.js'
import { SendError } from './sendError.js'

/**
 * @param {string} type
 * @param {string} text
 * @returns {string[]}
 */
function textPart(type, text) {
  return [
    `Content-Type: ${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(text, 'utf8')),
  ]
}

/**
 * @param {'alternative' | 'mixed'} subtype
 * @param {string[][]} parts
 * @returns {string[]}
 */
function multipart(subtype, parts) {
  // "=_" can't occur in base64 text, so the boundary can't collide with a part's content.
  const boundary = `=_${subtype}_${randomUUID()}`
  const lines = [`Content-Type: multipart/${subtype};${CRLF} boundary="${boundary}"`, '']
  for (const part of parts) lines.push(`--${boundary}`, ...part)
  lines.push(`--${boundary}--`)
  return lines
}

/**
 * @param {{ filename: string, contentType: string, content: Buffer }} attachment
 * @returns {string[]}
 */
function attachmentPart({ filename, contentType, content }) {
  const ascii = !NEEDS_ENCODING.test(filename)
  // RFC 2047 words inside the quoted name are what Gmail and Outlook read; filename* (RFC 2231) is the
  // standard form, for the clients that prefer it.
  const name = ascii ? quoted(filename) : encodedWords(filename, ' ')
  const disposition = [`Content-Disposition: attachment;${CRLF} filename="${name}"`]
  if (!ascii) disposition.push(`;${CRLF} filename*=UTF-8''${percentEncoded(filename)}`)
  return [
    `Content-Type: ${contentType};${CRLF} name="${name}"`,
    'Content-Transfer-Encoding: base64',
    disposition.join(''),
    '',
    base64Lines(content),
  ]
}

/**
 * The raw message for a normalised message.
 * @param {import('./message.js').NormalMessage} m
 * @returns {Buffer}
 */
export function renderRaw(m) {
  const lines = [`From: ${m.from}`, `To: ${m.to.join(`,${CRLF} `)}`]
  if (m.cc.length) lines.push(`Cc: ${m.cc.join(`,${CRLF} `)}`)
  if (m.replyTo.length) lines.push(`Reply-To: ${m.replyTo.join(`,${CRLF} `)}`)
  lines.push(`Subject: ${headerValue(m.subject)}`, 'MIME-Version: 1.0')
  for (const [name, value] of m.headers) lines.push(`${name}: ${value}`)

  const bodies = []
  if (m.text) bodies.push(textPart('text/plain', m.text))
  if (m.html) bodies.push(textPart('text/html', m.html))
  const body = bodies.length === 2 ? multipart('alternative', bodies) : bodies[0]
  lines.push(...(m.attachments.length ? multipart('mixed', [body, ...m.attachments.map(attachmentPart)]) : body))

  return Buffer.from(`${lines.join(CRLF)}${CRLF}`, 'utf8')
}

/**
 * Builds the raw MIME message `send()` hands SES for a message with attachments: the same input as
 * `send()`, checked the same way. Exported for apps that need the bytes themselves (an .eml download, a
 * test); sending goes through `send()`.
 * @param {object} message
 * @param {{ from?: string }} [defaults]
 * @returns {Buffer}
 */
export function buildRawMessage(message, defaults) {
  const normal = normalizeMessage(message, defaults)
  if (!normal) throw new SendError('Email not sent: to is required', 'permanent')
  return renderRaw(normal)
}
