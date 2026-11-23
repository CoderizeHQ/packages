import PostalMime from 'postal-mime'
import { describe, expect, it } from 'vitest'

import { buildRawMessage, createMailer } from '../index.js'
import { fakeLogger, fakeSes, fixture, SES_ENV } from './helpers.js'

const pdf = fixture('sample.pdf')
const png = fixture('sample.png')

const base = {
  from: 'TakeUrOwn <no-reply@takeurown.com>',
  to: ['jane@example.com', 'Bob Smith <bob@example.com>'],
  replyTo: 'organizer@example.com',
  subject: 'Your invoice',
  text: 'Your invoice is attached.',
  html: '<p>Your invoice is attached.</p>',
}

/** The raw message as SES would receive it from send(). */
async function sentRaw(message) {
  const client = fakeSes()
  await createMailer({ client, logger: fakeLogger(), env: SES_ENV }).send(message)
  return Buffer.from(client.input().Content.Raw.Data)
}

/**
 * The body of the one part whose headers match `header`, decoded from base64 by hand: a check that
 * does not depend on any MIME library.
 */
function partBody(raw, header) {
  const text = raw.toString('latin1')
  const start = text.indexOf(header)
  expect(start).toBeGreaterThan(-1)
  const bodyStart = text.indexOf('\r\n\r\n', start) + 4
  const bodyEnd = text.indexOf('\r\n--', bodyStart)
  return Buffer.from(text.slice(bodyStart, bodyEnd), 'base64')
}

describe('the round trip', () => {
  it('fixtures are real binaries with bytes above 0x7F', () => {
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    for (const file of [pdf, png]) expect(file.some((b) => b > 0x7f)).toBe(true)
  })

  it('decodes each attachment byte for byte identical to the source', async () => {
    const raw = await sentRaw({
      ...base,
      attachments: [
        { filename: 'invoice-1042.pdf', content: pdf },
        { filename: 'ticket.png', content: png, contentType: 'image/png' },
      ],
    })

    const parsed = await PostalMime.parse(raw)
    expect(parsed.attachments.map((a) => [a.filename, a.mimeType, a.disposition])).toEqual([
      ['invoice-1042.pdf', 'application/pdf', 'attachment'],
      ['ticket.png', 'image/png', 'attachment'],
    ])
    expect(Buffer.from(parsed.attachments[0].content).equals(pdf)).toBe(true)
    expect(Buffer.from(parsed.attachments[1].content).equals(png)).toBe(true)

    // And again without the parser.
    expect(partBody(raw, 'name="invoice-1042.pdf"').equals(pdf)).toBe(true)
    expect(partBody(raw, 'name="ticket.png"').equals(png)).toBe(true)
  })

  it('takes base64 strings as Resend did, and refuses a string that is not base64', async () => {
    const raw = await sentRaw({ ...base, attachments: [{ filename: 'a.pdf', content: pdf.toString('base64') }] })
    const parsed = await PostalMime.parse(raw)
    expect(Buffer.from(parsed.attachments[0].content).equals(pdf)).toBe(true)

    expect(() =>
      buildRawMessage({ ...base, attachments: [{ filename: 'a.csv', content: 'name,total\nJane,5\n' }] }),
    ).toThrow(/not base64: pass a Buffer/)
  })

  it('keeps the text and html bodies, and the headers, intact', async () => {
    const raw = await sentRaw({ ...base, attachments: [{ filename: 'a.pdf', content: pdf }] })
    const parsed = await PostalMime.parse(raw)
    expect(parsed.from).toEqual({ name: 'TakeUrOwn', address: 'no-reply@takeurown.com' })
    expect(parsed.to).toEqual([
      { name: '', address: 'jane@example.com' },
      { name: 'Bob Smith', address: 'bob@example.com' },
    ])
    expect(parsed.replyTo).toEqual([{ name: '', address: 'organizer@example.com' }])
    expect(parsed.subject).toBe('Your invoice')
    expect(parsed.text).toBe('Your invoice is attached.')
    expect(parsed.html).toBe('<p>Your invoice is attached.</p>')
  })
})

describe('the wire format', () => {
  const raw = buildRawMessage({
    ...base,
    html: `<table>${'<tr><td>row</td></tr>'.repeat(400)}</table>`,
    attachments: [{ filename: 'invoice.pdf', content: pdf }],
  })
  const lines = raw.toString('latin1').split('\r\n')

  it('ends every line in CRLF, with no bare CR or LF', () => {
    expect(raw.toString('latin1')).not.toMatch(/\r(?!\n)|(?<!\r)\n/)
    expect(raw.subarray(-2).toString()).toBe('\r\n')
  })

  it('is 7-bit, with no line over 78 characters and base64 lines of at most 76', () => {
    expect(raw.every((b) => b < 0x80)).toBe(true)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78)
    const base64Lines = lines.filter((l) => /^[A-Za-z0-9+/]+=*$/.test(l) && l.length > 20)
    expect(base64Lines.length).toBeGreaterThan(10)
    for (const line of base64Lines) expect(line.length).toBeLessThanOrEqual(76)
  })

  it('nests multipart/alternative inside multipart/mixed, every part base64', () => {
    const text = raw.toString('latin1')
    expect(text).toMatch(/^Content-Type: multipart\/mixed;\r\n boundary="=_mixed_[0-9a-f-]{36}"\r$/m)
    expect(text).toMatch(/^Content-Type: multipart\/alternative;\r\n boundary="=_alternative_[0-9a-f-]{36}"\r$/m)
    expect(text.match(/^Content-Transfer-Encoding: base64\r$/gm)).toHaveLength(3)
    expect(text).toMatch(/^MIME-Version: 1\.0\r$/m)
  })

  it('sends a single body part when there is only text or only html', async () => {
    const parsed = await PostalMime.parse(
      buildRawMessage({ ...base, html: undefined, attachments: [{ filename: 'a.pdf', content: pdf }] }),
    )
    expect(parsed.text).toBe('Your invoice is attached.')
    expect(parsed.html).toBeUndefined()
    expect(
      buildRawMessage({ ...base, html: undefined, attachments: [{ filename: 'a.pdf', content: pdf }] }).toString(),
    ).not.toMatch(/multipart\/alternative/)
  })
})

