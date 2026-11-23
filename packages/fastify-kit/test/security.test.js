import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { createErrorHandler } from '../index.js'
import { corsMethods, parseOrigins, rateLimitDefaults, securityPlugins } from '../security.js'

const WEB = 'https://app.example.com'

let app
afterEach(async () => {
  await app?.close()
  app = undefined
})

async function build(options = { origins: `${WEB}, http://localhost:5173` }) {
  app = Fastify()
  app.setErrorHandler(createErrorHandler())
  await app.register(securityPlugins, options)
  app.get('/open', async () => ({ ok: true }))
  app.post('/contact', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  app.delete('/items/:id', async () => ({ ok: true }))
  return app
}

const preflight = (origin, method) => ({
  method: 'OPTIONS',
  url: '/items/1',
  headers: { origin, 'access-control-request-method': method }
})

describe('securityPlugins', () => {
  it('lets an allowed origin preflight PUT, PATCH and DELETE', async () => {
    await build()
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const response = await app.inject(preflight(WEB, method))
      expect(response.statusCode).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBe(WEB)
      expect(response.headers['access-control-allow-credentials']).toBe('true')
      expect(response.headers['access-control-allow-methods'].split(/,\s*/)).toEqual([...corsMethods])
    }
  })

  it('gives an origin that is not listed no CORS headers', async () => {
    await build()
    const response = await app.inject({ url: '/open', headers: { origin: 'https://evil.example' } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('reads a comma-separated list, as CORS_ORIGINS holds it', async () => {
    await build()
    const response = await app.inject({ url: '/open', headers: { origin: 'http://localhost:5173' } })

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it("sends helmet's headers", async () => {
    await build()
    const response = await app.inject('/open')

    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toBeDefined()
    expect(response.headers['strict-transport-security']).toBeDefined()
  })

  it('passes helmet options through', async () => {
    await build({ origins: [WEB], helmet: { contentSecurityPolicy: false } })
    const response = await app.inject('/open')

    expect(response.headers['content-security-policy']).toBeUndefined()
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('rate-limits only the routes that opt in, and a 429 still carries CORS headers', async () => {
    await build()
    const post = () => app.inject({ method: 'POST', url: '/contact', headers: { origin: WEB } })
    await post()
    await post()
    const limited = await post()

    expect(limited.statusCode).toBe(429)
    expect(limited.headers['access-control-allow-origin']).toBe(WEB)
    expect(limited.headers['retry-after']).toBeDefined()

    for (let i = 0; i < 5; i++) expect((await app.inject('/open')).statusCode).toBe(200)
  })

  it('takes rate-limit options over the defaults', async () => {
    app = Fastify()
    await app.register(securityPlugins, { origins: [WEB], rateLimit: { global: true, max: 1 } })
    app.get('/', async () => ({}))

    await app.inject('/')
    expect((await app.inject('/')).statusCode).toBe(429)
    expect(rateLimitDefaults).toEqual({ max: 100, timeWindow: '1 minute', global: false })
  })

  it('takes extra CORS options, but not origin', async () => {
    await build({ origins: [WEB], cors: { exposedHeaders: ['x-request-id'] } })
    const response = await app.inject({ url: '/open', headers: { origin: WEB } })
    expect(response.headers['access-control-expose-headers']).toBe('x-request-id')

    await app.close()
    app = Fastify()
    await expect(app.register(securityPlugins, { origins: [WEB], cors: { origin: true } })).rejects.toThrow(
      /pass origins/
    )
  })

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['true', true],
    ['a wildcard', '*'],
    ['null', 'null'],
    ['a wildcard in a list', [WEB, '*']],
    ['a function', () => true],
    ['a URL with a path', 'https://app.example.com/login']
  ])('refuses %s as origins', async (_label, origins) => {
    app = Fastify()
    await expect(app.register(securityPlugins, { origins })).rejects.toThrow(TypeError)
  })
})

describe('parseOrigins', () => {
  it('trims, drops trailing slashes and empty entries, and keeps RegExps', () => {
    const pattern = /^https:\/\/[a-z]+\.example\.com$/
    expect(parseOrigins(' https://a.example.com/ ,,http://localhost:4321')).toEqual([
      'https://a.example.com',
      'http://localhost:4321'
    ])
    expect(parseOrigins([pattern, 'capacitor://localhost'])).toEqual([pattern, 'capacitor://localhost'])
  })
})
