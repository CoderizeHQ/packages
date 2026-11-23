import { afterEach, describe, expect, it, vi } from 'vitest'

import { healthRoutes } from '../index.js'
import { appWithLogs } from './helpers.js'

let current
afterEach(async () => {
  await current?.app.close()
  current = undefined
})

async function build(options, registerOptions = {}) {
  current = appWithLogs()
  await current.app.register(healthRoutes, { ...options, ...registerOptions })
  return current.app
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/

describe('healthRoutes', () => {
  it('answers liveness without touching the database', async () => {
    const checkDatabase = vi.fn()
    const app = await build({ checkDatabase, service: 'xh-api' })
    const response = await app.inject('/health')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', service: 'xh-api', timestamp: expect.stringMatching(ISO) })
    expect(checkDatabase).not.toHaveBeenCalled()
  })

  it("names the service 'api' by default", async () => {
    const app = await build()
    expect((await app.inject('/health')).json().service).toBe('api')
  })

  it("answers readiness with db 'none' when the API has no database", async () => {
    const app = await build()
    const response = await app.inject('/health/ready')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', db: 'none', timestamp: expect.stringMatching(ISO) })
  })

  it("answers readiness with db 'up' when the check resolves, passing it the app", async () => {
    const checkDatabase = vi.fn().mockResolvedValue([{ '?column?': 1 }])
    const app = await build({ checkDatabase })
    const response = await app.inject('/health/ready')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', db: 'up', timestamp: expect.stringMatching(ISO) })
    expect(checkDatabase).toHaveBeenCalledOnce()
    expect(checkDatabase.mock.calls[0][0].hasRoute({ method: 'GET', url: '/health/ready' })).toBe(true)
  })

  it('answers 503 when the check throws, and logs the failure without its message', async () => {
    const secret = 'postgresql://neondb_owner:hunter2@ep-x.neon.tech/neondb'
    const error = Object.assign(new Error(`Can't reach database server at ${secret}`), {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001'
    })
    const app = await build({ checkDatabase: () => Promise.reject(error) })
    const response = await app.inject('/health/ready')

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'degraded', db: 'down', timestamp: expect.stringMatching(ISO) })
    const line = current.lines.find((l) => l.msg === 'readiness check failed')
    expect(line.level).toBe(50)
    expect(line.error.database).toMatchObject({ name: 'PrismaClientInitializationError', code: 'P1001' })
    expect(response.body + current.raw.join('')).not.toContain('hunter2')
  })

  it('keeps successful polls out of the logs', async () => {
    const app = await build({ checkDatabase: async () => {} })
    await app.inject('/health')
    await app.inject('/health/ready')

    expect(current.lines.filter((l) => l.reqId)).toEqual([])
  })

  it('takes a prefix', async () => {
    const app = await build({}, { prefix: '/v1' })
    expect((await app.inject('/v1/health')).statusCode).toBe(200)
    expect((await app.inject('/health')).statusCode).toBe(404)
  })

  it('refuses a checkDatabase that is not a function', async () => {
    current = appWithLogs()
    await expect(current.app.register(healthRoutes, { checkDatabase: 'SELECT 1' })).rejects.toThrow(TypeError)
  })
})
