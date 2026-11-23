import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createErrorHandler, requireTurnstile, SITEVERIFY_URL, verifyTurnstile } from '../index.js'

const SECRET = '0x4AAAA-test-secret'
const TOKEN = 'XXXX.DUMMY.TOKEN'

let siteverify
beforeEach(() => {
  vi.stubEnv('TURNSTILE_SECRET_KEY', SECRET)
  siteverify = vi.fn()
  vi.stubGlobal('fetch', siteverify)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Cloudflare answering with this siteverify result. */
function answers(result, status = 200) {
  siteverify.mockImplementation(async () => new Response(JSON.stringify(result), { status }))
}

const good = { success: true, action: 'contact', hostname: 'example.com', 'error-codes': [] }

describe('verifyTurnstile', () => {
  it('posts the secret, token and client address to siteverify', async () => {
    answers(good)

    expect(await verifyTurnstile(TOKEN, { remoteIp: '198.51.100.7' })).toEqual({ ok: true })
    const [url, init] = siteverify.mock.calls[0]
    expect(url).toBe(SITEVERIFY_URL)
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(init.body)).toEqual({ secret: SECRET, response: TOKEN, remoteip: '198.51.100.7' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('fails closed when the secret is missing, without asking Cloudflare', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    expect(await verifyTurnstile(TOKEN, { log })).toEqual({ ok: false, reason: 'NOT_CONFIGURED' })
    expect(siteverify).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalled()
  })

  it.each([
    ['no token', undefined],
    ['an empty token', ''],
    ['a token that is not a string', { a: 1 }],
    ['an oversized token', 'x'.repeat(2049)],
  ])('refuses %s without asking Cloudflare', async (_label, token) => {
    expect(await verifyTurnstile(token)).toEqual({ ok: false, reason: 'MISSING_TOKEN' })
    expect(siteverify).not.toHaveBeenCalled()
  })

  it('checks success', async () => {
    answers({ success: false, 'error-codes': ['timeout-or-duplicate'] })

    expect(await verifyTurnstile(TOKEN)).toEqual({
      ok: false,
      reason: 'REJECTED',
      errorCodes: ['timeout-or-duplicate'],
    })
  })

  it('treats a truthy success that is not true as a rejection', async () => {
    answers({ success: 'true' })
    expect((await verifyTurnstile(TOKEN)).ok).toBe(false)
  })

  it('checks the action when given', async () => {
    answers(good)
    expect(await verifyTurnstile(TOKEN, { action: 'contact' })).toEqual({ ok: true })
    expect(await verifyTurnstile(TOKEN, { action: 'signup' })).toEqual({ ok: false, reason: 'ACTION_MISMATCH' })
  })

  it('checks the hostname when given, against one host or a list', async () => {
    answers(good)
    expect(await verifyTurnstile(TOKEN, { hostname: 'example.com' })).toEqual({ ok: true })
    expect(await verifyTurnstile(TOKEN, { hostname: ['www.example.com', 'EXAMPLE.com'] })).toEqual({ ok: true })
    expect(await verifyTurnstile(TOKEN, { hostname: 'other.example' })).toEqual({
      ok: false,
      reason: 'HOSTNAME_MISMATCH',
    })
  })

  it('fails closed when Cloudflare answers non-2xx or cannot be reached', async () => {
    answers({}, 500)
    expect(await verifyTurnstile(TOKEN)).toEqual({ ok: false, reason: 'UNREACHABLE' })

    siteverify.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    expect(await verifyTurnstile(TOKEN)).toEqual({ ok: false, reason: 'UNREACHABLE' })
  })

  it('takes the secret as an option', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    answers(good)

    expect(await verifyTurnstile(TOKEN, { secret: 'other' })).toEqual({ ok: true })
    expect(Object.fromEntries(siteverify.mock.calls[0][1].body).secret).toBe('other')
  })

  it('never logs the token or the secret', async () => {
    const lines = []
    const log = { info: (...a) => lines.push(a), warn: (...a) => lines.push(a), error: (...a) => lines.push(a) }
    answers({ success: false, 'error-codes': ['invalid-input-response'] })
    await verifyTurnstile(TOKEN, { log })
    siteverify.mockRejectedValue(new Error(`failed with ${TOKEN}`))
    await verifyTurnstile(TOKEN, { log })

    const said = JSON.stringify(lines)
    expect(said).not.toContain(TOKEN)
    expect(said).not.toContain(SECRET)
  })
})

describe('requireTurnstile', () => {
  let app
  const captureException = vi.fn()

  afterEach(async () => {
    await app?.close()
    app = undefined
    captureException.mockReset()
  })

  async function build(options) {
    app = Fastify()
    app.setErrorHandler(createErrorHandler({ captureException }))
    app.post('/contact', { preHandler: requireTurnstile(options) }, async () => ({ sent: true }))
    return app
  }

  const submit = (payload = { turnstileToken: TOKEN, message: 'hi' }) =>
    app.inject({ method: 'POST', url: '/contact', payload, remoteAddress: '198.51.100.7' })

  it('lets a verified submission through', async () => {
    answers(good)
    await build({ action: 'contact', hostname: 'example.com' })
    const response = await submit()

    expect(response.statusCode).toBe(200)
    expect(Object.fromEntries(siteverify.mock.calls[0][1].body).remoteip).toBe('198.51.100.7')
  })

  it('answers 403 CHALLENGE_FAILED for a missing, rejected or misdirected token', async () => {
    await build({ action: 'contact' })

    expect((await submit({ message: 'hi' })).json().code).toBe('CHALLENGE_FAILED')
    answers({ success: false })
    expect((await submit()).statusCode).toBe(403)
    answers({ ...good, action: 'signup' })
    const response = await submit()
    expect(response.statusCode).toBe(403)
    expect(response.json().code).toBe('CHALLENGE_FAILED')
    expect(captureException).not.toHaveBeenCalled()
  })

  it('answers 503 and reports it when the secret is missing', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', undefined)
    await build()
    const response = await submit()

    expect(response.statusCode).toBe(503)
    expect(response.json().code).toBe('CHALLENGE_UNAVAILABLE')
    expect(captureException).toHaveBeenCalledOnce()
  })

  it('reads the token from where the route keeps it', async () => {
    answers(good)
    await build({ token: (request) => request.body?.['cf-turnstile-response'] })

    expect((await submit({ 'cf-turnstile-response': TOKEN })).statusCode).toBe(200)
  })
})
