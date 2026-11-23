import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  fastifyIntegration: vi.fn(() => ({ name: 'Fastify' })),
  captureException: vi.fn()
}))

import * as Sentry from '@sentry/node'

import { captureException, dataCollection, initSentry } from '../sentry.js'

// The v10-equivalent baseline from Sentry's v11 migration guide, as the fleet APIs set it on 2026-10-11.
// Spelled out here so a change to the package's copy has to change this test too.
const DENY = ['forwarded', '-ip', 'remote-', 'via', '-user']
const BASELINE = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { deny: DENY }, response: { deny: DENY } },
  httpBodies: [],
  urlQueryParams: { deny: DENY },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SENTRY_DSN', undefined)
  vi.stubEnv('SENTRY_RELEASE', undefined)
  vi.stubEnv('NODE_ENV', 'test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('initSentry', () => {
  it('does nothing without SENTRY_DSN', () => {
    expect(initSentry()).toBe(false)
    expect(Sentry.init).not.toHaveBeenCalled()
  })

  it('initialises with the fleet defaults and the v10 data baseline', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
    vi.stubEnv('SENTRY_RELEASE', 'api@abc123')
    vi.stubEnv('NODE_ENV', 'production')

    expect(initSentry()).toBe(true)
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'production',
      release: 'api@abc123',
      integrations: [{ name: 'Fastify' }],
      tracesSampleRate: 0.1,
      dataCollection: BASELINE
    })
  })

  it('traces every transaction outside production', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
    initSentry()
    expect(Sentry.init.mock.calls[0][0].tracesSampleRate).toBe(1)
  })

  it('lets a caller override a default, and pass a DSN directly', () => {
    initSentry({ dsn: 'https://key@o1.ingest.sentry.io/2', tracesSampleRate: 0 })
    expect(Sentry.init.mock.calls[0][0]).toMatchObject({
      dsn: 'https://key@o1.ingest.sentry.io/2',
      tracesSampleRate: 0
    })
  })

  it('hands Sentry a copy of the baseline, which stays frozen', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
    initSentry()
    expect(Sentry.init.mock.calls[0][0].dataCollection).not.toBe(dataCollection)
    expect(Object.isFrozen(dataCollection)).toBe(true)
    expect(dataCollection).toEqual(BASELINE)
  })

  it("re-exports Sentry's captureException", () => {
    expect(captureException).toBe(Sentry.captureException)
  })
})
