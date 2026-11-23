import { readFile } from 'node:fs/promises'

import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createUrlRedactor, loggerOptions, REDACTED, redactPaths, redactQueryParams, redactUrl } from '../index.js'
import { appWithLogs } from './helpers.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('loggerOptions', () => {
  it('logs JSON at info with the fleet redaction outside development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', undefined)
    const options = loggerOptions()

    expect(options.level).toBe('info')
    expect(options.redact).toEqual([...redactPaths])
    expect(options.transport).toBeUndefined()
  })

  it('logs pretty at debug in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('LOG_LEVEL', undefined)
    const options = loggerOptions()

    expect(options.level).toBe('debug')
    expect(options.transport).toEqual({ target: 'pino-pretty' })
  })

  it('starts the pino-pretty transport in development when the API has it installed', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    // pino resolves the target by name, from the app that builds the logger: the optional peer.
    const app = Fastify({ logger: loggerOptions() })
    await expect(app.ready()).resolves.toBeDefined()
    await app.close()
  })

  it('declares pino-pretty as an optional peer, so production installs leave it out', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.dependencies).not.toHaveProperty('pino-pretty')
    expect(pkg.peerDependencies['pino-pretty']).toBeDefined()
    expect(pkg.peerDependenciesMeta['pino-pretty']).toEqual({ optional: true })
  })

  it('takes the level from LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'warn')
    expect(loggerOptions().level).toBe('warn')
  })

  it('adds a route’s own paths to the defaults', () => {
    expect(loggerOptions({ redact: ['body.iban'] }).redact).toEqual([...redactPaths, 'body.iban'])
  })

  it('cannot have its defaults changed by a caller', () => {
    expect(Object.isFrozen(redactPaths)).toBe(true)
  })

  it('redacts secrets in what a handler logs, and keeps headers out of request lines', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const logs = appWithLogs({}, loggerOptions())
    logs.app.get('/', async (request) => {
      request.log.info({ password: 'hunter2', user: { token: 'tok_123', name: 'Jane' }, secret: 's3' }, 'signed in')
      return {}
    })

    await logs.app.inject({ url: '/', headers: { authorization: 'Bearer abc.def', cookie: 'session=xyz' } })
    await logs.app.close()

    const said = logs.raw.join('')
    const lines = logs.lines
    for (const value of ['hunter2', 'tok_123', 's3"', 'abc.def', 'session=xyz']) expect(said).not.toContain(value)
    const line = lines.find((l) => l.msg === 'signed in')
    expect(line).toMatchObject({
      password: '[Redacted]',
      secret: '[Redacted]',
      user: { token: '[Redacted]', name: 'Jane' }
    })
    const { req } = lines.find((l) => l.msg === 'incoming request')
    expect(Object.keys(req).sort()).toEqual(['hostname', 'method', 'url'])
    expect(req).toMatchObject({ method: 'GET', url: '/' })
  })
})

// The secret a public link carries. It must never reach a log line.
const SECRET = 'the-value-in-the-link'

