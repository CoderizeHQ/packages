import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppError, createErrorHandler, errorFacts, INTERNAL_ERROR_MESSAGE } from '../index.js'
import { appWithLogs, prismaError } from './helpers.js'

// Values that must never reach a response body or a log line.
const EMAIL = 'jane.doe@example.com'
const NOTE = 'allergic to penicillin'

const prismaValidationMessage = [
  '',
  'Invalid `prisma.hero.create()` invocation in',
  '/app/apps/api/src/routes/heroes.js:42:7',
  '',
  `  data: { email: "${EMAIL}", medicalNotes: "${NOTE}", age: "twelve" }`,
  '',
  'Argument `age`: Invalid value provided. Expected Int, provided String.'
].join('\n')

/**
 * Builds an app with the handler and one route per case, each throwing what `throws` returns.
 * @param {Record<string, () => unknown>} routes
 * @param {Parameters<typeof createErrorHandler>[0]} [options]
 */
async function build(routes, options) {
  const captureException = vi.fn()
  const logs = appWithLogs()
  logs.app.setErrorHandler(createErrorHandler({ captureException, ...options }))
  for (const [path, throws] of Object.entries(routes)) {
    logs.app.get(path, async () => {
      throw throws()
    })
  }
  await logs.app.ready()
  return Object.assign(logs, { captureException })
}

/** Response body and every log line, as one string to search for leaked values. */
function everythingSaid(response, logs) {
  return response.body + logs.raw.join('')
}

let current
afterEach(async () => {
  await current?.app.close()
  current = undefined
})

