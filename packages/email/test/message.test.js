import { describe, expect, it } from 'vitest'

import { buildRawMessage, SendError } from '../index.js'

const base = { from: 'App <no-reply@example.com>', to: 'jane@example.com', subject: 'Hi', text: 'Hello' }
const refused = (extra) => {
  try {
    buildRawMessage({ ...base, ...extra })
  } catch (err) {
    expect(err).toBeInstanceOf(SendError)
    expect(err.kind).toBe('permanent')
    return err.message
  }
  throw new Error('expected the message to be refused')
}
const header = (extra, name) =>
  buildRawMessage({ ...base, ...extra })
    .toString()
    .match(new RegExp(`^${name}: (.*)\\r$`, 'm'))?.[1]

describe('addresses', () => {
  it.each([
    ['jane@example.com', 'jane@example.com'],
    ['  jane@example.com  ', 'jane@example.com'],
    ['Jane Doe <jane@example.com>', 'Jane Doe <jane@example.com>'],
    ['"Doe, Jane" <jane@example.com>', '"Doe, Jane" <jane@example.com>'],
    ['Doe, Jane <jane@example.com>', '"Doe, Jane" <jane@example.com>'],
    ['ACME "Ops" <ops@example.com>', '"ACME \\"Ops\\"" <ops@example.com>'],
    ['<x@evil.example> via DMARC.WS <noreply@dmarc.ws>', '"<x@evil.example> via DMARC.WS" <noreply@dmarc.ws>'],
    ['first.last+tag@sub.example.com', 'first.last+tag@sub.example.com'],
  ])('formats %j as %j', (input, expected) => {
    expect(header({ to: input }, 'To')).toBe(expected)
  })

  it.each([
    ['a list in one string', 'a@example.com, b@example.com'],
    ['no address', 'Jane Doe'],
    ['a line break', 'jane@example.com\r\nBcc: evil@example.com'],
    ['two at signs', 'a@b@example.com'],
    ['a non-string entry', ['a@example.com', 42]],
  ])('refuses %s', (_label, to) => {
    expect(refused({ to })).toMatch(/^Email not sent: to/)
  })

  it('names the field but never the value in the refusal', () => {
    const message = refused({ cc: ['ok@example.com', 'jane.secret.address'] })
    expect(message).toBe('Email not sent: cc[1] is not a single email address')
  })
})

describe('the message', () => {
  it.each([
    [{ subject: undefined }, /subject is required/],
    [{ subject: '   ' }, /subject is required/],
    [{ text: undefined }, /text or html is required/],
    [{ text: 42 }, /text must be a string/],
    [{ from: undefined }, /no from address/],
    [{ from: 42 }, /from must be a string/],
    [{ attachments: { filename: 'a.pdf' } }, /attachments must be a list/],
    [{ attachments: [{ filename: 'a.pdf' }] }, /content must be a Buffer/],
    [{ attachments: [{ content: Buffer.from('x') }] }, /filename is required/],
    [
      { attachments: [{ filename: 'a', content: Buffer.from('x'), contentType: 'text/html\r\nX: y' }] },
      /not a media type/,
    ],
    [{ configurationSet: 'coderize default' }, /configurationSet/],
  ])('refuses %j', (extra, reason) => {
    expect(refused(extra)).toMatch(reason)
  })

  it('takes the default from when the message has none', () => {
    expect(buildRawMessage({ ...base, from: undefined }, { from: 'alerts@thawwatch.com' }).toString()).toMatch(
      /^From: alerts@thawwatch\.com\r$/m,
    )
  })

  it('drops path parts and control characters from a filename', () => {
    const raw = buildRawMessage({
      ...base,
      attachments: [{ filename: '../../etc/pass\twd.txt', content: Buffer.from('x') }],
    }).toString()
    expect(raw).toContain('filename="passwd.txt"')
  })

  it('infers the media type from the extension, falling back to octet-stream', () => {
    const raw = buildRawMessage({
      ...base,
      attachments: [
        { filename: 'report.CSV', content: Buffer.from('a') },
        { filename: 'event.ics', content: Buffer.from('a') },
        { filename: 'blob.bin', content: Buffer.from('a') },
      ],
    }).toString()
    expect(raw).toContain('Content-Type: text/csv;')
    expect(raw).toContain('Content-Type: text/calendar;')
    expect(raw).toContain('Content-Type: application/octet-stream;')
  })
})

describe('custom headers', () => {
  it.each([
    [{ 'Bad Name': 'x' }, /not a valid field name/],
    [{ 'Bad:Name': 'x' }, /not a valid field name/],
    [{ Bcc: 'evil@example.com' }, /set by @coderizehq\/email/],
    [{ 'content-type': 'text/plain' }, /set by @coderizehq\/email/],
    [{ 'X-Tag': 'a\r\nBcc: evil@example.com' }, /line break/],
    [{ 'X-Tag': { nested: true } }, /must be a string/],
  ])('refuses %j', (headers, reason) => {
    expect(refused({ headers })).toMatch(reason)
  })

  it('encodes a non-ASCII value', () => {
    expect(header({ headers: { 'X-Campaign': 'Été' } }, 'X-Campaign')).toBe(
      `=?UTF-8?B?${Buffer.from('Été').toString('base64')}?=`,
    )
  })
})
