import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFormGuard, FormClientConfigError, RESERVED_FIELDS, submitForm } from '../index.js'
import { ENDPOINT, fixedGuard, json, mockFetch, sentBody } from './helpers.js'

// Every answer below is one form-api-ses gives at d38919e (index.js `respond`), so a change to its wording or
// shape shows up here as a deliberate edit, not as a form quietly showing the wrong thing.
const SENT = { ok: true, message: 'Message sent!' }

let warn

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const submit = (options = {}) =>
  submitForm({
    endpoint: ENDPOINT,
    client: 'clientkey',
    form: 'contact',
    fields: { name: 'Jane Doe', email: 'jane@example.com', message: 'Hello' },
    guard: fixedGuard(),
    ...options
  })

describe('submitForm', () => {
  it('posts the form as JSON and resolves ok', async () => {
    const fetch = mockFetch(json(200, SENT))

    await expect(submit()).resolves.toEqual({ ok: true })

    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(sentBody(fetch)).toEqual({
      client: 'clientkey',
      form: 'contact',
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'Hello',
      website: '',
      _fillMs: 8421
    })
  })

  it('leaves out form and subject when not given, and sends subject when it is', async () => {
    const fetch = mockFetch(json(200, SENT), json(200, SENT))

    await submit({ form: undefined })
    expect(sentBody(fetch, 0)).not.toHaveProperty('form')
    expect(sentBody(fetch, 0)).not.toHaveProperty('subject')

    // maverickpokerleague's Halloween form sets its own subject per registration.
    await submit({ subject: 'Halloween Tournament Registration: Jane Doe' })
    expect(sentBody(fetch, 1).subject).toBe('Halloween Tournament Registration: Jane Doe')
  })

  it("surfaces the API's own message for a 4xx", async () => {
    mockFetch(json(429, { error: 'Too many submissions. Please try again later or call us.' }))
    await expect(submit()).resolves.toEqual({
      ok: false,
      status: 429,
      message: 'Too many submissions. Please try again later or call us.'
    })

    // The five maverickpokerleague forms replaced this with "Something went wrong".
    mockFetch(json(400, { error: 'Form appears to be empty.' }))
    await expect(submit()).resolves.toEqual({ ok: false, status: 400, message: 'Form appears to be empty.' })
  })

  it('reports an origin the client does not list as 403 with its message', async () => {
    mockFetch(json(403, { error: 'This form only accepts submissions from its own website.' }))
    await expect(submit()).resolves.toEqual({
      ok: false,
      status: 403,
      message: 'This form only accepts submissions from its own website.'
    })
  })

  it('surfaces a 500 from the send', async () => {
    mockFetch(json(500, { error: 'Failed to send email.' }))
    await expect(submit()).resolves.toEqual({ ok: false, status: 500, message: 'Failed to send email.' })
  })

  it("reads API Gateway's own { message } error, and falls back when the body is not JSON", async () => {
    mockFetch(json(503, { message: 'Service Unavailable' }))
    await expect(submit()).resolves.toEqual({ ok: false, status: 503, message: 'Service Unavailable' })

    mockFetch(new Response('<html>Bad gateway</html>', { status: 502 }))
    const result = await submit()
    expect(result).toMatchObject({ ok: false, status: 502 })
    expect(result.message).toMatch(/something went wrong/i)
  })

  it('resolves status 0 when nothing answers, instead of throwing', async () => {
    // A CORS refusal looks the same to the page: fetch rejects with a TypeError.
    mockFetch(new TypeError('Failed to fetch'))
    const result = await submit()
    expect(result).toMatchObject({ ok: false, status: 0 })
    expect(result.message).toMatch(/couldn't reach/i)
  })

  it('rethrows when the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetch(new DOMException('aborted', 'AbortError'))
    await expect(submit({ signal: controller.signal })).rejects.toThrow('aborted')
  })

  describe('a missing endpoint is a setup mistake, not a sent form', () => {
    // Five sites read PUBLIC_FORM_API_URL with no guard, so an unset variable meant fetch(undefined). Only
    // cptaxgroup checked it.
    it.each([undefined, null, '', '   '])('throws for %j and sends nothing', async (endpoint) => {
      const fetch = mockFetch()
      await expect(submit({ endpoint })).rejects.toThrow(FormClientConfigError)
      await expect(submit({ endpoint })).rejects.toThrow(/PUBLIC_FORM_API_URL/)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('throws for an endpoint that is not an absolute URL', async () => {
      mockFetch()
      await expect(submit({ endpoint: '/forms' })).rejects.toThrow(/not an absolute URL/)
    })

    it('throws for a missing client', async () => {
      mockFetch()
      await expect(submit({ client: '' })).rejects.toThrow(/client is missing/)
    })
  })

  describe('spam traps', () => {
    it('still sends a filled honeypot, so the API checks the origin and answers its silent success', async () => {
      const fetch = mockFetch(json(200, { ok: true }))
      await expect(submit({ guard: fixedGuard('http://spam.example') })).resolves.toEqual({ ok: true })
      expect(sentBody(fetch).website).toBe('http://spam.example')
    })

    it('sends a too-fast fill time as measured, for the API to judge', async () => {
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
      const guard = createFormGuard()
      now.mockReturnValue(2200)
      const fetch = mockFetch(json(200, { ok: true }))

      await expect(submit({ guard })).resolves.toEqual({ ok: true })
      expect(sentBody(fetch)._fillMs).toBe(1200)
    })

    it('sends no _fillMs without a guard, and treats a website field as the honeypot', async () => {
      const fetch = mockFetch(json(200, { ok: true }))
      await submit({ guard: undefined, fields: { name: 'Bot', website: 'filled' } })
      expect(sentBody(fetch)).toEqual({ client: 'clientkey', form: 'contact', name: 'Bot', website: 'filled' })
    })

    it("drops the trap's own input from FormData when the guard read it too", async () => {
      const fetch = mockFetch(json(200, SENT))
      const data = new FormData()
      data.append('name', 'Jane')
      data.append('website', '')
      await submit({ fields: data, guard: fixedGuard('') })
      expect(sentBody(fetch)).toEqual({
        client: 'clientkey',
        form: 'contact',
        name: 'Jane',
        website: '',
        _fillMs: 8421
      })
    })

    it('keeps a real website field that differs from the trap, renamed', async () => {
      const fetch = mockFetch(json(200, SENT))
      await submit({ fields: { name: 'Jane', website: 'https://acme.example' }, guard: fixedGuard('') })
      expect(sentBody(fetch)).toMatchObject({ website: '', website_field: 'https://acme.example' })
    })
  })

  describe('reserved keys', () => {
    it('never lets a field change the client, form, subject, traps or uploads', async () => {
      const fetch = mockFetch(json(200, SENT))
      await submit({
        fields: {
          name: 'Jane',
          client: 'otherclient',
          form: 'advertise',
          subject: 'Pick me',
          redirect: 'https://elsewhere.example',
          consent: true,
          _fillMs: 999999,
          uploads: ['otherclient/x/y.pdf']
        }
      })

      const body = sentBody(fetch)
      expect(body).toMatchObject({ client: 'clientkey', form: 'contact', website: '', _fillMs: 8421 })
      expect(body).not.toHaveProperty('subject')
      expect(body).not.toHaveProperty('redirect')
      expect(body).not.toHaveProperty('uploads')
      expect(body).not.toHaveProperty('consent')
    })

    it('renames the colliding fields so their values still reach the email', async () => {
      const fetch = mockFetch(json(200, SENT))
      // legacywellnesscenteraz posts a consent checkbox, which the API drops from the email as `consent`.
      await submit({ fields: { name: 'Jane', consent: true, subject: 'Billing question', form: 'x' } })

      expect(sentBody(fetch)).toMatchObject({ consent_field: true, subject_field: 'Billing question', form_field: 'x' })
      expect(warn).toHaveBeenCalledTimes(3)
      expect(warn.mock.calls[0][0]).toMatch(/"consent" is reserved/)
    })

    it('lists every key form-api-ses treats as a setting', () => {
      // META_FIELDS in form-api-ses index.js.
      expect([...RESERVED_FIELDS].sort()).toEqual(
        ['website', 'redirect', 'client', 'subject', 'consent', 'form', '_fillMs', 'uploads'].sort()
      )
    })
  })

  describe('FormData fields', () => {
    it('sends repeated names as a list and skips an empty file input', async () => {
      const fetch = mockFetch(json(200, SENT))
      const data = new FormData()
      data.append('name', 'Jane')
      data.append('services', 'Tax prep')
      data.append('services', 'Payroll')
      data.append('artwork', new File([], ''))

      await expect(submit({ fields: data })).resolves.toEqual({ ok: true })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(sentBody(fetch)).toMatchObject({ name: 'Jane', services: ['Tax prep', 'Payroll'] })
      expect(sentBody(fetch)).not.toHaveProperty('artwork')
    })
  })
})