describe('createErrorHandler', () => {
  it('answers an AppError with its own status, message and code', async () => {
    current = await build({ '/': () => new AppError('Event is full', 409, 'EVENT_FULL') })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'Event is full', code: 'EVENT_FULL' })
    expect(current.captureException).not.toHaveBeenCalled()
  })

  it('defaults an AppError to 400 APP_ERROR', async () => {
    current = await build({ '/': () => new AppError('Bad date') })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'Bad date', code: 'APP_ERROR' })
  })

  it('reports a 5xx AppError to Sentry and logs it as an error', async () => {
    current = await build({ '/': () => new AppError('Mail provider unavailable', 502, 'MAIL_DOWN') })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: 'Mail provider unavailable', code: 'MAIL_DOWN' })
    expect(current.captureException).toHaveBeenCalledOnce()
    expect(current.lines.find((l) => l.msg === 'unexpected error')?.level).toBe(50)
  })

  it('keeps the message of a JSON-schema validation error, as a 422', async () => {
    const logs = appWithLogs()
    current = logs
    logs.app.setErrorHandler(createErrorHandler())
    logs.app.post(
      '/',
      { schema: { body: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } } },
      async () => ({ ok: true })
    )
    const response = await logs.app.inject({ method: 'POST', url: '/', payload: { name: EMAIL } })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ error: "body must have required property 'email'", code: 'VALIDATION_ERROR' })
    expect(everythingSaid(response, logs)).not.toContain(EMAIL)
    // An expected 4xx is not an error-level event.
    expect(logs.lines.every((l) => l.level < 50)).toBe(true)
  })

  it('answers validation with the status an API already uses, when told to', async () => {
    const logs = appWithLogs()
    current = logs
    logs.app.setErrorHandler(createErrorHandler({ validationStatusCode: 400 }))
    logs.app.post('/', { schema: { body: { type: 'object', required: ['email'] } } }, async () => ({}))
    const response = await logs.app.inject({ method: 'POST', url: '/', payload: {} })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('VALIDATION_ERROR')
  })

  it('turns Prisma P2025 into a 404 without the message', async () => {
    current = await build({
      '/': () =>
        prismaError('PrismaClientKnownRequestError', `No record was found for an update. Where: email = ${EMAIL}`, {
          code: 'P2025',
          meta: { modelName: 'Hero', cause: `Record ${EMAIL} not found` }
        })
    })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'Not found', code: 'NOT_FOUND' })
    expect(everythingSaid(response, current)).not.toContain(EMAIL)
    expect(current.captureException).not.toHaveBeenCalled()
  })

  it('turns Prisma P2002 into a 409 and logs only the model and constraint', async () => {
    current = await build({
      '/': () =>
        prismaError(
          'PrismaClientKnownRequestError',
          `Unique constraint failed on the fields: (\`email\`) Key (email)=(${EMAIL}) already exists.`,
          {
            code: 'P2002',
            meta: {
              modelName: 'User',
              driverAdapterError: {
                cause: {
                  kind: 'UniqueConstraintViolation',
                  originalCode: '23505',
                  constraint: { fields: ['email'] },
                  originalMessage: `Key (email)=(${EMAIL}) already exists.`
                }
              }
            }
          }
        )
    })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'Already exists', code: 'CONFLICT' })
    expect(everythingSaid(response, current)).not.toContain(EMAIL)
    const line = current.lines.find((l) => l.msg === 'database error answered 409')
    expect(line.error.database).toMatchObject({
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      kind: 'UniqueConstraintViolation',
      model: 'User',
      target: { fields: ['email'] }
    })
  })

  it('keeps Prisma P2025 and P2002 a reported 500 on a route marked as a webhook', async () => {
    const captureException = vi.fn()
    current = appWithLogs()
    current.app.setErrorHandler(createErrorHandler({ captureException }))
    const codes = { '/hook/missing': 'P2025', '/hook/taken': 'P2002' }
    for (const [path, code] of Object.entries(codes)) {
      current.app.post(path, { config: { webhook: true } }, async () => {
        throw prismaError('PrismaClientKnownRequestError', `Key (email)=(${EMAIL}) already exists.`, { code })
      })
    }
    await current.app.ready()

    for (const url of Object.keys(codes)) {
      const response = await current.app.inject({ method: 'POST', url })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL' })
      expect(everythingSaid(response, current)).not.toContain(EMAIL)
    }
    expect(captureException).toHaveBeenCalledTimes(2)
  })

  it('answers a Prisma validation error with the fixed 500 and logs no values', async () => {
    const error = prismaError('PrismaClientValidationError', prismaValidationMessage)
    current = await build({ '/': () => error })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL' })
    const said = everythingSaid(response, current)
    expect(said).not.toContain(EMAIL)
    expect(said).not.toContain(NOTE)
    const line = current.lines.find((l) => l.msg === 'unexpected error')
    expect(line.level).toBe(50)
    expect(line.error.database).toMatchObject({
      name: 'PrismaClientValidationError',
      invocation: 'prisma.hero.create()'
    })
    expect(current.captureException).toHaveBeenCalledWith(error)
  })

  it('finds a database error wrapped as the cause of another error', async () => {
    const driverError = prismaError('DriverAdapterError', `duplicate key value: Key (email)=(${EMAIL})`, {
      cause: { kind: 'UniqueConstraintViolation', originalCode: '23505', constraint: { fields: ['email'] } }
    })
    current = await build({ '/': () => new Error(`saving ${EMAIL} failed`, { cause: driverError }) })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(500)
    expect(everythingSaid(response, current)).not.toContain(EMAIL)
    const line = current.lines.find((l) => l.msg === 'unexpected error')
    expect(line.error.database).toMatchObject({ name: 'DriverAdapterError', code: '23505' })
  })

  it('answers any other error with the fixed 500, logging name, code and our frame only', async () => {
    current = await build({
      '/': () => Object.assign(new TypeError(`Cannot read properties of undefined (reading '${NOTE}')`), { code: 'X1' })
    })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL' })
    expect(everythingSaid(response, current)).not.toContain(NOTE)
    const line = current.lines.find((l) => l.msg === 'unexpected error')
    expect(line.error).toMatchObject({ name: 'TypeError', code: 'X1' })
    expect(line.error.frame).toMatch(/errors\.test\.js:\d+:\d+\)?$/)
    expect(current.captureException).toHaveBeenCalledOnce()
  })

  it('answers a thrown non-error with the fixed 500', async () => {
    current = await build({ '/': () => `token ${NOTE}` })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(500)
    expect(response.json().error).toBe(INTERNAL_ERROR_MESSAGE)
    expect(everythingSaid(response, current)).not.toContain(NOTE)
  })

  it('never lets an error-level 5xx status carry its message out', async () => {
    current = await build({ '/': () => Object.assign(new Error(`upstream said ${EMAIL}`), { statusCode: 503 }) })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(500)
    expect(everythingSaid(response, current)).not.toContain(EMAIL)
  })

  it('passes through a 4xx a plugin raised, with its message, code and headers', async () => {
    current = await build({
      '/': () =>
        Object.assign(new Error('Rate limit exceeded, retry in 1 minute'), {
          statusCode: 429,
          code: 'FST_ERR_RATE_LIMITED',
          headers: { 'retry-after': '60' }
        })
    })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBe('60')
    expect(response.json()).toEqual({ error: 'Rate limit exceeded, retry in 1 minute', code: 'FST_ERR_RATE_LIMITED' })
    expect(current.captureException).not.toHaveBeenCalled()
  })

  it('answers bad JSON with 400 and keeps the body out of the logs', async () => {
    const logs = appWithLogs()
    current = logs
    logs.app.setErrorHandler(createErrorHandler())
    logs.app.post('/', async () => ({}))
    const response = await logs.app.inject({
      method: 'POST',
      url: '/',
      headers: { 'content-type': 'application/json' },
      payload: `{"email": "${EMAIL}"`
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('FST_ERR_CTP_INVALID_JSON_BODY')
    expect(logs.raw.join('')).not.toContain(EMAIL)
  })

  it('still answers 500 when reporting to Sentry throws', async () => {
    const logs = appWithLogs()
    current = logs
    logs.app.setErrorHandler(
      createErrorHandler({
        captureException: () => {
          throw new Error('transport down')
        }
      })
    )
    logs.app.get('/', async () => {
      throw new Error('boom')
    })
    const response = await logs.app.inject('/')

    expect(response.statusCode).toBe(500)
    expect(response.json().error).toBe(INTERNAL_ERROR_MESSAGE)
  })

  it('builds the body an existing API already sends', async () => {
    const body = ({ statusCode, message }) => ({ statusCode, error: 'Not Found', message })
    current = await build({ '/': () => new AppError('No such hero', 404, 'NOT_FOUND') }, { body })
    const response = await current.app.inject('/')

    expect(response.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'No such hero' })
  })

  it('answers routes registered after it, when set before any register()', async () => {
    const logs = appWithLogs()
    current = logs
    logs.app.setErrorHandler(createErrorHandler())
    await logs.app.register(
      async (child) => {
        child.get('/', async () => {
          throw new AppError('Nope', 403, 'FORBIDDEN')
        })
      },
      { prefix: '/child' }
    )
    const response = await logs.app.inject('/child')

    expect(response.json()).toEqual({ error: 'Nope', code: 'FORBIDDEN' })
  })

  it('passes through the 413 Fastify raises for a body over its limit', async () => {
    const logs = appWithLogs({ bodyLimit: 16 })
    current = logs
    logs.app.setErrorHandler(createErrorHandler())
    logs.app.post('/', async () => ({}))
    const response = await logs.app.inject({ method: 'POST', url: '/', payload: { note: NOTE.repeat(4) } })

    expect(response.statusCode).toBe(413)
    expect(response.json().code).toBe('FST_ERR_CTP_BODY_TOO_LARGE')
    expect(everythingSaid(response, logs)).not.toContain(NOTE)
  })

  it('passes through a 400 and keeps the code a plugin or route gave it', async () => {
    current = await build({
      '/': () => Object.assign(new Error('Missing stripe-signature header'), { statusCode: 400, code: 'NO_SIGNATURE' })
    })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'Missing stripe-signature header', code: 'NO_SIGNATURE' })
  })

  it('keeps a 413 AppError and its own code (takeurown FILE_TOO_LARGE)', async () => {
    current = await build({ '/': () => new AppError('That photo is too large', 413, 'FILE_TOO_LARGE') })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ error: 'That photo is too large', code: 'FILE_TOO_LARGE' })
    expect(current.captureException).not.toHaveBeenCalled()
  })

  it('answers an error by its code when the API maps it', async () => {
    const tooLarge = { statusCode: 413, message: 'File too large', code: 'FILE_TOO_LARGE' }
    current = await build(
      {
        '/file': () =>
          Object.assign(new Error('request file too large'), { statusCode: 413, code: 'FST_REQ_FILE_TOO_LARGE' }),
        '/files': () => Object.assign(new Error('reach files limit'), { statusCode: 413, code: 'FST_FILES_LIMIT' }),
        '/other': () => Object.assign(new Error('Too many'), { statusCode: 429, code: 'FST_ERR_RATE_LIMITED' })
      },
      { errorCodes: { FST_REQ_FILE_TOO_LARGE: tooLarge, FST_FILES_LIMIT: tooLarge } }
    )

    for (const url of ['/file', '/files']) {
      const response = await current.app.inject(url)
      expect(response.statusCode).toBe(413)
      expect(response.json()).toEqual({ error: 'File too large', code: 'FILE_TOO_LARGE' })
    }
    expect((await current.app.inject('/other')).json().code).toBe('FST_ERR_RATE_LIMITED')
    expect(current.captureException).not.toHaveBeenCalled()
  })

  it('maps another Prisma code the API chooses, and never sends its message', async () => {
    current = await build(
      {
        '/': () =>
          prismaError('PrismaClientKnownRequestError', `Foreign key constraint violated: ${EMAIL}`, {
            code: 'P2003',
            meta: { modelName: 'Booking' }
          })
      },
      { errorCodes: { P2003: { statusCode: 409, message: 'Still in use', code: 'IN_USE' } } }
    )
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'Still in use', code: 'IN_USE' })
    expect(everythingSaid(response, current)).not.toContain(EMAIL)
  })

  it('reports a code mapped to a 5xx, answering with the mapped message only', async () => {
    current = await build(
      {
        '/': () =>
          prismaError('PrismaClientInitializationError', `Can't reach database server at ${EMAIL}`, {
            code: 'P1001'
          })
      },
      { errorCodes: { P1001: { statusCode: 503, message: 'Try again shortly', code: 'DB_UNAVAILABLE' } } }
    )
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'Try again shortly', code: 'DB_UNAVAILABLE' })
    expect(current.captureException).toHaveBeenCalledOnce()
    expect(everythingSaid(response, current)).not.toContain(EMAIL)
  })

  it('refuses an errorCodes entry without a 4xx or 5xx status, a message and a code', () => {
    expect(() => createErrorHandler({ errorCodes: { X: { statusCode: 200, message: 'ok', code: 'OK' } } })).toThrow(
      TypeError
    )
    expect(() => createErrorHandler({ errorCodes: { X: { statusCode: 400 } } })).toThrow(TypeError)
    expect(() => createErrorHandler({ errorCodes: null })).toThrow(TypeError)
  })

  it('ignores a Prisma error whose code is an Object.prototype key', async () => {
    current = await build({ '/': () => prismaError('PrismaClientKnownRequestError', 'x', { code: 'constructor' }) })
    const response = await current.app.inject('/')

    expect(response.statusCode).toBe(500)
  })
})

describe('errorFacts', () => {
  it('describes an error without its message', () => {
    const facts = errorFacts(Object.assign(new Error(`saving ${EMAIL} failed`), { code: 'E1', statusCode: 502 }))

    expect(facts).toMatchObject({ name: 'Error', code: 'E1', statusCode: 502 })
    expect(JSON.stringify(facts)).not.toContain(EMAIL)
  })

  it('names the type of a thrown non-object', () => {
    expect(errorFacts('boom')).toEqual({ name: 'string' })
  })
})