describe('redactUrl', () => {
  it.each([
    // xceptionalheroes: feedback, account review, newsletter manage
    [`/public/feedback?token=${SECRET}`, `/public/feedback?token=${REDACTED}`],
    [`/public/newsletter/manage?token=${SECRET}&x=1`, `/public/newsletter/manage?token=${REDACTED}&x=1`],
    [`/public/feedback?x=1&token=${SECRET}`, `/public/feedback?x=1&token=${REDACTED}`],
    [`/public/feedback?TOKEN=${SECRET}`, `/public/feedback?TOKEN=${REDACTED}`],
    [`/somewhere?code=${SECRET}`, `/somewhere?code=${REDACTED}`],
    // gronetworking: the event stream's one-time ticket
    [`/v1/stream?ticket=${SECRET}`, `/v1/stream?ticket=${REDACTED}`],
    [`/v1/members?sort=newest&token=${SECRET}&limit=20`, `/v1/members?sort=newest&token=${REDACTED}&limit=20`],
    [`/x?token=${SECRET}#frag`, `/x?token=${REDACTED}#frag`]
  ])('masks %s', (url, want) => {
    expect(redactUrl(url)).toBe(want)
  })

  it.each(['/events/public?limit=5', '/heroes/abc123', '/health', '/coupons?promo_code=SPRING', '/zip?zipcode=48446'])(
    'leaves %s exactly as sent',
    (url) => {
      expect(redactUrl(url)).toBe(url)
    }
  )

  it('passes a non-string through', () => {
    expect(redactUrl(undefined)).toBeUndefined()
  })

  it('masks the default names', () => {
    expect([...redactQueryParams]).toEqual(expect.arrayContaining(['token', 'code', 'ticket']))
    expect(Object.isFrozen(redactQueryParams)).toBe(true)
  })

  it('masks extra names and the segment after a secret path segment', () => {
    const mask = createUrlRedactor({ query: ['key'], pathAfter: ['invite-codes'] })
    expect(mask(`/a?key=${SECRET}&token=keep`)).toBe(`/a?key=${REDACTED}&token=keep`)
    expect(mask(`/invite-codes/${SECRET}`)).toBe(`/invite-codes/${REDACTED}`)
    expect(mask(`/invite-codes/${SECRET}/claim?x=1`)).toBe(`/invite-codes/${REDACTED}/claim?x=1`)
    expect(mask('/organizations/abc/invite-codes')).toBe('/organizations/abc/invite-codes')
  })

  it('treats a name as text, not a pattern', () => {
    const mask = createUrlRedactor({ query: ['a.b'] })
    expect(mask('/x?a.b=1&aXb=2')).toBe(`/x?a.b=${REDACTED}&aXb=2`)
  })
})

describe('loggerOptions URL redaction', () => {
  async function logsFor(url, options) {
    vi.stubEnv('NODE_ENV', 'production')
    const logs = appWithLogs({}, loggerOptions(options))
    logs.app.get('/public/feedback', async () => ({ ok: true }))
    logs.app.get('/invite-codes/:code', async () => ({ ok: true }))
    await logs.app.inject({ method: 'GET', url })
    await logs.app.close()
    return logs
  }

  it('masks secrets in the request line and keeps the path and parameter name', async () => {
    const logs = await logsFor(`/public/feedback?token=${SECRET}&ref=mail`)

    expect(logs.raw.join('')).not.toContain(SECRET)
    const { req } = logs.lines.find((l) => l.msg === 'incoming request')
    expect(req).toMatchObject({ method: 'GET', url: `/public/feedback?token=${REDACTED}&ref=mail` })
  })

  it("masks secrets in Fastify's own route-not-found message", async () => {
    const logs = await logsFor(`/old/feedback?token=${SECRET}`)

    expect(logs.raw.join('')).not.toContain(SECRET)
    expect(logs.lines.some((l) => l.msg === `Route GET:/old/feedback?token=${REDACTED} not found`)).toBe(true)
  })

  it('takes extra query names and secret path segments', async () => {
    const logs = await logsFor(`/invite-codes/${SECRET}?k=${SECRET}`, {
      redactQuery: ['k'],
      redactPathAfter: ['invite-codes']
    })

    expect(logs.raw.join('')).not.toContain(SECRET)
    const { req } = logs.lines.find((l) => l.msg === 'incoming request')
    expect(req.url).toBe(`/invite-codes/${REDACTED}?k=${REDACTED}`)
  })

  it('keeps logging objects and format arguments as pino does', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const logs = appWithLogs({}, loggerOptions())
    logs.app.log.info({ count: 2 }, 'sent %d mails to %s', 2, `/x?token=${SECRET}`)
    await logs.app.close()

    const line = logs.lines.find((l) => l.count === 2)
    expect(line.msg).toBe(`sent 2 mails to /x?token=${REDACTED}`)
  })
})