describe('RFC 2047', () => {
  it('encodes a non-ASCII subject, display name and filename, and they decode back', async () => {
    const subject = 'Reçu de paiement — billets 🎟️ pour la soirée du club de rotary de Lapeer, merci beaucoup'
    const raw = buildRawMessage({
      ...base,
      from: 'Café Rotary <no-reply@icrotary.com>',
      subject,
      attachments: [{ filename: 'reçu été 2026.pdf', content: pdf }],
    })
    const text = raw.toString('latin1')
    expect(text).toMatch(/^Subject: =\?UTF-8\?B\?/m)
    // Long subjects fold into several encoded-words, one per line.
    expect(text.match(/^ =\?UTF-8\?B\?/gm)?.length).toBeGreaterThan(0)
    expect(text).toContain("filename*=UTF-8''re%C3%A7u%20%C3%A9t%C3%A9%202026.pdf")

    const parsed = await PostalMime.parse(raw)
    expect(parsed.subject).toBe(subject)
    expect(parsed.from.name).toBe('Café Rotary')
    expect(parsed.attachments[0].filename).toBe('reçu été 2026.pdf')
    expect(Buffer.from(parsed.attachments[0].content).equals(pdf)).toBe(true)
  })

  it('keeps a long em-dash subject as one folded header that decodes back whole', async () => {
    const subject = `Weekly DMARC Report — ${'Lapeer County Road Commission and Associated Municipal Domains '.repeat(2)}`
    const raw = buildRawMessage({ ...base, subject, attachments: [{ filename: 'report.pdf', content: pdf }] })
    const text = raw.toString('latin1')
    expect(text.match(/^Subject:/gm)).toHaveLength(1)
    // Every continuation line of the subject starts with whitespace, so it stays one header.
    const header = text.split('\r\n').slice(text.split('\r\n').findIndex((l) => l.startsWith('Subject:')))
    const lines = header.slice(
      0,
      header.findIndex((l, i) => i > 0 && !/^[ \t]/.test(l)),
    )
    expect(lines.length).toBeGreaterThan(1)
    expect((await PostalMime.parse(raw)).subject).toBe(subject)
  })

  it('never splits a multi-byte character across encoded-words', () => {
    const subject = '🎟️'.repeat(40)
    const text = buildRawMessage({ ...base, subject }).toString('latin1')
    const words = [...text.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], 'base64'))
    expect(words.length).toBeGreaterThan(1)
    for (const word of words) expect(word.toString('utf8')).not.toContain('�')
    expect(Buffer.concat(words).toString('utf8')).toBe(subject)
  })

  it('quotes an ASCII filename and escapes quotes in it', async () => {
    const raw = buildRawMessage({
      ...base,
      attachments: [{ filename: 'the "final" report.csv', content: Buffer.from('a,b\n') }],
    })
    expect(raw.toString()).toContain('filename="the \\"final\\" report.csv"')
    expect((await PostalMime.parse(raw)).attachments[0]).toMatchObject({
      filename: 'the "final" report.csv',
      mimeType: 'text/csv',
    })
  })
})

describe('headers on the Raw path', () => {
  it('carries List-Unsubscribe and List-Unsubscribe-Post (RFC 8058)', async () => {
    const raw = await sentRaw({
      ...base,
      headers: {
        'List-Unsubscribe': '<https://app.dmarc.ws/unsub?t=abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      attachments: [{ filename: 'digest.pdf', content: pdf }],
    })
    const parsed = await PostalMime.parse(raw)
    const header = (key) => parsed.headers.find((h) => h.key === key)?.value
    expect(header('list-unsubscribe')).toBe('<https://app.dmarc.ws/unsub?t=abc>')
    expect(header('list-unsubscribe-post')).toBe('List-Unsubscribe=One-Click')
  })

  it('writes no Bcc header, so Bcc stays blind', () => {
    const raw = buildRawMessage({
      ...base,
      bcc: 'archive@example.com',
      attachments: [{ filename: 'a.pdf', content: pdf }],
    })
    expect(raw.toString()).not.toMatch(/^Bcc:/im)
    expect(raw.toString()).not.toContain('archive@example.com')
  })

  it('cannot be used to inject a header through the subject', async () => {
    const raw = buildRawMessage({ ...base, subject: 'Hello\r\nBcc: evil@example.com', attachments: [] })
    expect(raw.toString()).not.toMatch(/^Bcc:/im)
    expect((await PostalMime.parse(raw)).subject).toBe('Hello Bcc: evil@example.com')
  })
})
