import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

// Every module the main entry loads.
const MAIN_ENTRY_FILES = [
  'index.js',
  'env.js',
  'errors.js',
  'health.js',
  'logger.js',
  'rawBody.js',
  'requestId.js',
  'server.js',
  'trustProxy.js',
  'turnstile.js'
]

describe('package exports', () => {
  it('serves everything but Sentry and the security preset from the main entry', async () => {
    const kit = await import('@coderize/fastify-kit')
    expect(Object.keys(kit).sort()).toEqual([
      'AppError',
      'INTERNAL_ERROR_MESSAGE',
      'REDACTED',
      'REQUEST_ID_HEADER',
      'SITEVERIFY_URL',
      'createErrorHandler',
      'createUrlRedactor',
      'echoRequestId',
      'errorFacts',
      'healthRoutes',
      'isSaneRequestId',
      'loggerOptions',
      'rawJsonBody',
      'redactPaths',
      'redactQueryParams',
      'redactUrl',
      'requestIdOptions',
      'requireEnv',
      'requireTurnstile',
      'startServer',
      'trustCaddyHop',
      'verifyTurnstile'
    ])
  })

  it('serves Sentry from its own entry', async () => {
    const sentry = await import('@coderize/fastify-kit/sentry')
    expect(Object.keys(sentry).sort()).toEqual(['captureException', 'dataCollection', 'initSentry'])
  })

  it('serves the security preset from its own entry', async () => {
    const security = await import('@coderize/fastify-kit/security')
    expect(Object.keys(security).sort()).toEqual([
      'corsMethods',
      'parseOrigins',
      'rateLimitDefaults',
      'securityPlugins'
    ])
  })

  it('keeps @sentry/node and the @fastify plugins out of the main entry, so an API without them can use it', async () => {
    for (const file of MAIN_ENTRY_FILES) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/from '@sentry\/|from '\.\/sentry\.js'/)
      expect(source, file).not.toMatch(/from '@fastify\/(cors|helmet|rate-limit)'|from '\.\/security\.js'/)
    }
  })

  it('publishes every module it imports', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    for (const file of [...MAIN_ENTRY_FILES, 'security.js', 'sentry.js']) {
      expect(pkg.files).toContain(file)
    }
  })
})
