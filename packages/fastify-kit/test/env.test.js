import { describe, expect, it } from 'vitest'

import { requireEnv } from '../index.js'

describe('requireEnv', () => {
  it('returns the required values when every one is set', () => {
    const env = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 's'.repeat(32), OTHER: 'y' }

    expect(requireEnv(['DATABASE_URL', 'JWT_SECRET'], env)).toEqual({
      DATABASE_URL: 'postgresql://x',
      JWT_SECRET: 's'.repeat(32),
    })
  })

  it('names every missing or blank variable in one error, and no value', () => {
    const env = { DATABASE_URL: 'postgresql://user:hunter2@host/db', JWT_SECRET: '   ', CORS_ORIGINS: '' }
    let error
    try {
      requireEnv(['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGINS', 'SENTRY_DSN'], env)
    } catch (e) {
      error = e
    }

    expect(error.message).toBe('Missing required environment variables: JWT_SECRET, CORS_ORIGINS, SENTRY_DSN')
    expect(error).toMatchObject({ name: 'MissingEnvError', code: 'MISSING_ENV' })
    expect(error.missing).toEqual(['JWT_SECRET', 'CORS_ORIGINS', 'SENTRY_DSN'])
    expect(error.message).not.toContain('hunter2')
  })

  it('reads process.env by default', () => {
    process.env.FASTIFY_KIT_TEST_SET = 'yes'
    try {
      expect(requireEnv(['FASTIFY_KIT_TEST_SET'])).toEqual({ FASTIFY_KIT_TEST_SET: 'yes' })
      expect(() => requireEnv(['FASTIFY_KIT_TEST_UNSET'])).toThrow('FASTIFY_KIT_TEST_UNSET')
    } finally {
      delete process.env.FASTIFY_KIT_TEST_SET
    }
  })

  it('refuses names that are not a list of strings', () => {
    expect(() => requireEnv('DATABASE_URL')).toThrow(TypeError)
    expect(() => requireEnv([''])).toThrow(TypeError)
  })
})
