import { createHmac } from 'node:crypto'

import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createErrorHandler, rawJsonBody } from '../index.js'

let app
afterEach(async () => {
  await app?.close()
  app = undefined
})

/** An app with a webhook route behind rawJsonBody and an ordinary JSON route beside it. */
async function build(options) {
  app = Fastify()
  app.setErrorHandler(createErrorHandler())
  await app.register(
    async (webhooks) => {
      await webhooks.register(rawJsonBody, options)
      webhooks.post('/stripe', async (request) => ({
        raw: Buffer.isBuffer(request.rawBody) ? request.rawBody.toString('utf8') : null,
        body: request.body,
      }))
    },
    { prefix: '/webhooks' },
  )
  app.post('/profile', async (request) => ({ rawBody: request.rawBody ?? null, body: request.body }))
  return app
}

const json = { 'content-type': 'application/json' }

describe('rawJsonBody', () => {
  it('keeps the exact bytes for a signature check and parses the body', async () => {
    await build()
    // Spacing and key order a re-serialised body would lose, which breaks a signature.
    const payload = '{ "id":"evt_1",  "type": "invoice.paid" }'
    const secret = 'whsec_test'
    const signature = createHmac('sha256', secret).update(payload).digest('hex')

    const response = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: json, payload })

    expect(response.statusCode).toBe(200)
    const { raw, body } = response.json()
    expect(raw).toBe(payload)
    expect(createHmac('sha256', secret).update(raw).digest('hex')).toBe(signature)
    expect(body).toEqual({ id: 'evt_1', type: 'invoice.paid' })
  })

  it('answers malformed JSON with 400', async () => {
    await build()
    const response = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: json, payload: '{"id":' })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('FST_ERR_CTP_INVALID_JSON_BODY')
  })

  it('answers an empty JSON body with 400', async () => {
    await build()
    const response = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: json, payload: '' })

    expect(response.statusCode).toBe(400)
  })

  it('keeps the prototype-poisoning guard on the webhook route', async () => {
    await build()
    const payload = '{ "id": "evt_1", "__proto__": { "isAdmin": true } }'
    const response = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: json, payload })

    expect(response.statusCode).toBe(400)
    expect({}.isAdmin).toBeUndefined()
  })

  it("leaves every other route on Fastify's own parser", async () => {
    await build()
    const ok = await app.inject({ method: 'POST', url: '/profile', payload: { name: 'Jane' } })
    expect(ok.json()).toEqual({ rawBody: null, body: { name: 'Jane' } })

    const poisoned = await app.inject({
      method: 'POST',
      url: '/profile',
      headers: json,
      payload: '{ "__proto__": { "isAdmin": true } }',
    })
    expect(poisoned.statusCode).toBe(400)
  })

  it('takes other content types, e.g. the text/plain JSON SNS posts', async () => {
    await build({ contentTypes: ['application/json', 'text/plain'] })
    const payload = '{"Type":"Notification","Message":"{}"}'
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
      payload,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ raw: payload, body: { Type: 'Notification', Message: '{}' } })

    const plain = await app.inject({
      method: 'POST',
      url: '/profile',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    })
    expect(plain.json().body).toBe('hello')
  })

  it('applies its own body limit', async () => {
    await build({ bodyLimit: 10 })
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: json,
      payload: '{"id":"evt_123456"}',
    })

    expect(response.statusCode).toBe(413)
  })

  it('can be registered in two sibling plugins', async () => {
    app = Fastify()
    for (const prefix of ['/stripe', '/ses']) {
      await app.register(
        async (scope) => {
          await scope.register(rawJsonBody)
          scope.post('/', async (request) => ({ raw: request.rawBody.toString('utf8') }))
        },
        { prefix },
      )
    }

    for (const url of ['/stripe', '/ses']) {
      const response = await app.inject({ method: 'POST', url, headers: json, payload: '{"a":1}' })
      expect(response.json()).toEqual({ raw: '{"a":1}' })
    }
  })

  it('answers a database error on its routes with a reported 500, and leaves other routes on 409', async () => {
    const captureException = vi.fn()
    const taken = () =>
      Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      })
    app = Fastify()
    app.setErrorHandler(createErrorHandler({ captureException }))
    await app.register(
      async (webhooks) => {
        await webhooks.register(rawJsonBody)
        webhooks.post('/stripe', async () => {
          throw taken()
        })
        // A route module registered inside the webhook scope is marked too.
        await webhooks.register(async (nested) => {
          nested.post('/ses', async () => {
            throw taken()
          })
        })
        // A route that says otherwise keeps its own value.
        webhooks.post('/form', { config: { webhook: false } }, async () => {
          throw taken()
        })
      },
      { prefix: '/webhooks' },
    )
    app.post('/profile', async () => {
      throw taken()
    })

    for (const url of ['/webhooks/stripe', '/webhooks/ses']) {
      const response = await app.inject({ method: 'POST', url, headers: json, payload: '{"id":"evt_1"}' })
      expect(response.statusCode).toBe(500)
      expect(response.json().code).toBe('INTERNAL')
    }
    expect(captureException).toHaveBeenCalledTimes(2)

    for (const url of ['/webhooks/form', '/profile']) {
      const response = await app.inject({ method: 'POST', url, headers: json, payload: '{"id":"evt_1"}' })
      expect(response.statusCode).toBe(409)
    }
    expect(captureException).toHaveBeenCalledTimes(2)
  })

  it('refuses an empty content-type list', async () => {
    app = Fastify()
    await expect(app.register(rawJsonBody, { contentTypes: [] })).rejects.toThrow(TypeError)
  })
})
