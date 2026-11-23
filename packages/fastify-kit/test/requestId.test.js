import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import {
  AppError,
  createErrorHandler,
  echoRequestId,
  isSaneRequestId,
  loggerOptions,
  REQUEST_ID_HEADER,
  requestIdOptions,
} from '../index.js'
import { appWithLogs } from './helpers.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let app
afterEach(async () => {
  await app?.close()
  app = undefined
})

/** An app the way an API builds it: the id options, the error handler, then the echo plugin. */
async function build({ options, echo } = {}) {
  app = Fastify({ ...requestIdOptions(options) })
  app.setErrorHandler(
    createErrorHandler({ body: ({ message, code }, request) => ({ error: message, code, id: request.id }) }),
  )
  await app.register(echoRequestId, echo)
  app.get('/id', async (request) => ({ id: request.id }))
  app.get('/fail', async () => {
    throw new AppError('Nope', 409, 'NOPE')
  })
  return app
}

describe('isSaneRequestId', () => {
  it.each([
    '0b6a5c1e-9a4f-4c1e-8d7f-2b3c4d5e6f70',
    '8f1e2d3c4b5a6978-ORD',
    'contract-request-0001',
    'a',
    'trace.span:01_x',
    'x'.repeat(128),
  ])('keeps %s', (value) => {
    expect(isSaneRequestId(value)).toBe(true)
  })

  it.each([
    '',
    ' leading-space',
    'a, b',
    'has space',
    '-starts-with-dash',
    'quote"d',
    '<script>',
    'x'.repeat(129),
    'line\nbreak',
    undefined,
    42,
    ['a', 'b'],
  ])('refuses %j', (value) => {
    expect(isSaneRequestId(value)).toBe(false)
  })
})

describe('requestIdOptions', () => {
  it('turns off Fastify’s unchecked header and supplies genReqId', () => {
    const options = requestIdOptions()
    expect(options.requestIdHeader).toBe(false)
    expect(typeof options.genReqId).toBe('function')
  })

  it('keeps a sane incoming x-request-id as request.id', async () => {
    await build()
    const res = await app.inject({ url: '/id', headers: { 'x-request-id': 'contract-request-0001' } })
    expect(res.json()).toEqual({ id: 'contract-request-0001' })
  })

  it('makes a UUID when there is no incoming id', async () => {
    await build()
    const res = await app.inject({ url: '/id' })
    expect(res.json().id).toMatch(UUID)
  })

  it.each(['has space', 'x'.repeat(129), 'a,b', '"quoted"'])(
    'replaces an insane incoming id %j with a UUID',
    async (value) => {
      await build()
      const res = await app.inject({ url: '/id', headers: { 'x-request-id': value } })
      expect(res.json().id).toMatch(UUID)
      expect(res.headers['x-request-id']).toBe(res.json().id)
    },
  )

  it('reads another header, and takes its own generator', async () => {
    let n = 0
    await build({ options: { header: 'CF-Ray', generate: () => `gen-${++n}` } })
    expect((await app.inject({ url: '/id', headers: { 'cf-ray': '8f1e2d3c4b5a6978-ORD' } })).json().id).toBe(
      '8f1e2d3c4b5a6978-ORD',
    )
    expect((await app.inject({ url: '/id', headers: { 'x-request-id': 'ignored-here' } })).json().id).toBe('gen-1')
  })

  it('puts the id on every log line of the request as reqId', async () => {
    const logs = appWithLogs({ ...requestIdOptions() }, loggerOptions())
    app = logs.app
    app.get('/', async (request) => {
      request.log.info('handled')
      return {}
    })
    await app.inject({ url: '/', headers: { 'x-request-id': 'trace-123' } })
    const lines = logs.lines.filter((line) => line.reqId !== undefined)
    expect(lines.map((line) => line.msg)).toEqual(expect.arrayContaining(['incoming request', 'handled']))
    expect(new Set(lines.map((line) => line.reqId))).toEqual(new Set(['trace-123']))
  })
})

describe('echoRequestId', () => {
  it('sends the id back on a normal reply', async () => {
    await build()
    const res = await app.inject({ url: '/id', headers: { 'x-request-id': 'abc-123' } })
    expect(res.headers[REQUEST_ID_HEADER]).toBe('abc-123')
  })

  it('sends it back on an error reply, matching what the error body carries', async () => {
    await build()
    const res = await app.inject({ url: '/fail' })
    expect(res.statusCode).toBe(409)
    expect(res.headers['x-request-id']).toMatch(UUID)
    expect(res.json()).toEqual({ error: 'Nope', code: 'NOPE', id: res.headers['x-request-id'] })
  })

  it('sends it back on a 404', async () => {
    await build()
    const res = await app.inject({ url: '/nowhere', headers: { 'x-request-id': 'lost-1' } })
    expect(res.statusCode).toBe(404)
    expect(res.headers['x-request-id']).toBe('lost-1')
  })

  it('reaches routes registered in other plugins', async () => {
    app = Fastify({ ...requestIdOptions() })
    await app.register(echoRequestId)
    await app.register(async (scoped) => scoped.get('/inner', async () => ({})), { prefix: '/scoped' })
    const res = await app.inject({ url: '/scoped/inner', headers: { 'x-request-id': 'inner-1' } })
    expect(res.headers['x-request-id']).toBe('inner-1')
  })

  it('takes another header name', async () => {
    await build({ echo: { header: 'x-correlation-id' } })
    const res = await app.inject({ url: '/id', headers: { 'x-request-id': 'abc-123' } })
    expect(res.headers['x-correlation-id']).toBe('abc-123')
    expect(res.headers['x-request-id']).toBeUndefined()
  })

  it('changes nothing for an app that only takes the default Fastify ids', async () => {
    app = Fastify()
    app.get('/id', async (request) => ({ id: request.id }))
    const res = await app.inject({ url: '/id', headers: { 'x-request-id': 'kept-by-nobody' } })
    expect(res.json().id).not.toBe('kept-by-nobody')
    expect(res.headers['x-request-id']).toBeUndefined()
  })
})
